/**
 * DenService — the end-to-end Den orchestration seam (issue 1-04).
 *
 * This is the one place the MVP sync loop is composed from the faithful chezmoi/git
 * wrappers plus the pure domain owners. It is **Electron-free** (ADR 0023) so the
 * whole thread is testable in plain Node against real binaries, and it speaks
 * dotden's verbs end to end:
 *
 * - **env A** — {@link DenService.trackFile} (chezmoi add + record a placement),
 *   {@link DenService.commitTracked} (re-add/add + `git commit` with a
 *   `CommitMessageRenderer` message; LOCAL until pushed), {@link DenService.syncPush}
 *   (`git push` — the moment a Commit leaves the environment);
 * - **env B** — {@link DenService.listIncomingClean} (fetch + classify incoming
 *   Files for review through `SyncEngine`'s incoming-clean path),
 *   {@link DenService.applyIncoming} (write reviewed, witness-gated Files to disk
 *   with `chezmoi apply`).
 *
 * It never re-checks an invariant an owner guarantees (ADR 0008): applicability is
 * proven by an `AppliesHere` witness from {@link SyncEngine}, never re-derived here.
 */
import { access } from 'node:fs/promises'
import { resolve } from 'node:path'
import { ChezmoiAdapter, UncommittedLocalEditError } from './chezmoi-adapter.js'
import { GitTransport } from './git-transport.js'
import {
  DEFAULT_COMMIT_TEMPLATE,
  renderCommitMessage,
  type CommitMessageTemplate,
  type RenderedCommitMessage,
} from './commit-message-renderer.js'
import {
  DEFAULT_WORKSPACE_ID,
  MyenvStore,
  type EnvironmentEntry,
  type Group,
  type Workspace,
  type WorkspacesDoc,
} from './myenv-store.js'
import type { OperationTracer } from './operation-tracer.js'
import { SyncEngine, type IncomingFile } from './sync-engine.js'
import type { ApplyChangeKind } from './apply-planner.js'
import { ConflictModel, type ResolutionChoice } from './conflict-model.js'
import { parseChezmoiStatus, parseIncomingDeletions, type FileGitStatus } from './chezmoi-status.js'
import {
  AutomationPolicy,
  DEFAULT_AUTOMATION_LEVEL,
  type AutomationLevel,
} from './automation-policy.js'

/** Construction wiring for a {@link DenService}, bound to one environment's dirs. */
export interface DenServiceOptions {
  /** Path to the bundled chezmoi binary. */
  readonly chezmoiBin: string
  /** Path to the bundled git binary. */
  readonly gitBin: string
  /** chezmoi source dir = the git-tracked Den repo, holding `.myenv/` + source state. */
  readonly sourceDir: string
  /** Destination/home dir where applied Files land (`~/.zshrc`, …). */
  readonly destinationDir: string
  /**
   * Optional environment-local chezmoi config path carrying `[data].dotden_env_id`
   * (issue 1-05). Passed through to the {@link ChezmoiAdapter} so a per-environment
   * `.chezmoiignore` template that self-identifies by `dotden_env_id` is honored
   * during Apply. Omitted in tests that do not exercise subscription templates.
   */
  readonly configPath?: string
  /** This environment's identity, label and OS (its subscriptions live in `.myenv/`). */
  readonly environment: Pick<EnvironmentEntry, 'id' | 'label' | 'os'>
  /** Shared tracer so each Operation emits one wide event (ADR 0007); optional in tests. */
  readonly tracer?: OperationTracer
  /**
   * This environment's selected {@link AutomationLevel} (issue 1-12) — the rung the
   * {@link AutomationPolicy} gates by. It is **environment-local** (CONTEXT.md "Auto-sync"),
   * read from {@link import('./automation-settings.js').readAutomationLevel} in production
   * and defaulting to the safe Manual rung when omitted. It controls exactly one thing in
   * the MVP: whether a Commit **auto-pushes** (Auto-sync) or waits for **Sync now** (Manual).
   * Commit itself is NEVER automatic at any level (ADR 0006), and Apply always stays manual.
   */
  readonly automationLevel?: AutomationLevel
}

/**
 * A snapshot the {@link import('./tray-poller.js').TrayPoller} needs to watch the Remote
 * (issue 1-12): the Remote URL to `git ls-remote`, and this environment's local HEAD SHA
 * to seed the poller's "already seen" marker so the first observed Remote SHA equal to
 * HEAD is "nothing new", not a spurious notification.
 *
 * `remoteUrl` is `null` when no Remote is configured yet (a Den initialized but never
 * connected), in which case the poller stays dormant rather than poll nothing.
 */
export interface PollSnapshot {
  /** The configured Remote URL (`git remote get-url origin`), or null when none exists. */
  readonly remoteUrl: string | null
  /** This environment's local HEAD SHA (`git rev-parse HEAD`), or null on a fresh repo. */
  readonly headSha: string | null
}

/**
 * Result of a Commit, surfaced to the UI so it can show the resolved message, which
 * template produced it, and that the Commit is **local until pushed** (ADR 0006).
 */
export interface CommitResult {
  /** The fully resolved git commit message that was recorded. */
  readonly message: string
  /** Id of the template that produced the message — the "which template" surface. */
  readonly templateId: string
  /** Human label of that template, for display. */
  readonly templateLabel: string
  /** The Files recorded in this Commit. */
  readonly committedFiles: readonly string[]
  /**
   * Always `false` immediately after a Commit: a Commit records LOCALLY and does
   * not push (transport-not-commit, ADR 0006). The UI uses this to say "Committed
   * locally — Sync now to push". {@link DenService.syncPush} is what flips it.
   */
  readonly pushed: boolean
}

/**
 * The Remote-axis marker for an incoming File — the SECOND status axis (issue 1-09).
 *
 * This is the ↓/⚠ glyph the tree's `renderRowDecoration` overlay lane paints beside
 * the local git-status letter (the 1-00 spike geometry): `incoming` (↓) is a clean
 * incoming change this slice can Apply; `conflict` (⚠) is a File changed both here and
 * on the Remote, which the incoming-clean path never applies — it is handed to the
 * ConflictModel owner (issue 1-11). The marker type carries `conflict` now so the
 * decoration lane + Review surface are shaped for it, even though this slice only
 * produces `incoming`.
 */
export type RemoteAxisMarker = 'incoming' | 'conflict'

/** One incoming File shown to the user for a reviewed Apply (env B). */
export interface IncomingReviewItem {
  /** Destination-relative File path arriving from the Remote (e.g. `.zshrc`). */
  readonly targetPath: string
  /** Workspace the File belongs to, from the synced `.myenv/` placements. */
  readonly workspaceId: string
  /**
   * The Remote-axis marker for this File (issue 1-09). The incoming-clean path always
   * mints `incoming`; the `conflict` value exists so the Review surface + decoration
   * lane are ready for the ConflictModel slice (issue 1-11) without reshaping.
   */
  readonly marker: RemoteAxisMarker
  /**
   * What Apply will do to this File: `create`/`update` write it, `delete` removes it
   * (issue 1-10). Carried so the Review surface can render an incoming **deletion** as
   * its own first-class row (a removed-File treatment, not an addition).
   */
  readonly kind: ApplyChangeKind
  /**
   * `true` when applying this File needs **explicit confirmation** first (always true for
   * a `delete` — invariant #4, confirm incoming deletions). The Review surface must
   * collect the confirmation and pass the path in `apply`'s `confirmedDeletions`; the
   * value is the `ApplyPlanner`'s verdict, not re-derived here (ADR 0008).
   */
  readonly requiresConfirmation: boolean
}

