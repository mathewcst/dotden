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
import { MyenvStore, type EnvironmentEntry, type WorkspacesDoc } from './myenv-store.js'
import type { OperationTracer } from './operation-tracer.js'
import { SyncEngine, type IncomingFile } from './sync-engine.js'

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
