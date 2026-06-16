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
import { access, readFile, rm } from 'node:fs/promises'
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
import type { Os, Scope } from './os-scope.js'
import { PushQueue } from './push-queue.js'
import { isOfflineError } from './offline.js'
import type { UnsubscribeDisposition } from './subscription-settings.js'
import { scanForSecrets, type SecretFinding } from './secret-scanner.js'

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
  /**
   * Path to this environment's **offline push outbox** (issue 1-16). The outbox is a single
   * durable flag "a push is owed to the Remote", used so a Commit made while offline records
   * locally and **queues** its push for retry on reconnect / next Sync (ADR 0006), rather
   * than failing. It is **environment-local** (a property of THIS machine's connectivity,
   * never synced — ADR 0024): `index.ts` passes a path under Electron `userData`. Omitted in
   * tests/contexts that don't exercise queued pushes ⇒ offline pushes still queue in memory
   * for the lifetime of the service via an in-process fallback path.
   */
  readonly pushOutboxPath?: string
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
  /**
   * `true` when an Auto-sync push was attempted but **queued** because the machine is
   * offline (issue 1-16): the Commit is recorded locally and its push will retry on
   * reconnect / next Sync (ADR 0006). The UI shows the offline banner ("changes queued").
   * Always `false` under Manual (no auto-push attempted) and when the auto-push succeeded.
   */
  readonly queued: boolean
}

/**
 * Result of a {@link DenService.syncPush} or {@link DenService.flushPushQueue} — whether the
 * push reached the Remote or was **queued offline** for retry (issue 1-16).
 *
 * `pushed` is `true` when the Remote now has the local Commits; `queued` is `true` when the
 * machine was offline and the push was recorded in the durable outbox to retry on the next
 * reconnect/Sync. Exactly one is `true` for a Sync that had something to send; a Sync with
 * nothing pending and nothing new to push reports both `false` (a clean no-op).
 */