/**
 * A summary of what is incoming from the Remote, for the top-level
 * "N incoming from `<environment>` — Review & Apply" entry (issue 1-09).
 *
 * It pairs the reviewable Files with the SOURCE environment's label so the entry can
 * name where the changes came from (e.g. "3 incoming from work-laptop"). The source is
 * derived from the synced registry: the environment(s) that are NOT this one. When the
 * registry has not recorded another environment yet, {@link fromEnvironmentLabel} is a
 * neutral fallback rather than a silent blank (never fail silently).
 */
export interface IncomingSummary {
  /** The reviewable incoming Files (each with its Remote-axis marker). */
  readonly items: readonly IncomingReviewItem[]
  /** Label of the environment the incoming changes came from, for the entry copy. */
  readonly fromEnvironmentLabel: string
}

/**
 * Why an Apply did not write a File, beyond a raw chezmoi error — the
 * `ApplyPlanner`-owned refusals surfaced so the Review surface shows the right warning
 * and fix (never fail silently, ADR 0008 invariants #2 & #4).
 *
 * - `blocked-uncommitted-edit` — the File has uncommitted local edits here; applying
 *   would silently overwrite in-progress work (invariant #2). The fix is to Commit or
 *   discard the local edit first. This is also the apply-time atomic re-check verdict
 *   from {@link import('./chezmoi-adapter.js').UncommittedLocalEditError}.
 * - `needs-confirmation` — the File is an incoming **deletion** the user has not yet
 *   confirmed (invariant #4); deletions are never applied without explicit confirmation.
 * - `not-applicable` — the File turned non-applicable between review and apply (the
 *   witness gate refused it; invariant #3).
 */
export type ApplyRefusal = 'blocked-uncommitted-edit' | 'needs-confirmation' | 'not-applicable'

/**
 * The per-File outcome of an Apply, recording that each File **applied independently**
 * (per-file atomicity, issue 1-09): one File's failure never blocks the others.
 *
 * `ok` means `chezmoi apply <file>` wrote the File; `error` means it was not written and
 * carries a human `reason` + a `retryable` flag so the Review surface can offer a retry
 * that re-runs ONLY the failures. A File refused by an `ApplyPlanner` invariant (a local
 * edit block, an unconfirmed deletion, or a witness-gate refusal) carries a `refusal`
 * tag so the surface can show the specific warning + fix, never silently skipping it.
 */
export interface ApplyFileResult {
  /** The destination-relative File path this outcome is for. */
  readonly targetPath: string
  /** Whether the File was written (`ok`) or its Apply did not happen (`error`). */
  readonly outcome: 'ok' | 'error'
  /** Human-readable failure reason when `outcome` is `error`; absent on success. */
  readonly reason?: string
  /**
   * Whether a failed File can be retried (re-run just this File). A per-file chezmoi
   * failure is retryable (the user can fix and re-run); a File the witness gate refused
   * is NOT retryable (it does not apply to this environment at all). A blocked local-edit
   * or unconfirmed deletion is retryable once the user resolves the cause (commits the
   * edit / confirms the deletion) and re-runs.
   */
  readonly retryable?: boolean
  /**
   * The `ApplyPlanner`-owned refusal that stopped this File, when one did — so the UI
   * shows the right warning/fix (invariant #2/#4/#3). Absent for a success or a plain
   * chezmoi error.
   */
  readonly refusal?: ApplyRefusal
}

/**
 * Result of applying reviewed incoming Files to disk (env B), with per-File atomicity.
 *
 * Each File is applied in its OWN `chezmoi apply <file>` invocation so one failure does
 * not block the rest (issue 1-09). {@link results} carries every File's outcome; the
 * convenience {@link applied}/{@link failed} splits are derived from it for the callers
 * that only need the path lists (e.g. the tree refresh after a successful Apply).
 */
export interface ApplyResult {
  /** Per-File outcome for every File the Apply attempted (the per-file-atomicity record). */
  readonly results: readonly ApplyFileResult[]
  /** The destination-relative File paths that applied successfully. */
  readonly applied: readonly string[]
  /** The Files that failed, each with its reason + retryable flag (for the retry UI). */
  readonly failed: readonly ApplyFileResult[]
}

/**
 * One environment a destructive verb would touch — the blast-radius surface the
 * **Delete everywhere** confirm must enumerate before the user proceeds (issue 1-08).
 *
 * A File "affects" an environment when that environment subscribes to the File's
 * Workspace (its access boundary, ADR 0005). The label is what the confirm names so
 * the user sees plainly *which* environments lose the real path (`this-mac`,
 * `work-laptop`, …); `isSelf` marks the one the user is sitting at.
 */
export interface AffectedEnvironment {
  /** Stable environment id (identity, never the hostname — ADR 0024). */
  readonly id: string
  /** User-facing label shown in the confirm (e.g. `this-mac`). */
  readonly label: string
  /** Whether this is the environment the user is acting from. */
  readonly isSelf: boolean
}

/**
 * One File in **Conflict** the user must resolve, with the three sides for the merge view
 * (issue 1-11). The cross-environment axis: two environments Committed the same File so
 * their source-state histories diverged in a way `git merge` could not auto-merge.
 *
 * The sides come straight from git (ours/theirs index stages + the marker-bearing working
 * copy) and feed the renderer's `@pierre/diffs` current/incoming/both merge view. The
 * renderer NEVER constructs resolved bytes from these — it sends the user's choice back
 * through {@link DenService.resolveConflictFile}, which is the only path that mints the
 * un-forgeable resolution (ADR 0008 invariant #1, owned by `ConflictModel`).
 */
export interface ConflictReviewItem {
  /** Destination-relative File path in Conflict (e.g. `.zshrc`). */
  readonly targetPath: string
  /** Workspace the File belongs to, from the synced `.myenv/` placements. */
  readonly workspaceId: string
  /** **Keep mine** bytes — what this environment Committed (git ours/HEAD). */
  readonly current: string
  /** **Take theirs** bytes — what the Remote Committed (git theirs). */
  readonly incoming: string
  /** **Open both** bytes — the `<<<<<<<`-marked union, for conscious hand-editing. */
  readonly both: string
}

/**
 * The result of fetching + merging the Remote to surface Conflicts for resolution (issue
 * 1-11). git **auto-merges non-overlapping hunks** during the merge, so {@link conflicts}
 * is ONLY the set of true Conflicts — the user is never asked about non-conflicts.
 * {@link autoMerged} reports whether the merge completed with nothing left to resolve.
 */
export interface ConflictReview {
  /** The Files git could not auto-merge — each needing an explicit user resolution. */
  readonly conflicts: readonly ConflictReviewItem[]
  /**
   * `true` when `git merge` completed with no overlapping conflicts (everything
   * auto-merged, or nothing was incoming). When `true`, {@link conflicts} is empty and
   * there is nothing for the user to resolve.
   */
  readonly autoMerged: boolean
}

/**
 * One managed File in the three-pane tree view (issue 1-07), carrying everything the
 * renderer needs to place, decorate, and inspect the row WITHOUT a second round-trip:
 * its path, Workspace placement, local-axis git status, and whether it is muted.
 */
export interface FileTreeEntry {
  /** Destination-relative File path (e.g. `.zshrc`) — the `@pierre/trees` row id. */
  readonly targetPath: string
  /** The Workspace this File belongs to, from the synced `.myenv/` placements. */
  readonly workspaceId: string
  /**
   * The Group within {@link FileTreeEntry.workspaceId} this File is filed under, or
   * `null` when it sits directly under the Workspace root (issue 1-14). Pure
   * organization — it never affects access or the File's `targetPath`.
   */
  readonly groupId: string | null
  /**
   * The File's local-axis git status (M/A/D/R/U → modified/added/deleted/…), or `null`
   * when chezmoi reports no change for it. The renderer maps these onto `setGitStatus`
   * so each row shows the coloured status letter (the 1-00 spike recipe).
   */
  readonly status: FileGitStatus['status'] | null
  /**
   * `true` when this File is scoped out of THIS environment's OS and therefore
   * ignored by chezmoi here (it appears in `chezmoi ignored`). The renderer renders
   * the row **muted/ignored** (issue 1-07 owns the muted rendering; the OS-Scope rule
   * that produces it lands in issue 1-15).
   */
  readonly muted: boolean
}

