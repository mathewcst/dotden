/**
 * environments — IPC contract types shared by main + renderer (ADR 0030).
 * Moved out of foundation so the renderer speaks them without importing main.
 */

/**
 * Git-log-derived attribution for one environment — NEVER persisted (ADR 0024).
 *
 * Computed live from `git log` on each read so the synced registry never carries
 * activity fields that would churn on every Sync. Absent values mean "no activity
 * recorded yet" (a fresh Den, or an environment that has not Committed).
 */
export interface EnvironmentAttribution {
  /** Author name of this environment's most recent Commit, when any. */
  readonly lastAuthorName?: string
  /** Author email of that Commit, when any. */
  readonly lastAuthorEmail?: string
  /** ISO-8601 timestamp of that Commit — the "last sync / last active" surface. */
  readonly lastActivityAt?: string
  /** Subject line of that Commit, for an at-a-glance "what changed". */
  readonly lastSubject?: string
  /** Total number of Commits attributable to this environment's label/author. */
  readonly commitCount: number
}

/** A registry entry joined with its live git-log attribution, for the Environments surface. */
export interface EnvironmentWithAttribution extends EnvironmentEntry {
  /** Whether this entry is THIS running environment (the one holding the local id). */
  readonly isSelf: boolean
  /** Activity derived from git log on read — never stored in the registry. */
  readonly attribution: EnvironmentAttribution
}

/**
 * A suggested returning-claim match for a fresh install with no local id (issue 1-13).
 *
 * The fork suggests the likely existing entry by OS + the setup-time hostname; the
 * user still explicitly chooses to claim it (or start new) — dotden never auto-merges.
 */
export interface ClaimSuggestion {
  /** The candidate registry entry the user might be "returning" to. */
  readonly entry: EnvironmentEntry
  /** Why it is a candidate: same OS, and/or its label matches the setup-time hostname. */
  readonly reasons: readonly ('same-os' | 'hostname-match')[]
}

/**
 * One suggested config File (or Folder) the scan found on disk.
 *
 * Carries enough for the Discover UI to render a `ListRow`: the path to show, the
 * tool it belongs to (for grouping), whether it is a Folder (so the copy can say
 * "Folder" vs "File", CONTEXT.md), and its size for the row's `Meta` slot.
 */
export interface DiscoverySuggestion {
  /** Destination-relative path of the found config (e.g. `.zshrc`), the Track target. */
  readonly targetPath: string
  /** Id of the catalog tool this path belongs to (groups the Discover list). */
  readonly toolId: string
  /** Human label of that tool, for the group header. */
  readonly toolLabel: string
  /** True when the path is a directory — a managed **Folder**, not a single **File**. */
  readonly isFolder: boolean
  /** Size in bytes (a File's own size, or 0 for a Folder); drives the row's size meta. */
  readonly sizeBytes: number
}

/** The three launch states the gate distinguishes (ADR 0026). */
export type LaunchStatus = 'fresh' | 'incomplete' | 'ready'

/** The launch-gate result the renderer maps to an initial route. */
export interface LaunchState {
  /** Which setup state THIS environment is in (drives the boot route). */
  readonly status: LaunchStatus
}

/**
 * One environment's registry entry (ADR 0024).
 *
 * Identity is the **stable random `id`**, never the hostname (hostnames collide
 * and change). `label` defaults from the hostname but is user-editable.
 * `subscribedWorkspaces` is the access boundary: this environment applies only
 * Files inside Workspaces it subscribes to (ADR 0005).
 */
export interface EnvironmentEntry {
  /** Stable random identity for this environment — the source of truth, not the hostname. */
  readonly id: string
  /** User-editable display label, defaulting from the hostname on first run. */
  readonly label: string
  /** Operating system this environment runs on (`process.platform` value). */
  readonly os: string
  /** Workspace ids this environment subscribes to; only these Files apply here (ADR 0005). */
  readonly subscribedWorkspaces: readonly string[]
}

/**
 * Result of a {@link DiscoveryScanner.scan}.
 *
 * Suggestions are flat (the UI groups them by `toolId`); the count is surfaced
 * separately so the Discover step can drive empty/"found N" copy without re-counting.
 */
export interface DiscoveryScanResult {
  /** Every config File/Folder the scan found, grounded in the catalog. */
  readonly suggestions: readonly DiscoverySuggestion[]
}