export interface SyncPushResult {
  /** `true` when the push reached the Remote (the local Commits are now shared). */
  readonly pushed: boolean
  /** `true` when the push could not go out (offline) and was queued for retry. */
  readonly queued: boolean
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

/** One Workspace this environment can subscribe to, for the returning-flow pick (issue 1-13). */
export interface SubscribableWorkspace {
  /** Stable Workspace id (the subscription key, ADR 0005). */
  readonly id: string
  /** User-facing Workspace label (e.g. "Personal", "Work"). */
  readonly label: string
  /** Whether THIS environment currently subscribes to it (drives the checklist's checked state). */
  readonly subscribed: boolean
}

/**
 * This environment's **subscription state** — what the returning-flow pick + the
 * never-silent unregistered-env guard read (issue 1-13, ADR 0005 / ADR 0024).
 *
 * It answers three questions in one read: which Workspaces exist (and which this env is
 * subscribed to), whether this environment has a registry entry yet, and — when it does NOT
 * (or subscribes to nothing) — the human reason + fix to surface, so an unregistered env that
 * would materialize an EMPTY Den never renders a confusing blank quietly (the template's
 * ignore-everything fail-safe is paired with this honest explanation).
 */
export interface SubscriptionState {
  /** Every Workspace in the Den, each flagged with whether this environment subscribes. */
  readonly workspaces: readonly SubscribableWorkspace[]
  /**
   * `true` when this environment has a registry entry recorded (so the templated
   * `.chezmoiignore` resolves a subscription rather than hitting the fail-safe). A fresh clone
   * before claim/registration is `false`.
   */
  readonly registered: boolean
  /**
   * A human warning to surface when this environment would materialize an EMPTY Den — it has no
   * registry entry yet, or its subscription is empty (the `.chezmoiignore` fail-safe ignored
   * everything). `null` when the Den will materialize normally. NEVER let this be silent: the
   * returning flow shows it with the fix ("this environment isn't registered yet — finish setup
   * to choose your Workspaces").
   */
  readonly emptyDenWarning: string | null
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
   * that produces it is issue 1-15). This is the FAITHFUL signal — it comes from
   * `chezmoi ignored` over the generated `.chezmoiignore`, not from re-deriving Scope.
   */
  readonly muted: boolean
  /**
   * The File's **effective OS Scope** after inheritance + narrowing (issue 1-15): the OSes
   * it applies on, or `null` for the universal Scope ("applies everywhere"). Carried so the
   * inspector can render the Scope chips and the Scope editor can show the current value
   * without a second round-trip. Distinct from {@link muted}: `muted` is "ignored on THIS
   * OS right now"; `scope` is the full applicability set across OSes.
   */
  readonly scope: Scope
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
   * The durable offline push outbox (issue 1-16). A push that can't go out because the
   * machine is offline is recorded here and retried on reconnect / next Sync (ADR 0006),
   * so a Commit made offline records locally and never loses its push. Environment-local
   * (ADR 0024): persisted outside the synced source tree.
   */
  private readonly pushQueue: PushQueue

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
    // The outbox is environment-local connectivity state, so it must NOT live inside the
    // synced source/git tree. Default it to a sibling of the source dir (still per-Den, but
    // outside version control + outside `.myenv/`) when the caller does not pass an explicit
    // userData path. The PushQueue creates the file/dir on first write.
    this.pushQueue = new PushQueue(
      options.pushOutboxPath ?? resolve(options.sourceDir, '..', '.dotden-push-outbox.json'),
    )
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
      // Keep the generated `.chezmoiignore` in lock-step with the new placement so the
      // committed file is always the live templated ignore (issue 1-13): when a `configPath`
      // is present it carries the subscription template that a second environment relies on,
      // so it must TRAVEL with the Commit (not the stale `.myenv/`-only file `seedDefault`
      // wrote). No-op net change for a subscribe-all single-Workspace Den.
      await this.regenerateOsScopeIgnore()
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
      // automatic.
      let pushed = false
      let queued = false
      if (this.automation.mayAutoPush()) {
        // OFFLINE QUEUE (issue 1-16): the Commit is ALREADY recorded locally above, so a
        // push that can't reach the Remote because the machine is offline must NOT fail the
        // Commit — it is queued and retried on reconnect / next Sync (ADR 0006). A push that
        // fails for any OTHER reason (a server-reached rejection: non-fast-forward, auth,
        // missing repo) is a real error and rethrows, so the UI surfaces it (never fail
        // silently — that error a blind retry can't fix).
        try {
          await this.git.push()
          pushed = true
        } catch (error) {
          if (!isOfflineError(error)) throw error
          await this.pushQueue.enqueue()
          queued = true
        }
      }
      // `queued` is the allowlisted offline-queue flag (issue 1-16); `pushed` is implied by
      // its absence + the automation level, so we do not add a separate non-allowlisted key.
      span?.setAttribute('queued', queued)
      span?.end('ok')
      return {
        message: rendered.message,
        templateId: rendered.templateId,
        templateLabel: rendered.templateLabel,
        committedFiles: [...targetPaths],
        // Manual: a Commit is local until pushed (ADR 0006) — `false`, and Sync now sends
        // it. Auto-sync online: the policy auto-pushed above — `true`. Auto-sync offline:
        // not pushed but `queued` — the offline banner says "changes queued, will sync on
        // reconnect"; the local Commit is safe regardless.
        pushed,
        queued,
      }
    } catch (error) {
      span?.end('error')
      throw error
    }
  }

  /**
   * **Scan the about-to-be-Committed set for secrets** (issue 2-03) — the commit-time
   * detection that feeds the amber warn step.
   *
   * The renderer calls this BEFORE {@link commitTracked}: it reads each chosen File's bytes
   * from disk (exactly what `chezmoi re-add` would import into the Den) and runs the PURE
   * {@link scanForSecrets} detector over them. Findings are returned as data — this method
   * NEVER prevents a Commit (warn-not-block, ADR 0001). An empty result means "nothing to
   * warn about", and the renderer proceeds straight to {@link commitTracked}; a non-empty
   * result is the caution the warn step renders (one card per finding: File, kind, line,
   * masked preview), after which the user still chooses to Commit (the Convert-to-a-Secret-
   * reference path lands in issues 2-04/2-05).
   *
   * Reading the **destination** bytes (not chezmoi's source state) is deliberate: the user
   * is about to record exactly these bytes into the Den, where they would sync RAW to every
   * environment unless converted — catching them here is catching the secret "at the door"
   * (secret-and-errors screen spec). A File that can't be read (gone/binary/permission) is
   * skipped rather than failing the scan: the scan is advisory, and a missing File simply
   * has nothing to warn about (the Commit itself will surface a real add/re-add error).
   *
   * Pure detection, no shell: the only I/O here is reading the File bytes; the detector
   * itself runs no subprocess and makes no network call, so scanning can never leak a secret.
   *
   * @param targetPaths The Files about to be Committed (the renderer's changed set).
   * @param traceId Correlation id for the wide event (a read-only scan Operation).
   * @returns Every secret finding across the set, in File-then-line order (empty = clean).
   */
  async scanCommit(
    targetPaths: readonly string[],
    traceId: string,
  ): Promise<readonly SecretFinding[]> {
    const span = this.tracer?.startOperation('commit', traceId)
    try {
      // Read each File's about-to-be-committed bytes. A File we can't read (removed, binary,
      // permission) is skipped — the scan is advisory and never fails the Commit over it.
      const inputs = await Promise.all(
        targetPaths.map(async (file) => {
          try {
            return { file, content: await readFile(this.destinationPath(file), 'utf8') }
          } catch {
            // Unreadable here = nothing this scan can warn about; the Commit path surfaces
            // any genuine read failure when it re-adds the File (never fail silently there).
            return { file, content: '' }
          }
        }),
      )
      const findings = scanForSecrets(inputs)
      // Allowlisted count only — never the secret values themselves (the privacy posture).
      span?.setAttribute('fileCount', targetPaths.length)
      span?.setAttribute('secretFindingCount', findings.length)
      span?.end('ok')
      return findings
    } catch (error) {
      span?.end('error')
      throw error
    }
  }

  /**
   * **Sync now (push half)**: send already-Committed changes to the Remote, flushing any
   * push queued while offline (issue 1-16).
   *
   * Maps to `git push --set-upstream origin main` (CONTEXT.md "Sync"). This is the
   * moment a local Commit becomes shared — the only thing that leaves the
   * environment, and only what was Committed (transport-not-commit, ADR 0006). Because
   * `git push` sends EVERY unpushed commit, one push here also flushes any push that was
   * queued while offline — so "Sync now" is the manual retry path the issue asks for
   * ("queued pushes also flush on the next Sync").
   *
   * Offline handling: if the push can't reach the Remote because the machine is offline,
   * the push is **queued** (the local Commits are not lost) and a `queued` result is
   * returned rather than throwing — the UI shows the offline banner. A NON-offline failure
   * (a server-reached rejection) clears any stale queue and rethrows so the user sees it.
   *
   * @param traceId Correlation id for the wide event.
   * @returns Whether the push reached the Remote (`pushed`) or was queued offline (`queued`).
   */
  async syncPush(traceId: string): Promise<SyncPushResult> {
    const span = this.tracer?.startOperation('sync', traceId)
    try {
      await this.git.push()
      // The push reached the Remote, carrying every unpushed commit — including anything
      // that was queued while offline. Clear the outbox so a stale flag doesn't linger.
      await this.pushQueue.clear()
      span?.setAttribute('queued', false)
      span?.end('ok')
      return { pushed: true, queued: false }
    } catch (error) {
      if (isOfflineError(error)) {
        // Still offline — queue the push (idempotent) so the next reconnect/Sync retries it.
        // This is NOT an error path for the user: the Commits are safe locally and will
        // travel automatically, so we return `queued` rather than throwing.
        await this.pushQueue.enqueue()
        span?.setAttribute('queued', true)
        span?.end('ok')
        return { pushed: false, queued: true }
      }
      // A server-reached rejection (non-fast-forward, auth, missing repo): a blind retry
      // can't fix it, so drop any stale queue and surface the real error (never fail silently).
      await this.pushQueue.clear()
      span?.end('error')
      throw error
    }
  }

  /**
   * **Flush the offline push queue** — retry a push that was queued while offline (issue
   * 1-16). This is the **reconnect** path: `index.ts` calls it when `powerMonitor`/Electron
   * `net` reports the machine came back online, so queued Commits propagate without the user
   * pressing Sync now. (The OTHER flush path is {@link syncPush}, the manual/Auto Sync.)
   *
   * No-op when nothing is queued (returns `pushed:false, queued:false`) — flushing on every
   * reconnect is cheap and never pushes spuriously. If the push still can't go out (the
   * reconnect was flaky / partial), it stays queued for the next attempt; a NON-offline
   * failure surfaces (the error propagates) so a real rejection is not hidden.
   *
   * @param traceId Correlation id for the wide event.
   * @returns Whether a queued push was flushed (`pushed`) or remained queued (`queued`).
   */
  async flushPushQueue(traceId: string): Promise<SyncPushResult> {
    const span = this.tracer?.startOperation('sync', traceId)
    try {
      // PushQueue.flush is the durable retry: success clears the outbox; an offline failure
      // KEEPS it (rethrows isOffline) so we can report `queued` and retry later; a
      // non-offline failure clears it and rethrows so the real error surfaces.
      const flushed = await this.pushQueue.flush(() => this.git.push())
      span?.setAttribute('queued', false)
      span?.end('ok')
      // `flushed` is false only when nothing was queued (a clean no-op).
      return { pushed: flushed, queued: false }
    } catch (error) {
      if (isOfflineError(error)) {
        // Still offline after the reconnect — the push remains queued (flush kept the flag).
        span?.setAttribute('queued', true)
        span?.end('ok')
        return { pushed: false, queued: true }
      }
      span?.end('error')
      throw error
    }
  }

  /**
   * Whether a push is currently **queued** (owed to the Remote) because it could not go out
   * offline (issue 1-16). Read-only; drives the renderer's offline banner so the in-app
   * surface honestly reflects "changes queued — will sync when you reconnect" without
   * attempting any network. Emits no wide event.
   *
   * @returns `true` when there are local Commits waiting to be pushed on reconnect/next Sync.
   */
  async pushPending(): Promise<boolean> {
    return this.pushQueue.isPending()
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

  // ── Per-environment Workspace subscription (issue 1-13, ADR 0005 / ADR 0024) ──
  // The returning second-environment flow: a freshly-cloned env picks which Workspaces it
  // subscribes to (defaulting to all), realized as a templated `.chezmoiignore` that joins
  // this env's `dotden_env_id` against the synced registry and ignores un-subscribed Files.

  /**
   * Read this environment's **subscription state** for the returning-flow pick + the
   * never-silent unregistered-env guard (issue 1-13).
   *
   * Read-only (no Operation/wide event): it returns every Workspace flagged with whether this
   * environment subscribes, whether this env has a registry entry yet, and — critically — a
   * human `emptyDenWarning` when this env would materialize an EMPTY Den (no entry, or an empty
   * subscription). That warning is the visible half of the registry-entry guard: the template's
   * ignore-everything fail-safe keeps `chezmoi apply` from erroring, and THIS surfaces *why* so
   * dotden never renders a confusing empty Den quietly (never fail silently, issue 1-13).
   *
   * @returns The Workspaces (with per-Workspace subscribed flags), `registered`, and the warning.
   */
  async subscriptionState(): Promise<SubscriptionState> {
    const [{ environments }, { workspaces }] = await Promise.all([
      this.store.readEnvironments(),
      this.store.readWorkspaces(),
    ])
    const self = environments.find((e) => e.id === this.options.environment.id) ?? null
    const subscribed = new Set(self?.subscribedWorkspaces ?? [])
    const subscribableWorkspaces: SubscribableWorkspace[] = workspaces.map((w) => ({
      id: w.id,
      label: w.label,
      subscribed: subscribed.has(w.id),
    }))
    // The Den materializes EMPTY here when this env is unregistered OR subscribes to nothing —
    // exactly when the templated `.chezmoiignore` hits its ignore-everything fail-safe.
    const empty = self === null || subscribed.size === 0
    return {
      workspaces: subscribableWorkspaces,
      registered: self !== null,
      emptyDenWarning: empty
        ? self === null
          ? "This environment isn't registered in your Den yet, so nothing will apply here. " +
            'Finish setup to choose which Workspaces this environment subscribes to.'
          : 'This environment subscribes to no Workspaces, so nothing applies here. ' +
            'Choose at least one Workspace to start applying your Den.'
        : null,
    }
  }

  /**
   * **Set this environment's Workspace subscription** — the returning-flow pick + the
   * registry-entry guard's primary (ordering) layer (issue 1-13, ADR 0005).
   *
   * Writes this environment's `subscribedWorkspaces` into the synced registry, re-compiles the
   * templated `.chezmoiignore` so chezmoi ignores un-subscribed Workspaces' Files here, and
   * commits the metadata LOCALLY (ADR 0006) so the subscription travels. Writing the entry
   * BEFORE any Apply is the ordering guard: the templated ignore never hits the "no entry yet"
   * gap (issue 1-13). It does NOT apply any File — the first materialization is the deliberate,
   * reviewed Apply that follows (ADR 0024 "claiming only re-associates identity").
   *
   * Defaults to ALL Workspaces when `workspaceIds` is omitted (the issue's "defaulting to all"),
   * so a second environment that just wants the whole Den needs no choices.
   *
   * @param workspaceIds The Workspace ids to subscribe to; omitted ⇒ all Workspaces.
   * @param traceId Correlation id for the wide event.
   * @returns The resulting subscription state (so the UI re-renders in one round-trip).
   */
  async setSubscriptions(
    workspaceIds: readonly string[] | undefined,
    traceId: string,
  ): Promise<SubscriptionState> {
    const span = this.tracer?.startOperation('organize', traceId)
    try {
      const all = (await this.store.readWorkspaces()).workspaces.map((w) => w.id)
      // 1) Write this env's subscription into the synced registry BEFORE any apply (the
      //    ordering guard). Default to ALL Workspaces when the user made no choice.
      await this.store.setSubscriptions(this.options.environment, workspaceIds ?? all)
      // 2) Re-compile the templated `.chezmoiignore` so un-subscribed Files are ignored here.
      await this.regenerateOsScopeIgnore()
      // 3) Commit the registry + regenerated ignore LOCALLY so the subscription travels.
      await this.commitMetadata('Set Workspace subscription')
      span?.setAttribute('workspaceCount', (workspaceIds ?? all).length)
      span?.end('ok')
      return await this.subscriptionState()
    } catch (error) {
      span?.end('error')
      throw error
    }
  }

  /**
   * **Un-subscribe a Workspace** on this environment, with the user's explicit keep-or-remove
   * choice for the Files it leaves behind (issue 1-13, ADR 0005).
   *
   * Subscription is the access boundary, so dropping a Workspace re-compiles the templated
   * `.chezmoiignore` to ignore its Files here. But `.chezmoiignore` alone only stops chezmoi
   * *managing* those Files — it does NOT delete them — so the caller must decide their fate:
   *
   * - `disposition: 'keep'` — leave the Files on disk as untracked orphans (the safe default).
   *   Nothing is deleted; the Files simply stop being managed here.
   * - `disposition: 'remove'` — explicitly delete the un-subscribed Files from THIS
   *   environment's home directory (a plain destination-path removal). This is deliberately
   *   NOT `chezmoi destroy`/`forget`: those mutate the SHARED source state (and would travel on
   *   the next Commit), whereas un-subscribing must touch ONLY this environment's local copy —
   *   the source state and every other environment keep the File. So the removal is a local
   *   `fs.rm` of the destination path, never committed, never Den-wide.
   *
   * The choice's remembered default lives in environment-local settings (issue 1-13); this
   * method just carries out the chosen disposition. The subscription change is committed
   * LOCALLY (ADR 0006) so it travels; the on-disk removal is local-only (never committed).
   *
   * @param workspaceId The Workspace to un-subscribe from.
   * @param disposition Whether to `keep` the un-subscribed Files on disk or `remove` them here.
   * @param traceId Correlation id for the wide event.
   * @returns The resulting subscription state.
   */
  async unsubscribeWorkspace(
    workspaceId: string,
    disposition: UnsubscribeDisposition,
    traceId: string,
  ): Promise<SubscriptionState> {
    const span = this.tracer?.startOperation('organize', traceId)
    try {
      const [{ environments }, workspacesDoc] = await Promise.all([
        this.store.readEnvironments(),
        this.store.readWorkspaces(),
      ])
      const self = environments.find((e) => e.id === this.options.environment.id)
      const current = self?.subscribedWorkspaces ?? workspacesDoc.workspaces.map((w) => w.id)
      const next = current.filter((id) => id !== workspaceId)
      // The Files this un-subscription orphans here = placements in the dropped Workspace.
      const orphans = workspacesDoc.placements
        .filter((p) => p.workspaceId === workspaceId)
        .map((p) => p.targetPath)
      // 1) Write the narrowed subscription + re-compile the ignore so the Files are ignored here.
      await this.store.setSubscriptions(this.options.environment, next)
      await this.regenerateOsScopeIgnore()
      await this.commitMetadata(`Unsubscribe Workspace ${workspaceId}`)
      // 2) Carry out the user's keep/remove choice for the now-un-subscribed Files. `keep`
      //    leaves them as untracked orphans (do nothing — `.chezmoiignore` already stopped
      //    managing them here). `remove` deletes THIS env's local copy explicitly, because the
      //    ignore never removes a File (the spike's load-bearing finding).
      if (disposition === 'remove') {
        for (const targetPath of orphans) {
          // Remove ONLY this environment's local home-dir copy (never the shared source state,
          // never committed) so other environments keep the File. Best-effort + per-File
          // tolerant: a File already absent is fine, and one missing orphan never blocks the
          // rest — never fail the whole un-subscription over a local cleanup miss.
          try {
            await rm(this.destinationPath(targetPath), { force: true })
          } catch {
            // Best-effort local cleanup: a File already gone is fine; keep removing the rest.
          }
        }
      }
      span?.setAttribute('fileCount', disposition === 'remove' ? orphans.length : 0)
      span?.end('ok')
      return await this.subscriptionState()
    } catch (error) {
      span?.end('error')
      throw error
    }
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
   * **OS Scope (issue 1-15).** A File scoped out of THIS environment's OS lands in the
   * generated `.chezmoiignore`, and chezmoi treats an ignored File as **unmanaged here** —
   * so it drops out of `chezmoi managed`. If the tree were built from `managed` alone, a
   * scoped-out File would *vanish* rather than show **muted**. So the row set is the UNION
   * of `chezmoi managed` (applies here) and the synced `.myenv/` placements (the Den's known
   * Files): a placed File missing from `managed` is exactly a scoped-out File, rendered muted
   * (it appears in `chezmoi ignored`). The muted flag stays FAITHFUL — it is membership in
   * `chezmoi ignored`, OR (for the scoped-out, hence unmanaged, File) placed-but-not-managed.
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
    const managedSet = new Set(managed)
    const placementOf = new Map(workspacesDoc.placements.map((p) => [p.targetPath, p]))
    // The row set is the UNION of "managed here" and "placed in the Den" so a scoped-out
    // (and therefore unmanaged-here) File still shows as a muted row instead of vanishing.
    const allPaths = [
      ...new Set([...managed, ...workspacesDoc.placements.map((p) => p.targetPath)]),
    ]
    const files: FileTreeEntry[] = allPaths.map((targetPath) => {
      const placement = placementOf.get(targetPath)
      return {
        targetPath,
        // Default an unplaced managed File to the default Workspace rather than dropping it.
        workspaceId: placement?.workspaceId ?? DEFAULT_WORKSPACE_ID,
        // An unplaced/ungrouped File sits at its Workspace root (null).
        groupId: placement?.groupId ?? null,
        status: statusByPath.get(targetPath) ?? null,
        // FAITHFUL muted signal (issue 1-15): the File appears in `chezmoi ignored`, OR it is
        // placed in the Den but absent from `chezmoi managed` (scoped out → unmanaged here).
        // Either way chezmoi will NOT apply it on this environment, so the row is dimmed.
        muted: ignoredSet.has(targetPath) || !managedSet.has(targetPath),
        // The File's effective OS Scope after inheritance, for the inspector chips/editor.
        scope: this.store.effectiveScopeOf(workspacesDoc, targetPath),
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
      // A new Workspace is exactly when subscription starts to matter, so refresh the templated
      // `.chezmoiignore` (issue 1-13) and commit it alongside the metadata so it travels.
      await this.regenerateOsScopeIgnore()
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
      // The File's Workspace (its access boundary) changed, so the subscription template's
      // per-File ignore set changes — refresh + commit the templated `.chezmoiignore` (1-13).
      await this.regenerateOsScopeIgnore()
      await this.commitMetadata(`Move ${targetPath} to another Workspace`)
      span?.setAttribute('fileCount', 1)
      span?.end('ok')
    } catch (error) {
      span?.end('error')
      throw error
    }
  }

  // ── OS Scope (issue 1-15) ──
  // Scope is the OS-applicability axis (CONTEXT.md "Scope"): the OSes a File/Folder applies
  // on, inherited Workspace → Group → File and narrowable but never broadenable. The intent
  // is user-authored, stored in `.myenv/`; the realized rules are native `.chezmoiignore`
  // (ADR 0024). Setting a Scope (1) clamps the request under the inherited ceiling in the
  // store (the narrowing invariant), then (2) re-compiles `.chezmoiignore` from the WHOLE
  // Den's effective Scopes so chezmoi ignores exactly the out-of-OS Files here, then (3)
  // commits the metadata + the regenerated ignore LOCALLY so the Scope travels (ADR 0006).

  /**
   * **Scope a File** to specific OSes (issue 1-15): a File scoped to other OSes is not
   * applied where it doesn't belong.
   *
   * Maps faithfully to per-OS `.chezmoiignore` (ADR 0003, CONTEXT.md mapping). The request is
   * **clamped to the File's inherited Folder/Workspace Scope** by {@link MyenvStore.setFileScope}
   * (narrowable, never broadenable — issue 1-15), then the generated `.chezmoiignore` is
   * re-compiled from every File's effective Scope and committed with the `.myenv/` intent. The
   * Commit is LOCAL until the next Sync (ADR 0006), which carries the Scope to other environments.
   *
   * @param targetPath The managed File to scope (must already be placed).
   * @param scope The requested Scope (a subset of OSes), or `null` to clear the File's own
   *   restriction and fall back to pure inheritance.
   * @param traceId Correlation id for the wide event.
   * @returns The File's resulting EFFECTIVE Scope after clamping + inheritance.
   */
  async setFileScope(targetPath: string, scope: Scope, traceId: string): Promise<Scope> {
    const span = this.tracer?.startOperation('organize', traceId)
    try {
      // 1) Clamp + persist the File's own Scope under its inherited ceiling (the invariant).
      const effective = await this.store.setFileScope(targetPath, scope)
      // 2) Re-compile the native `.chezmoiignore` from the WHOLE Den's effective Scopes.
      await this.regenerateOsScopeIgnore()
      // 3) Commit the intent (`.myenv/`) + the regenerated ignore LOCALLY so the Scope travels.
      await this.commitMetadata(`Scope ${targetPath}`)
      span?.setAttribute('fileCount', 1)
      span?.end('ok')
      return effective
    } catch (error) {
      span?.end('error')
      throw error
    }
  }

  /**
   * **Scope a Folder (Group)** to specific OSes (issue 1-15) — its Files and child Groups
   * inherit the Scope, narrowable but never broadenable.
   *
   * Like {@link setFileScope} but for a Group: the request is clamped under the Group's
   * inherited ceiling, then the ignore file is re-compiled (every File under the Group now
   * reflects the narrowing) and committed LOCALLY.
   *
   * @param workspaceId The Workspace the Group lives in.
   * @param groupId The Group to scope.
   * @param scope The requested Scope, or `null` to clear the Group's own restriction.
   * @param traceId Correlation id for the wide event.
   * @returns The Group's resulting EFFECTIVE Scope after clamping + inheritance.
   */
  async setGroupScope(
    workspaceId: string,
    groupId: string,
    scope: Scope,
    traceId: string,
  ): Promise<Scope> {
    const span = this.tracer?.startOperation('organize', traceId)
    try {
      const effective = await this.store.setGroupScope(workspaceId, groupId, scope)
      await this.regenerateOsScopeIgnore()
      await this.commitMetadata(`Scope Group ${groupId}`)
      span?.end('ok')
      return effective
    } catch (error) {
      span?.end('error')
      throw error
    }
  }

  /**
   * Re-compile the native `.chezmoiignore` from the WHOLE Den's per-File **effective** OS
   * Scopes (issue 1-15) AND the per-environment Workspace subscription (issue 1-13).
   *
   * Reads every placement, folds each File's inheritance into an effective Scope
   * ({@link MyenvStore.effectiveScopeOf}), and hands the set to one of two single-writer
   * adapter methods so the OS-scope, subscription, and `.myenv/` concerns share ONE generated
   * file (never clobber each other, never drift):
   *
   * - When this environment has a `configPath` (so `[data].dotden_env_id` is in scope —
   *   production always does, issue 1-05), it emits the **subscription template** via
   *   {@link ChezmoiAdapter.writeSubscriptionIgnore}: the static OS-scoped-out lines PLUS a
   *   chezmoi Go-template block that ignores every File of an un-subscribed Workspace at apply
   *   time (ADR 0005). This is what makes one repo materialize different subsets per env.
   * - Without a `configPath` (config-less unit/e2e contexts that don't exercise subscription),
   *   it falls back to the static OS-scope-only file ({@link ChezmoiAdapter.writeOsScopeIgnore})
   *   — the template would reference an undefined `dotden_env_id` and error, so we don't emit it.
   *
   * Idempotent — safe to call after any Scope/placement/subscription change to keep the ignore
   * in lock-step with the synced intent.
   */
  private async regenerateOsScopeIgnore(): Promise<void> {
    const doc = await this.store.readWorkspaces()
    const scope = {
      currentOs: this.options.environment.os as Os,
      paths: doc.placements.map((p) => ({
        targetPath: p.targetPath,
        scope: this.store.effectiveScopeOf(doc, p.targetPath),
      })),
    }
    // The subscription template self-identifies via `[data].dotden_env_id`, which is only in
    // scope when a config file carries it — so emit it only when this env has one (issue 1-13).
    if (this.options.configPath) {
      // Mirror the own id into the local config BEFORE writing the template, so the very next
      // chezmoi command that evaluates `.chezmoiignore` (status/apply/re-add) always finds
      // `dotden_env_id` defined — never an "undefined .dotden_env_id" template error. Idempotent.
      await this.chezmoi.writeEnvId(this.options.environment.id)
      await this.chezmoi.writeSubscriptionIgnore(scope)
    } else {
      await this.chezmoi.writeOsScopeIgnore(scope)
    }
  }

  /**
   * Commit a `.myenv/`-only metadata edit LOCALLY (ADR 0006).
   *
   * The Workspace/Group/Scope operations touch only `.myenv/workspaces.json` and the
   * generated `.chezmoiignore` (which keeps `.myenv/` out of chezmoi's managed set AND
   * carries the OS-Scope rules, issue 1-15) — never chezmoi source state or any file on
   * disk. Staging just those paths keeps the commit scoped to the change. Local until the
   * next Sync, which is what carries the tree + Scope to a second environment (ADR 0024).
   *
   * @param message The git commit subject (e.g. "Create Workspace Work").
   */
  private async commitMetadata(message: string): Promise<void> {
    // `commitIfChanged`, not `commit`: an OS-Scope edit can be a CLAMP that leaves the
    // synced model byte-for-byte unchanged (a request to broaden past a Folder is clamped to
    // the existing Scope, issue 1-15), so there may be nothing to record. A plain commit
    // would fail "nothing to commit"; the idempotent variant makes that a clean no-op.
    await this.git.commitIfChanged(['.myenv', '.chezmoiignore'], message)
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