/**
 * The whole local Workspace view for the three-pane tree (issue 1-07): the managed
 * Files (placed, decorated, muted-or-not) plus the Workspaces they live in. Computed
 * in one IPC call so the tree, the git-status axis, and the change dots all derive
 * from a single consistent snapshot.
 */
export interface FileTreeView {
  /** Every managed File, with its placement + local status + muted flag. */
  readonly files: readonly FileTreeEntry[]
  /** The Workspaces in the Den (so the tree can group/section by Workspace). */
  readonly workspaces: WorkspacesDoc['workspaces']
}

/**
 * Orchestrates the dotden sync loop over the faithful chezmoi/git wrappers.
 *
 * One instance is bound to a single environment's source/destination dirs. It holds
 * a {@link ChezmoiAdapter}, a {@link GitTransport} (over the same source dir), and a
 * {@link MyenvStore} for the synced metadata. Pure owners ({@link SyncEngine},
 * {@link renderCommitMessage}) are constructed per call from the current synced
 * model so they always see the latest `.myenv/`.
 */
export class DenService {
  private readonly chezmoi: ChezmoiAdapter
  private readonly git: GitTransport
  private readonly store: MyenvStore
  private readonly tracer?: OperationTracer
  /**
   * The automation-ladder gate for THIS environment (ADR 0008, issue 1-12). DenService
   * **depends on** it to decide whether a Commit auto-pushes — it never re-implements the
   * gate. Holds only the level; the safety invariants stay with their owners.
   */
  private readonly automation: AutomationPolicy

  /**
   * @param options Binaries, dirs, this environment's identity, automation level, tracer.
   */
  constructor(private readonly options: DenServiceOptions) {
    this.chezmoi = new ChezmoiAdapter({
      chezmoiBin: options.chezmoiBin,
      sourceDir: options.sourceDir,
      destinationDir: options.destinationDir,
      configPath: options.configPath,
    })
    this.git = new GitTransport({ gitBin: options.gitBin, repoDir: options.sourceDir })
    this.store = new MyenvStore(options.sourceDir)
    this.tracer = options.tracer
    this.automation = new AutomationPolicy(options.automationLevel ?? DEFAULT_AUTOMATION_LEVEL)
  }

  /**
   * The Remote URL + local HEAD SHA the {@link import('./tray-poller.js').TrayPoller}
   * needs to watch the Remote (issue 1-12). Read-only; emits no wide event.
   *
   * @returns The configured Remote URL (or null) and this environment's HEAD SHA (or null).
   */
  async pollSnapshot(): Promise<PollSnapshot> {
    const [remoteUrl, headSha] = await Promise.all([this.git.remoteUrl(), this.git.headSha()])
    return { remoteUrl, headSha }
  }

  /**
   * First-run seeding: register this environment and the default Workspace in the
   * synced `.myenv/` registry, so a second environment can later reconstruct the Den
   * (ADR 0024). Idempotent.
   *
   * @param traceId Correlation id for the onboarding wide event.
   */
  async registerEnvironment(traceId: string): Promise<void> {
    const span = this.tracer?.startOperation('onboarding', traceId)
    try {
      await this.store.seedDefault(this.options.environment)
      span?.setAttribute('environmentCount', 1)
      span?.end('ok')
    } catch (error) {
      span?.end('error')
      throw error
    }
  }

  /**
   * **Track** a File: start managing it and record its Workspace placement.
   *
   * Maps to `chezmoi add <file>` (the Track verb, CONTEXT.md) plus a synced
   * placement in `.myenv/` so a second environment knows the File exists and which
   * Workspace owns it. The placement is what makes the File show up as incoming on
   * env B after a Sync.
   *
   * @param targetPath Destination-relative File path to Track (e.g. `.zshrc`).
   * @param traceId Correlation id for the wide event.
   */
  async trackFile(targetPath: string, traceId: string): Promise<void> {
    const span = this.tracer?.startOperation('track', traceId)
    try {
      // Ensure the default Workspace + this environment's registry entry + the
      // `.chezmoiignore` rule for `.myenv/` exist before placing a File — Track is
      // env A's first action, so it doubles as first-run seeding (idempotent).
      await this.store.seedDefault(this.options.environment)
      await this.chezmoi.track(targetPath)
      await this.store.placeFile(targetPath)
      span?.setAttribute('fileCount', 1)
      span?.end('ok')
    } catch (error) {
      span?.end('error')
      throw error
    }
  }

  /**
   * **Commit** tracked Files into the Den with a templated message — LOCAL only.
   *
   * Maps to chezmoi re-add/add per File then `git commit` (CONTEXT.md "Commit").
   * The message is produced by {@link renderCommitMessage} so the UI can show the
   * resolved text and which template produced it. Per ADR 0006 (transport not
   * commit) this does NOT push: {@link CommitResult.pushed} is `false`, and the UI
   * tells the user the Commit is local until they Sync now.
   *
   * The `.myenv/` metadata (placements/registry) is committed alongside the Files so
   * the synced model travels with the Commit.
   *
   * @param targetPaths The Files to record (must already be Tracked or new on disk).
   * @param traceId Correlation id for the wide event.
   * @param template Commit-message template; defaults to the built-in default.
   * @returns The resolved message + provenance + the local-not-pushed flag.
   */
  async commitTracked(
    targetPaths: readonly string[],
    traceId: string,
    template: CommitMessageTemplate = DEFAULT_COMMIT_TEMPLATE,
  ): Promise<CommitResult> {
    const span = this.tracer?.startOperation('commit', traceId)
    try {
      const rendered: RenderedCommitMessage = renderCommitMessage(
        { targetPaths, environmentLabel: this.options.environment.label },
        template,
      )
      // chezmoi.commit re-adds/adds the chosen Files then commits exactly their
      // source-state paths; we stage the `.myenv/` metadata in the same commit so
      // the synced Workspace tree + registry travel with the recorded Files.
      await this.chezmoi.commit(targetPaths, rendered.message, {
        commit: async (sourcePaths, message) => {
          // Stage the chosen Files' source paths PLUS the synced metadata
          // (`.myenv/` registry+placements and the `.chezmoiignore` that keeps
          // `.myenv/` out of chezmoi's managed set) so the model travels with the
          // Commit and a second environment can reconstruct the Den.
          await this.git.commit([...sourcePaths, '.myenv', '.chezmoiignore'], message)
        },
      })
      span?.setAttribute('fileCount', targetPaths.length)
      span?.setAttribute('automationLevel', this.automation.automationLevel)
      // Auto-sync (issue 1-12): when the AutomationPolicy permits it, PUSH the
      // already-Committed change automatically so the user need not press Sync now.
      // We DEPEND on the policy's `mayAutoPush()` decision (ADR 0008) — DenService never
      // re-implements the level gate — and this only ever transports a change the user
      // ALREADY Committed (transport-not-commit, ADR 0006); the Commit above is never
      // automatic. A failed auto-push is surfaced (never fail silently): the Commit is
      // recorded locally regardless, so we report `pushed: false` and rethrow so the UI
      // shows the failure and offers a manual Sync now.
      const pushed = this.automation.mayAutoPush()
      if (pushed) {
        await this.git.push()
      }
      span?.end('ok')
      return {
        message: rendered.message,
        templateId: rendered.templateId,
        templateLabel: rendered.templateLabel,
        committedFiles: [...targetPaths],
        // Manual: a Commit is local until pushed (ADR 0006) — `false`, and Sync now sends
        // it. Auto-sync: the policy auto-pushed above — `true`, so the UI says it's synced.
        pushed,
      }
    } catch (error) {
      span?.end('error')
      throw error
    }
  }

