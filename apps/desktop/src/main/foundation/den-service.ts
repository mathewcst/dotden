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
import { ChezmoiAdapter } from './chezmoi-adapter.js'
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
import { parseChezmoiStatus, type FileGitStatus } from './chezmoi-status.js'

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

/** One incoming File shown to the user for a reviewed Apply (env B). */
export interface IncomingReviewItem {
  /** Destination-relative File path arriving from the Remote (e.g. `.zshrc`). */
  readonly targetPath: string
  /** Workspace the File belongs to, from the synced `.myenv/` placements. */
  readonly workspaceId: string
}

/** Result of applying reviewed incoming Files to disk (env B). */
export interface ApplyResult {
  /** The destination-relative File paths actually written to disk by `chezmoi apply`. */
  readonly applied: readonly string[]
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
   * @param options Binaries, dirs, this environment's identity, and an optional tracer.
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
      span?.end('ok')
      return {
        message: rendered.message,
        templateId: rendered.templateId,
        templateLabel: rendered.templateLabel,
        committedFiles: [...targetPaths],
        // A Commit is local until pushed (ADR 0006). syncPush() is what sends it.
        pushed: false,
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
   * **env B** — fetch the Remote and present incoming Files for a reviewed Apply,
   * restricted to the **incoming-clean** path (ADR 0008).
   *
   * Maps to `git fetch` + read the synced `.myenv/` placements, then route through
   * {@link SyncEngine}: only Files that are incoming-clean AND applicable to this
   * environment (an {@link import('./applicability-resolver.js').AppliesHere} witness
   * is minted for each) appear for review. Conflicting or non-subscribed Files are
   * deferred, never silently applied.
   *
   * @param traceId Correlation id for the wide event.
   * @returns The reviewable incoming Files (path + Workspace), for the inspector UI.
   */
  async listIncomingClean(traceId: string): Promise<readonly IncomingReviewItem[]> {
    const span = this.tracer?.startOperation('sync', traceId)
    try {
      await this.git.fetch()
      const incoming = await this.computeIncoming()
      const { environment, workspaces } = await this.loadSyncedModel()
      const engine = new SyncEngine({ environment, workspaces, tracer: this.tracer })
      const { plan } = engine.routeIncomingClean(incoming, traceId)
      const placementOf = new Map(workspaces.placements.map((p) => [p.targetPath, p.workspaceId]))
      const items = plan.items.map((item) => ({
        targetPath: item.witness.targetPath,
        // The witness only exists for placed Files, so this lookup always resolves.
        workspaceId: placementOf.get(item.witness.targetPath) ?? '',
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
   * **env B** — apply reviewed incoming Files to disk.
   *
   * Maps to `chezmoi apply <files>` (the Apply verb). The caller passes the exact
   * paths the user reviewed; this re-routes them through {@link SyncEngine} so the
   * write is still witness-gated (a path that turned non-applicable between review
   * and apply is dropped, never written) — defense in depth for invariant #3.
   *
   * @param targetPaths The reviewed File paths to write.
   * @param traceId Correlation id for the wide event.
   * @returns The Files actually applied (a subset if any became non-applicable).
   */
  async applyIncoming(targetPaths: readonly string[], traceId: string): Promise<ApplyResult> {
    const span = this.tracer?.startOperation('apply', traceId)
    try {
      const { environment, workspaces } = await this.loadSyncedModel()
      const engine = new SyncEngine({ environment, workspaces })
      // Re-route the reviewed paths as incoming-clean so only witness-backed Files
      // are written: SyncEngine refuses to plan a non-applicable File.
      const { plan } = engine.routeIncomingClean(
        targetPaths.map((targetPath) => ({ targetPath, status: 'incoming-clean' as const })),
        traceId,
      )
      const applied = plan.items.map((item) => item.witness.targetPath)
      if (applied.length > 0) await this.chezmoi.apply(applied)
      span?.setAttribute('fileCount', applied.length)
      span?.end('ok')
      return { applied }
    } catch (error) {
      span?.end('error')
      throw error
    }
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
   * Classify incoming Files for the incoming-clean path.
   *
   * MVP slice: every placed File in `.myenv/` that is NOT yet present on this
   * environment's disk is incoming-clean (no local copy → no Conflict). A File that
   * already exists locally is dropped from "incoming" here (the fuller update/diff
   * path is the Review & Apply slice, 1-09). Reading placements from the synced
   * model is what lets env B discover Files it has never seen.
   */
  private async computeIncoming(): Promise<readonly IncomingFile[]> {
    const { placements } = await this.store.readWorkspaces()
    const incoming: IncomingFile[] = []
    for (const placement of placements) {
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
