/**
 * settings — IPC contract types shared by main + renderer (ADR 0031).
 * Moved out of foundation so the renderer speaks them without importing main.
 */

/**
 * How aggressively the TrayPoller checks the Remote (issue 2-08, maps onto {@link PollCadence}).
 *
 * - `fast` — the lively profile (≈2–5 min active · 15–30 min idle, scope-v1 "Poll cadence");
 *   the default, so incoming changes are noticed promptly.
 * - `relaxed` — a slower, battery-friendlier ceiling for a machine the user wants to keep quiet.
 *
 * Only the named *profile* is stored (never raw millisecond bounds), so the concrete cadence
 * numbers stay owned by the poller and can evolve without rewriting users' settings files.
 */
export type PollCadenceProfile = 'fast' | 'relaxed'

/**
 * The environment-local Sync preferences the Sync tab reads/writes (never synced — ADR 0024).
 */
export interface SyncSettings {
  /** Whether the always-on TrayPoller runs on this environment (default: on). */
  readonly pollerEnabled: boolean
  /** How aggressively the poller checks the Remote (default: `fast`). */
  readonly cadence: PollCadenceProfile
  /** Whether dotden starts at login so the tray/watcher is present (default: off). */
  readonly startOnLogin: boolean
}

/**
 * The environment-local telemetry-consent flags the Privacy tab reads/writes (never synced —
 * ADR 0024). INDEPENDENT opt-ins, all OFF by default so nothing leaves the environment unless
 * the user opts in.
 */
export interface PrivacySettings {
  /**
   * Consent to send anonymous, allowlisted usage **wide events** (ADR 0007). By construction
   * these can only carry the bounded Allowlisted attribute key set — never paths/contents/
   * secrets/repo URLs. Default: **off** (no usage data leaves the environment).
   */
  readonly analyticsEnabled: boolean
  /**
   * Consent to send a crash/error report (stack + app version) on an unexpected failure, so bugs
   * are diagnosable. Default: **off** (no crash report leaves the environment).
   */
  readonly crashReportsEnabled: boolean
  /**
   * Consent to attach anonymized diagnostic logs to a crash report so a hard-to-reproduce failure
   * is debuggable (same allowlisted-key discipline as analytics). Default: **off**.
   */
  readonly diagnosticLogsEnabled: boolean
}

/**
 * What to do with the Files of a Workspace this environment just un-subscribed from.
 *
 * - `keep` — leave the Files on disk as untracked orphans (chezmoi simply stops managing
 *   them); nothing is deleted. Safe default.
 * - `remove` — explicitly delete the Files from this environment's disk (a `chezmoi forget`
 *   + target-remove), because `.chezmoiignore` alone never removes them.
 */
export type UnsubscribeDisposition = 'keep' | 'remove'