  /**
   * **Sync now (push half)**: send already-Committed changes to the Remote.
   *
   * Maps to `git push --set-upstream origin main` (CONTEXT.md "Sync"). This is the
   * moment a local Commit becomes shared — the only thing that leaves the
   * environment, and only what was Committed (transport-not-commit, ADR 0006).
   *
   * @param traceId Correlation id for the wide event.
   */
  async syncPush(traceId: string): Promise<void> {
    const span = this.tracer?.startOperation('sync', traceId)
    try {
      await this.git.push()
      span?.setAttribute('queued', false)
      span?.end('ok')
    } catch (error) {
      span?.end('error')
      throw error
    }
  }

  /**
   * **env B** — fetch the Remote and present incoming Files for a reviewed Apply
   * (incoming-clean creates + first-class incoming deletions), ADR 0008.
   *
   * Maps to `git fetch` + `chezmoi status` + the synced `.myenv/` placements, then routes
   * through {@link SyncEngine} → {@link ApplyPlanner}: only Files applicable to this
   * environment (an {@link import('./applicability-resolver.js').AppliesHere} witness is
   * minted for each) appear for review. Conflicting or non-subscribed Files are deferred,
   * never silently applied. Each item carries the planner's `kind` (create/delete) and
   * `requiresConfirmation` so the Review surface renders a deletion as its own row and
   * knows it must be confirmed (invariant #4) — verdicts owned by the planner, not
   * re-derived here.
   *
   * @param traceId Correlation id for the wide event.
   * @returns The reviewable incoming Files (path + Workspace + marker + kind + confirm flag).
   */
  async listIncomingClean(traceId: string): Promise<readonly IncomingReviewItem[]> {
    const span = this.tracer?.startOperation('sync', traceId)
    try {
      await this.git.fetch()
      const incoming = await this.computeIncoming()
      const { environment, workspaces } = await this.loadSyncedModel()
      const engine = new SyncEngine({ environment, workspaces, tracer: this.tracer })
      // Hand the local-drift facts to the planner so a File blocked by an uncommitted edit
      // (invariant #2) still surfaces in Review (the user sees the warning), not vanishes.
      const uncommittedEdits = await this.chezmoi.localEdits()
      const { plan } = engine.routeIncomingClean(incoming, traceId, { uncommittedEdits })
      const placementOf = new Map(workspaces.placements.map((p) => [p.targetPath, p.workspaceId]))
      const items: IncomingReviewItem[] = plan.items.map((item) => ({
        targetPath: item.witness.targetPath,
        // A `create`/`update` resolves a placement; a `delete` may have lost its placement
        // already (removed on the source env), so fall back to '' rather than failing.
        workspaceId: placementOf.get(item.witness.targetPath) ?? '',
        // Incoming Files are all the ↓ Remote axis here; ⚠ conflict is issue 1-11.
        marker: 'incoming',
        kind: item.kind,
        // Consume the planner's verdict directly (invariant #4 lives in ApplyPlanner).
        requiresConfirmation: item.requiresConfirmation,
      }))
      span?.setAttribute('fileCount', items.length)
      span?.end('ok')
      return items
    } catch (error) {
      span?.end('error')
      throw error
    }
  }

  /**
   * **env B** — the Review & Apply summary: fetch + list incoming Files AND name the
   * source environment, for the top-level "N incoming from `<environment>`" entry
   * (issue 1-09).
   *
   * Reuses {@link listIncomingClean} for the (witness-gated, incoming-clean) Files, then
   * derives the source environment label from the synced registry: the most-recently
   * active environment that is NOT this one (the environment whose Commits these
   * incoming Files came from). A Den with no other environment recorded yet falls back
   * to a neutral label rather than a blank, so the entry never reads "N incoming from "
   * (never fail silently).
   *
   * @param traceId Correlation id for the wide event (reuses the sync Operation).
   * @returns The incoming Files plus the source environment's label.
   */
  async incomingSummary(traceId: string): Promise<IncomingSummary> {
    const items = await this.listIncomingClean(traceId)
    return { items, fromEnvironmentLabel: await this.incomingSourceLabel() }
  }

