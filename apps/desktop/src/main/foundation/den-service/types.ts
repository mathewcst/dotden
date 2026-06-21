/**
 * den-service internal types — the construction wiring + poll snapshot that are
 * **main-side only**, not part of the IPC contract.
 *
 * These differ from the DTOs in `src/shared/den.ts` (which the renderer speaks across
 * the boundary): {@link DenServiceOptions} references main-only collaborators
 * ({@link OperationTracer}) and {@link PollSnapshot} is consumed by the in-process
 * `TrayPoller`. They never cross IPC, so they co-live with the service that owns them
 * (ADR 0029 capability folders) rather than in the cross-process contract (ADR 0031).
 */

import type { EnvironmentEntry } from '../../../shared/environments.js'
import type { OperationTracer } from '../platform/operation-tracer.js'
import type { AutomationLevel } from '../../../shared/apply.js'
import type { DiagnosticsSink } from '../diagnostics/command-log.js'

/** Construction wiring for a {@link import('./den-service.js').DenService}, bound to one environment's dirs. */
export interface DenServiceOptions {
  /** Path to the bundled chezmoi binary. */
  readonly chezmoiBin: string
  /** Path to the bundled git binary. */
  readonly gitBin: string
  /** chezmoi source dir = the git-tracked Den repo, holding `.dotden/` + source state. */
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
  /** This environment's identity, label and OS (its subscriptions live in `.dotden/`). */
  readonly environment: Pick<EnvironmentEntry, 'id' | 'label' | 'os'>
  /** Shared tracer so each Operation emits one wide event (ADR 0007); optional in tests. */
  readonly tracer?: OperationTracer
  /**
   * This environment's selected {@link AutomationLevel} (issue 1-12) — the rung the
   * {@link AutomationPolicy} gates by. It is **environment-local** (CONTEXT.md "Auto-sync"),
   * read from {@link import('../apply/automation-settings.js').readAutomationLevel} in production
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
  /**
   * The Electron `userData` dir this environment stores its **environment-local** password-manager
   * preference under (issue 2-05). The "Remember my choice" toggle persists the preferred manager
   * here via {@link import('../secrets/pm-preference.js')} — it is a property of THIS computer's installed
   * tools, never synced (ADR 0024). `index.ts` passes `app.getPath('userData')`; omitted in tests
   * that don't exercise the remembered preference (in which case {@link DenService.pmPreference}
   * reports "no preference").
   */
  readonly userDataDir?: string
  /** Shared redacted command diagnostics sink for the chezmoi/git wrappers. */
  readonly diagnosticsSink?: DiagnosticsSink
}

/**
 * A snapshot the {@link import('../system/tray-poller.js').TrayPoller} needs to watch the Remote
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