  /**
   * **env B** — apply reviewed incoming Files to disk, **one File at a time**
   * (per-file atomicity, issue 1-09), enforcing the two `ApplyPlanner`-owned invariants
   * (issue 1-10).
   *
   * Maps to a SEPARATE guarded `chezmoi apply <file>` per File rather than one batched
   * apply, because the Review & Apply contract is that each File **applies independently**:
   * one File failing must not block the others, and a failure must be reported with a
   * reason + a retry that re-runs just the failures. (chezmoi is already per-path — each
   * invocation is its own atomic write — so this is the faithful mapping of "Apply
   * one"/"Apply all" onto chezmoi's per-path model, ADR 0003.)
   *
   * The reviewed paths are routed through {@link SyncEngine} → {@link ApplyPlanner}, which
   * owns the verdicts this method **consumes without re-deciding** (ADR 0008):
   * - **invariant #3** — only witness-backed Files plan; a path that turned non-applicable
   *   is surfaced as a non-retryable `not-applicable` refusal, never written;
   * - **invariant #2** — a File the planner marks `blocked-uncommitted-edit` is surfaced,
   *   not written, and the **authoritative atomic re-check** is taken in
   *   {@link import('./chezmoi-adapter.js').ChezmoiAdapter.applyGuarded} (no plan→apply
   *   TOCTOU): even a File dirtied AFTER the plan is refused at the last instant;
   * - **invariant #4** — a `delete` is applied ONLY if the user explicitly confirmed it
   *   (its path is in `confirmedDeletions`); an unconfirmed deletion is surfaced as a
   *   `needs-confirmation` refusal, never silently applied.
   *
   * This Operation is NEVER thrown out of: a per-File failure is caught and recorded so
   * the rest of the batch still applies. The wide event's `outcome` reflects whether ALL
   * attempted Files applied.
   *
   * @param targetPaths The reviewed File paths to write ("Apply all" = every reviewed
   *   path; "Apply one" = a single path; "Retry" = just the previously-failed paths).
   * @param traceId Correlation id for the wide event.
   * @param confirmedDeletions The deletion paths the user explicitly confirmed (invariant
   *   #4). A path that is a REAL incoming deletion (per `chezmoi status`) but absent here
   *   is refused `needs-confirmation`. Defaults to none, so an incoming deletion is never
   *   applied unless its confirmation is passed in.
   * @returns Per-File outcomes, plus the applied/failed splits for convenience.
   */
  async applyIncoming(
    targetPaths: readonly string[],
    traceId: string,
    confirmedDeletions: readonly string[] = [],
  ): Promise<ApplyResult> {
    const span = this.tracer?.startOperation('apply', traceId)
    try {
      const { environment, workspaces } = await this.loadSyncedModel()
      const engine = new SyncEngine({ environment, workspaces })
      // One `chezmoi status` read drives BOTH invariant facts so plan and apply agree on a
      // single snapshot:
      // - column X (local-drift, invariant #2): which reviewed paths are dirty on disk RIGHT
      //   NOW. The planner blocks any incoming write to one of these; ChezmoiAdapter re-checks
      //   atomically at write time so a path dirtied after this snapshot is still caught.
      // - column Y=D (incoming deletions, invariant #4): which reviewed paths `chezmoi apply`
      //   would DELETE here (the source removed them). Deletion-ness is the REAL incoming
      //   status, NOT inferred from `confirmedDeletions` — otherwise an UNCONFIRMED incoming
      //   deletion would misclassify as a create and silently delete the destination File.
      const statusRaw = await this.chezmoi.status()
      const uncommittedEdits = new Set(parseChezmoiStatus(statusRaw).map((entry) => entry.path))
      const incomingDeletionSet = new Set(parseIncomingDeletions(statusRaw))
      // Classify each reviewed path by its REAL incoming status: a path `chezmoi apply` would
      // delete routes as `incoming-delete` (regardless of confirmation, so the planner marks it
      // `kind: 'delete'` / `requiresConfirmation: true`), every other reviewed path as
      // `incoming-clean`. SyncEngine re-mints witnesses (invariant #3) and hands the local-edit
      // set to ApplyPlanner (invariant #2); the planner decides blocking + deletion-confirmation
      // — this method never re-derives those. The confirmation gate below is the consumer of the
      // planner's `kind: 'delete'` verdict, not a re-derivation of deletion-ness.
      const confirmedDeletionSet = new Set(confirmedDeletions)
      const { plan, deferred } = engine.routeIncomingClean(
        targetPaths.map((targetPath) => ({
          targetPath,
          status: incomingDeletionSet.has(targetPath)
            ? ('incoming-delete' as const)
            : ('incoming-clean' as const),
        })),
        traceId,
        { uncommittedEdits },
      )
      // Index the planner's per-File verdicts so the apply loop consumes them by path.
      const planItem = new Map(plan.items.map((item) => [item.witness.targetPath, item]))

      const results: ApplyFileResult[] = []
      // Apply each File in its OWN guarded chezmoi invocation so a single File's failure is
      // isolated — the loop continues and the remaining Files still apply.
      for (const targetPath of targetPaths) {
        const item = planItem.get(targetPath)
        if (!item) {
          // The witness gate refused this path (invariant #3) — surface it, never silently drop.
          results.push({
            targetPath,
            outcome: 'error',
            refusal: 'not-applicable',
            reason:
              deferred.find((d) => d.targetPath === targetPath)?.reason === 'conflict'
                ? 'This File is in Conflict — resolve it before applying.'
                : 'This File does not apply to this environment (not in a subscribed Workspace).',
            retryable: false,
          })
          continue
        }
        // Invariant #2 (plan-time block): a File with an uncommitted local edit is surfaced,
        // not written. ChezmoiAdapter.applyGuarded is the authoritative re-check below.
        if (item.blockedReason === 'uncommitted-edit') {
          results.push({
            targetPath,
            outcome: 'error',
            refusal: 'blocked-uncommitted-edit',
            reason:
              'This File has uncommitted local edits — Commit or discard them first, then Apply ' +
              '(so your in-progress work is not overwritten).',
            // Retryable once the user resolves the edit and re-runs JUST this File.
            retryable: true,
          })
          continue
        }
        // Invariant #4: a deletion is applied ONLY when explicitly confirmed. This is the
        // LIVE safety gate, not a defensive no-op: deletion-ness was classified from the REAL
        // incoming status above (column Y=D), so a path the source removed routes here as a
        // `delete` even when the user never confirmed it — and is refused, never reaching
        // `applyGuarded` (which would run `chezmoi apply <path>` and delete the destination
        // File). Only a `delete` whose path is in `confirmedDeletions` falls through to apply.
        if (item.kind === 'delete' && !confirmedDeletionSet.has(targetPath)) {
          results.push({
            targetPath,
            outcome: 'error',
            refusal: 'needs-confirmation',
            reason: 'This is an incoming deletion — confirm it before applying.',
            retryable: true,
          })
          continue
        }
        try {
          // Guarded apply: the atomic uncommitted-edit re-check happens INSIDE this call,
          // immediately before the write, so there is no plan→apply TOCTOU (invariant #2).
          // A confirmed incoming deletion (`kind: 'delete'`) and a create/update both route
          // here — `chezmoi apply <file>` is the faithful write for either: for a deletion
          // it removes the destination File because the source no longer manages it (ADR 0003).
          await this.chezmoi.applyGuarded(targetPath)
          results.push({ targetPath, outcome: 'ok' })
        } catch (caught) {
          // The apply-time atomic guard fired: a File dirtied after the plan was built. Surface
          // it as a blocked local edit (the same refusal as the plan-time block), retryable.
          if (caught instanceof UncommittedLocalEditError) {
            results.push({
              targetPath,
              outcome: 'error',
              refusal: 'blocked-uncommitted-edit',
              reason: caught.message,
              retryable: true,
            })
            continue
          }
          // A per-File chezmoi failure: record the reason, retryable so the user can fix the
          // cause and re-run JUST this File without blocking the others.
          results.push({
            targetPath,
            outcome: 'error',
            reason:
              caught instanceof Error ? caught.message : 'chezmoi apply failed for this File.',
            retryable: true,
          })
        }
      }

      const applied = results.filter((r) => r.outcome === 'ok').map((r) => r.targetPath)
      const failed = results.filter((r) => r.outcome === 'error')
      span?.setAttribute('fileCount', applied.length)
      // The Operation's outcome is `error` if ANY File failed, so the wide event reflects
      // a partial Apply honestly (the per-File detail lives in the returned result).
      span?.end(failed.length === 0 ? 'ok' : 'error')
      return { results, applied, failed }
    } catch (error) {
      span?.end('error')
      throw error
    }
  }

  /**
   * **Conflict** — fetch + merge the Remote in the source-state repo, surfacing the true
   * Conflicts for resolution (issue 1-11; ADR 0008 invariant #1).
   *
   * This is the **cross-environment axis** (CONTEXT.md): maps to `git fetch` + `git merge`
   * in the source repo. git **auto-merges non-overlapping hunks for free**, so the user is
   * never asked about changes that don't actually conflict; only overlapping edits leave
   * `<<<<<<<` markers (a `UU` status). **Merge, not rebase** (rebase rewrites history and
   * muddies env attribution, issue 1-05), and **pure git, not `chezmoi merge`** (that is
   * the local-drift axis, owned by issue 1-10).
   *
   * For each conflicted File it reads the three sides (ours/theirs/marker-union) so the
   * renderer's merge view can show current/incoming/both. It NEVER resolves anything here
   * — resolution only happens through {@link resolveConflictFile} with an explicit user
   * choice. When the merge auto-resolves cleanly, the merge is completed (committed) right
   * away — there is no Conflict to leave pending — and {@link ConflictReview.autoMerged} is
   * `true`.
   *
   * @param traceId Correlation id for the wide event.
   * @returns The true Conflicts (empty when git auto-merged) + the auto-merged flag.
   */
  async detectConflicts(traceId: string): Promise<ConflictReview> {
    const span = this.tracer?.startOperation('sync', traceId)
    try {
      await this.git.fetch()
      const merge = await this.git.merge()
      if (merge.merged) {
        // git auto-merged every (non-overlapping) hunk — nothing for the user to resolve.
        span?.setAttribute('fileCount', 0)
        span?.end('ok')
        return { conflicts: [], autoMerged: true }
      }
      // Build a review item per conflicted File with its three sides for the merge view.
      const { placements } = await this.store.readWorkspaces()
      const placementOf = new Map(placements.map((p) => [p.targetPath, p.workspaceId]))
      const conflicts: ConflictReviewItem[] = []
      for (const targetPath of merge.conflictedPaths) {
        const sides = await this.git.conflictedFile(targetPath)
        conflicts.push({
          targetPath,
          workspaceId: placementOf.get(targetPath) ?? '',
          current: sides.current,
          incoming: sides.incoming,
          both: sides.both,
        })
      }
      span?.setAttribute('fileCount', conflicts.length)
      // A real Conflict is not a failure of this Operation — it is the expected outcome.
      span?.end('ok')
      return { conflicts, autoMerged: false }
    } catch (error) {
      span?.end('error')
      throw error
    }
  }

  /**
   * **Resolve one Conflict** with the user's explicit Keep mine / Take theirs / Open both
   * choice, and stage the result (issue 1-11; ADR 0008 invariant #1 — the load-bearing
   * "never auto-resolve" guarantee).
   *
   * The choice is run through {@link ConflictModel} — the SOLE owner of invariant #1 —
   * which mints the un-forgeable resolved bytes (no other code path can produce them). The
   * resolution is routed through {@link SyncEngine.routeConflictResolution}, which writes
   * ONLY values carrying `ConflictModel`'s brand, then the bytes are written to the
   * working-tree File and `git add`-ed (marking the `UU` entry resolved). It does NOT
   * complete the merge commit — the renderer completes the whole merge via
   * {@link completeConflictResolution} once every File is resolved, so a half-resolved
   * merge is never silently committed.
   *
   * The model is rebuilt from git's live sides here (not trusted from the renderer) so a
   * stale or tampered client cannot smuggle in bytes the user did not actually choose.
   *
   * @param targetPath Destination-relative File path being resolved (a `UU` entry).
   * @param choice The user's explicit resolution (Keep mine / Take theirs / Open both).
   * @param traceId Correlation id for the wide event.
   * @throws Error when the resolution did not carry `ConflictModel`'s brand (never auto-resolved).
   */
  async resolveConflictFile(
    targetPath: string,
    choice: ResolutionChoice,
    traceId: string,
  ): Promise<void> {
    const span = this.tracer?.startOperation('sync', traceId)
    try {
      // Read the live three sides from git and let ConflictModel mint the resolved bytes —
      // the ONLY place resolved bytes come into existence (invariant #1).
      const sides = await this.git.conflictedFile(targetPath)
      const model = new ConflictModel({ targetPath, ...sides })
      const resolved = model.resolve(choice)
      // Route through SyncEngine: it accepts ONLY branded (user-chosen) resolutions, so a
      // value that did not come from ConflictModel could never be written.
      const { environment, workspaces } = await this.loadSyncedModel()
      const engine = new SyncEngine({ environment, workspaces, tracer: this.tracer })
      const { writes, rejected } = engine.routeConflictResolution([resolved], traceId)
      if (rejected.length > 0 || writes.length !== 1) {
        // Unreachable in practice (we just minted it), but never write an unverified resolution.
        throw new Error(`Refused to write an un-verified resolution for ${targetPath}`)
      }
      // Persist the user-chosen bytes and stage the File as resolved (`git add`).
      await this.git.writeResolved(writes[0]!.targetPath, writes[0]!.bytes)
      span?.setAttribute('fileCount', 1)
      span?.end('ok')
    } catch (error) {
      span?.end('error')
      throw error
    }
  }

  /**
   * **Complete the in-progress merge** once every Conflict has been resolved + staged
   * (issue 1-11). Maps to `git commit` for the pending merge.
   *
   * git refuses to commit while unmerged (`UU`) entries remain, so this can only succeed
   * after every conflicted File went through {@link resolveConflictFile} — the backstop
   * that an unresolved Conflict is never committed. This is the **Apply resolution** step
   * of the resolver (the merge becomes part of the Den's history).
   *
   * @param traceId Correlation id for the wide event.
   */
  async completeConflictResolution(traceId: string): Promise<void> {
    const span = this.tracer?.startOperation('sync', traceId)
    try {
      await this.git.completeMerge('Resolve cross-environment conflicts')
      span?.end('ok')
    } catch (error) {
      span?.end('error')
      throw error
    }
  }

  /**
   * **Abort** the in-progress merge, discarding the half-merged tree (issue 1-11). Maps to
   * `git merge --abort`.
   *
   * The **Abort** action in the resolver: a user who does not want to resolve right now
   * returns to the pre-merge state and loses nothing — and crucially nothing is
   * auto-resolved. Safe to call when no merge is in progress (it surfaces git's error).
   *
   * @param traceId Correlation id for the wide event.
   */
  async abortConflictResolution(traceId: string): Promise<void> {
    const span = this.tracer?.startOperation('sync', traceId)
    try {
      await this.git.abortMerge()
      span?.end('ok')
    } catch (error) {
      span?.end('error')
      throw error
    }
  }

  /**
   * **env B** — the diff of an incoming File the user reviews BEFORE applying it
   * (issue 1-09).
   *
   * Maps to `chezmoi diff <file>` on env B: for an incoming-clean File (one that does
   * not yet exist locally) chezmoi reports the would-be-written content as additions,
   * which is exactly the "review the change before you Apply" surface. Read-only — it
   * writes nothing — so like {@link fileDiff} it emits no wide event. An empty string
   * means there is nothing to apply for the File (it already matches), which the Review
   * surface shows honestly rather than fabricating a patch.
   *
   * @param targetPath Destination-relative incoming File path to preview (e.g. `.zshrc`).
   * @returns chezmoi's unified diff of what Apply would write (empty when nothing to do).
   */
  async incomingDiff(targetPath: string): Promise<string> {
    return this.chezmoi.diff([targetPath])
  }

  /**
   * Derive the label of the environment incoming changes came FROM (issue 1-09).
   *
   * The source is read from the synced registry: the most-recently-active environment
   * that is NOT this one (activity is git-log-derived, never persisted — ADR 0024). A
   * Den that has not recorded another environment yet (a fresh env B before any peer
   * is registered) falls back to a neutral "another environment" label so the
   * top-level entry always names a source rather than a blank (never fail silently).
   */
  private async incomingSourceLabel(): Promise<string> {
    const { environments } = await this.store.readEnvironments()
    const others = environments.filter((e) => e.id !== this.options.environment.id)
    return others[0]?.label ?? 'another environment'
  }

  /**
   * **Untrack** a File: stop dotden managing it, leaving the real path on disk on
   * every environment (CONTEXT.md "Untrack"; the non-destructive removal).
   *
   * Maps to `chezmoi forget <file>` (source state entry removed, destination copy
   * kept) plus dropping the File's synced `.myenv/` placement so a second environment
   * no longer sees it as incoming. The source removal + the placement removal are
   * committed together so the Untrack travels through the Remote — otherwise the File
   * would silently reappear on the next Sync. Per ADR 0006 this Commit is LOCAL until
   * a later Sync now pushes it.
   *
   * The File is NOT deleted from any disk: that is the distinct {@link deleteEverywhereFile}
   * verb. The confirmation copy (issue 1-08) states plainly that the File stays on disk.
   *
   * @param targetPath Destination-relative File path to Untrack (e.g. `.zshrc`).
   * @param traceId Correlation id for the wide event.
   */
  async untrackFile(targetPath: string, traceId: string): Promise<void> {
    const span = this.tracer?.startOperation('untrack', traceId)
    try {
      // 1) chezmoi forget: drop the source-state entry, keep the destination copy.
      //    This DELETES the File's source-state file (e.g. `dot_zshrc`) from the repo.
      await this.chezmoi.untrack(targetPath)
      // 2) Drop the synced placement so env B stops seeing the File as incoming.
      await this.store.removePlacement(targetPath)
      // 3) Commit the forget + the `.myenv/` placement removal together (LOCAL until
      //    pushed, ADR 0006) so the Untrack travels and the File does not reappear.
      //    `commitAll` (git add --all) is required, not a path-scoped commit: the forget
      //    *removed* the source-state file, and that DELETION must be staged too —
      //    otherwise the source file would still be committed in the Remote and re-appear
      //    on the next Sync. At this point the only dirty paths are exactly the forget's
      //    deletion plus the `.myenv/` placement edit, so add --all records just those.
      await this.git.commitAll(`Untrack ${targetPath}`)
      span?.setAttribute('fileCount', 1)
      span?.end('ok')
    } catch (error) {
      span?.end('error')
      throw error
    }
  }

  /**
   * **Delete everywhere** a File: remove it from the Den AND delete the real path on
   * every environment where it applies (CONTEXT.md "Delete everywhere"; destructive,
   * always confirmed).
   *
   * Maps to `chezmoi destroy --force <file>` (source state AND destination removed)
   * plus dropping the File's synced `.myenv/` placement, committed together so the
   * deletion travels: when another environment next Applies, chezmoi removes the real
   * path there too. This is a DISTINCT verb from {@link untrackFile} so the destructive
   * intent is separate; the confirm names every affected environment (see
   * {@link affectedEnvironments}) before proceeding. LOCAL until a later Sync (ADR 0006).
   *
   * @param targetPath Destination-relative File path to delete everywhere (e.g. `.zshrc`).
   * @param traceId Correlation id for the wide event.
   */
  async deleteEverywhereFile(targetPath: string, traceId: string): Promise<void> {
    const span = this.tracer?.startOperation('delete-everywhere', traceId)
    try {
      // 1) chezmoi destroy: remove BOTH the source-state entry and the destination copy here.
      //    This DELETES the File's source-state file (e.g. `dot_zshrc`) from the repo.
      await this.chezmoi.deleteEverywhere(targetPath)
      // 2) Drop the synced placement so the File leaves the Den entirely.
      await this.store.removePlacement(targetPath)
      // 3) Commit the destroy + the `.myenv/` placement removal together (LOCAL until
      //    pushed, ADR 0006) so the deletion travels and reaches every environment.
      //    `commitAll` (git add --all) is required, not a path-scoped commit: the destroy
      //    *removed* the source-state file, and that DELETION must be staged so the
      //    removal is recorded — otherwise another environment would still receive (and
      //    re-apply) the File on Sync. The only dirty paths here are exactly the destroy's
      //    deletion plus the `.myenv/` placement edit, so add --all records just those.
      await this.git.commitAll(`Delete ${targetPath} everywhere`)
      span?.setAttribute('fileCount', 1)
      span?.end('ok')
    } catch (error) {
      span?.end('error')
      throw error
    }
  }

  /**
   * Enumerate the environments a **Delete everywhere** of `targetPath` would touch —
   * the blast-radius surface the destructive confirm must name (issue 1-08).
   *
   * An environment is affected when it subscribes to the File's Workspace (its access
   * boundary, ADR 0005): only there does the File apply, so only there does `destroy`
   * delete the real path. Read-only — it mutates nothing, so like {@link fileTree} it
   * emits no wide event. Falls back to the default Workspace for an unplaced File so a
   * managed-but-unplaced File still reports a non-empty, honest blast radius rather than
   * an empty (misleadingly safe) one (never fail silently).
   *
   * @param targetPath Destination-relative File path the confirm is about (e.g. `.zshrc`).
   * @returns Every affected environment (id/label/isSelf), self listed first.
   */
  async affectedEnvironments(targetPath: string): Promise<readonly AffectedEnvironment[]> {
    const [{ environments }, { placements }] = await Promise.all([
      this.store.readEnvironments(),
      this.store.readWorkspaces(),
    ])
    // The Workspace that owns the File is its access boundary; default an unplaced
    // managed File to the default Workspace so it still names a blast radius.
    const workspaceId =
      placements.find((p) => p.targetPath === targetPath)?.workspaceId ?? DEFAULT_WORKSPACE_ID
    const affected = environments
      .filter((env) => env.subscribedWorkspaces.includes(workspaceId))
      .map((env) => ({
        id: env.id,
        label: env.label,
        isSelf: env.id === this.options.environment.id,
      }))
    // Surface the environment the user is acting from first so the confirm reads
    // "this environment, then the others" — and never silently omit self if the synced
    // registry has not recorded it yet (a fresh env A before its first push).
    if (!affected.some((env) => env.isSelf)) {
      affected.unshift({
        id: this.options.environment.id,
        label: this.options.environment.label,
        isSelf: true,
      })
    }
    return affected.sort((a, b) => Number(b.isSelf) - Number(a.isSelf))
  }

  /**
   * Build the three-pane tree view (issue 1-07): the managed Files joined with their
   * Workspace placement, local-axis git status, and out-of-OS-Scope muted flag.
   *
   * Faithful composition over chezmoi (ADR 0003): the File set is `chezmoi managed
   * --include files`, the local status axis is {@link parseChezmoiStatus} over
   * `chezmoi status`, the muted set is `chezmoi ignored`, and the Workspace placement
   * comes from the synced `.myenv/`. Read-only — it mutates nothing and is therefore
   * NOT a traced Operation (the IpcBridge still asserts the `_trace` envelope so the
   * call is correlated; the `traceId` is accepted to keep the IPC surface uniform).
   *
   * Files that have never been placed (managed on disk but missing from `.myenv/`)
   * still appear, defaulted to the default Workspace, so a managed File never silently
   * disappears from the tree (never fail silently).
   *
   * No `traceId` parameter: this read-only query emits no wide event, and the
   * IpcBridge already asserts the `_trace` envelope for the channel (like the other
   * read-only `discover:*`/`env:*` channels) — there is nothing here to correlate it to.
   *
   * @returns The Files (placed/decorated/muted) plus the Workspaces, for the renderer.
   */
  async fileTree(): Promise<FileTreeView> {
    const [managed, statusRaw, ignored, workspacesDoc] = await Promise.all([
      this.chezmoi.managed(),
      this.chezmoi.status(),
      this.chezmoi.ignoredPaths(),
      this.store.readWorkspaces(),
    ])
    // Index the local-axis status + the muted set + placements for O(1) per-File joins.
    const statusByPath = new Map(parseChezmoiStatus(statusRaw).map((s) => [s.path, s.status]))
    const ignoredSet = new Set(ignored)
    const placementOf = new Map(workspacesDoc.placements.map((p) => [p.targetPath, p]))
    const files: FileTreeEntry[] = managed.map((targetPath) => {
      const placement = placementOf.get(targetPath)
      return {
        targetPath,
        // Default an unplaced managed File to the default Workspace rather than dropping it.
        workspaceId: placement?.workspaceId ?? DEFAULT_WORKSPACE_ID,
        // An unplaced/ungrouped File sits at its Workspace root (null).
        groupId: placement?.groupId ?? null,
        status: statusByPath.get(targetPath) ?? null,
        muted: ignoredSet.has(targetPath),
      }
    })
    return { files, workspaces: workspacesDoc.workspaces }
  }

  /**
   * Real unified diff for the selected File in the center pane (issue 1-07).
   *
   * Maps to `chezmoi diff <file>` (the source→destination diff chezmoi would apply),
   * which the renderer feeds straight into `@pierre/diffs` `PatchDiff`. Read-only, so
   * like {@link fileTree} it emits no wide event (the IpcBridge still asserts the
   * `_trace` envelope for the channel). An empty string means the File is unchanged
   * (the pane shows that honestly rather than a fake patch).
   *
   * @param targetPath Destination-relative File path to diff (e.g. `.zshrc`).
   * @returns chezmoi's raw unified diff for the File (empty when unchanged).
   */
  async fileDiff(targetPath: string): Promise<string> {
    return this.chezmoi.diff([targetPath])
  }

  // ── Workspaces + nested Groups (issue 1-14) ──
  // The user-authored organization layer chezmoi has no notion of, persisted in the
  // synced `.myenv/` (ADR 0024, "no chezmoi equivalent"). Creating/moving here mutates
  // ONLY `.myenv/workspaces.json`; it never touches chezmoi source state or any file on
  // disk. So these commit the metadata edit LOCALLY (ADR 0006) — like the other verbs,
  // the change travels only on the next Sync, which is what lets a second environment
  // reconstruct the same Workspace/Group tree.

  /**
   * **Create a Workspace** — a new top-level access boundary (e.g. "Work"), issue 1-14.
   *
   * Creating the SECOND Workspace is the moment the Workspace concept becomes visible
   * in the UI; with only the default one it stays hidden (so simple setups stay
   * simple). A new Workspace is created with no Groups and no subscribers — subscribing
   * an environment to it is the access step exercised in issue 1-13. The new Workspace
   * tree is committed LOCALLY so it travels on the next Sync (ADR 0006).
   *
   * @param label User-facing Workspace label (e.g. "Work").
   * @param traceId Correlation id for the wide event.
   * @returns The created Workspace (id + label + empty Groups).
   */
  async createWorkspace(label: string, traceId: string): Promise<Workspace> {
    const span = this.tracer?.startOperation('organize', traceId)
    try {
      const workspace = await this.store.createWorkspace(label)
      await this.commitMetadata(`Create Workspace ${label}`)
      span?.setAttribute('workspaceCount', (await this.store.readWorkspaces()).workspaces.length)
      span?.end('ok')
      return workspace
    } catch (error) {
      span?.end('error')
      throw error
    }
  }

  /**
   * **Create a Group** inside a Workspace to organize Files (issue 1-14).
   *
   * Groups are PURE organization (ADR 0005): this writes a node into the Workspace's
   * `groups` tree and changes NEITHER any environment's access NOR any File's on-disk
   * path. `parentId` nests it under another Group in the same Workspace, or `null` for
   * a top-level Group. Committed LOCALLY so the tidy-up travels on the next Sync.
   *
   * @param workspaceId The Workspace the Group lives in (access unchanged).
   * @param label User-facing Group label (e.g. "Shell").
   * @param parentId Parent Group id for nesting, or `null` for a top-level Group.
   * @param traceId Correlation id for the wide event.
   * @returns The created Group (id + label + parentId).
   */
  async createGroup(
    workspaceId: string,
    label: string,
    parentId: string | null,
    traceId: string,
  ): Promise<Group> {
    const span = this.tracer?.startOperation('organize', traceId)
    try {
      const group = await this.store.createGroup(workspaceId, label, parentId)
      await this.commitMetadata(`Create Group ${label}`)
      span?.end('ok')
      return group
    } catch (error) {
      span?.end('error')
      throw error
    }
  }

  /**
   * **File a managed File under a Group** (or back to the Workspace root) — the
   * organize-only move (issue 1-14). This edits ONLY the placement's `groupId`; the
   * File's `workspaceId` (access) and `targetPath` (on-disk path) are left unchanged
   * (the ADR 0005 invariant, owned and enforced in {@link MyenvStore.moveFileToGroup}).
   *
   * @param targetPath The managed File to re-file (must already be placed).
   * @param groupId Target Group id, or `null` to move it to the Workspace root.
   * @param traceId Correlation id for the wide event.
   */
  async moveFileToGroup(
    targetPath: string,
    groupId: string | null,
    traceId: string,
  ): Promise<void> {
    const span = this.tracer?.startOperation('organize', traceId)
    try {
      await this.store.moveFileToGroup(targetPath, groupId)
      await this.commitMetadata(`Organize ${targetPath}`)
      span?.setAttribute('fileCount', 1)
      span?.end('ok')
    } catch (error) {
      span?.end('error')
      throw error
    }
  }

  /**
   * **Move a managed File into a different Workspace** — the access-boundary move
   * (issue 1-14). Unlike {@link moveFileToGroup}, changing the Workspace DOES change
   * which environments apply the File (ADR 0005), so the File's Group resets to the new
   * Workspace's root. The on-disk `targetPath` is still untouched. Committed LOCALLY.
   *
   * @param targetPath The managed File to move (must already be placed).
   * @param workspaceId Target Workspace id (its access boundary).
   * @param traceId Correlation id for the wide event.
   */
  async setFileWorkspace(targetPath: string, workspaceId: string, traceId: string): Promise<void> {
    const span = this.tracer?.startOperation('organize', traceId)
    try {
      await this.store.setFileWorkspace(targetPath, workspaceId)
      await this.commitMetadata(`Move ${targetPath} to another Workspace`)
      span?.setAttribute('fileCount', 1)
      span?.end('ok')
    } catch (error) {
      span?.end('error')
      throw error
    }
  }

  /**
   * Commit a `.myenv/`-only metadata edit LOCALLY (ADR 0006).
   *
   * The Workspace/Group operations touch only `.myenv/workspaces.json` (and the
   * `.chezmoiignore` that keeps `.myenv/` out of chezmoi's managed set) — never chezmoi
   * source state or any file on disk. Staging just those paths keeps the commit scoped
   * to the organization change. Local until the next Sync, which is what carries the
   * tree to a second environment (ADR 0024).
   *
   * @param message The git commit subject (e.g. "Create Workspace Work").
   */
  private async commitMetadata(message: string): Promise<void> {
    await this.git.commit(['.myenv', '.chezmoiignore'], message)
  }

  /** Read the synced model (this environment's registry entry + the Workspace doc). */
  private async loadSyncedModel(): Promise<{
    environment: EnvironmentEntry
    workspaces: WorkspacesDoc
  }> {
    const [registry, workspaces] = await Promise.all([
      this.store.readEnvironments(),
      this.store.readWorkspaces(),
    ])
    const environment = registry.environments.find((e) => e.id === this.options.environment.id) ?? {
      ...this.options.environment,
      // A freshly-cloned env B has not claimed an entry yet; default to subscribing
      // to every Workspace so the MVP subscribe-all thread can apply incoming Files.
      subscribedWorkspaces: workspaces.workspaces.map((w) => w.id),
    }
    return { environment, workspaces }
  }

  /**
   * Classify incoming Files for the incoming-clean + incoming-deletion paths.
   *
   * Two signals are merged:
   * - **incoming-clean creates** — every placed File in `.myenv/` that is NOT yet present
   *   on this environment's disk (no local copy → no Conflict). Reading placements is what
   *   lets env B discover Files it has never seen.
   * - **incoming deletions** (issue 1-10) — Files `chezmoi status` reports as
   *   apply-will-delete (column Y = `D`, via {@link parseIncomingDeletions}): the source
   *   removed the File, so Apply would delete it here. These route as `incoming-delete`
   *   and ApplyPlanner marks them confirm-required (invariant #4), never auto-applied.
   *
   * A File that already exists locally with NO incoming change is dropped here (the fuller
   * incoming-update/diff path is the Review & Apply slice, 1-09).
   */
  private async computeIncoming(): Promise<readonly IncomingFile[]> {
    const { placements } = await this.store.readWorkspaces()
    const incoming: IncomingFile[] = []
    // Incoming deletions: what `chezmoi apply` would remove on this environment (column Y=D).
    const toDelete = new Set(parseIncomingDeletions(await this.chezmoi.status()))
    for (const placement of placements) {
      if (toDelete.has(placement.targetPath)) {
        // The source removed this File — an incoming deletion the user must confirm.
        incoming.push({ targetPath: placement.targetPath, status: 'incoming-delete' })
        continue
      }
      const onDisk = await this.exists(placement.targetPath)
      if (!onDisk) incoming.push({ targetPath: placement.targetPath, status: 'incoming-clean' })
    }
    return incoming
  }

  /** True when a destination-relative File already exists on this environment's disk. */
  private async exists(targetPath: string): Promise<boolean> {
    try {
      await access(this.destinationPath(targetPath))
      return true
    } catch {
      return false
    }
  }

  /** Resolve a destination-relative File path under this environment's home dir. */
  private destinationPath(targetPath: string): string {
    // Mirror ChezmoiAdapter.destinationPath: resolve under the destination dir for
    // the on-disk existence probe (handles nested paths + Windows separators).
    return resolve(this.options.destinationDir, targetPath)
  }
}
