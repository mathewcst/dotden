/**
 * App-info & update-check contract — the SHARED, pure shape behind the Settings → About tab
 * (issue 2-16, stories 52–53).
 *
 * The About tab answers three questions, all honestly (never fail silently):
 * 1. **What version am I on?** — {@link AppInfo.version}, the running dotden build.
 * 2. **Am I current?** — the result of an {@link UpdateCheckResult update check}.
 * 3. **How should updates behave here?** — {@link UpdateSettings}, persisted per environment.
 * 4. **What is dotden built on?** — the **chezmoi credit** ({@link CHEZMOI_CREDIT}); dotden is a
 *    FAITHFUL WRAPPER over chezmoi (ADR 0003), so the relationship is acknowledged in the UI.
 *
 * This module is the SINGLE source of truth for those shapes + the pure copy/derivation helpers,
 * shared by the renderer (the tab) and the main process (the IPC handlers), so neither end can
 * drift. It is intentionally **pure** — no Electron, no Node, no I/O — so it imports cleanly into
 * the renderer bundle (ADR 0023) and its decisions are unit-testable in plain Node.
 *
 * Auto-update mechanics stay in the main process; this file only carries typed shared data and
 * pure copy helpers.
 */

/**
 * The running app's identity, read once for the About tab.
 *
 * `version` is the canonical app version (the packaged `app.getVersion()` in production, the
 * `package.json` version in dev). `platform` is surfaced purely as a diagnostic hint next to the
 * version so a bug report can name the OS — it is NOT used to gate anything.
 */
export interface AppInfo {
  /** The running dotden build version (semver, e.g. `1.2.0`). */
  readonly version: string
  /** Host platform string (`darwin`/`win32`/`linux`/…), shown as a diagnostic hint only. */
  readonly platform: string
}

/**
 * The outcome of an update check — a discriminated status the About tab renders verbatim.
 *
 * - **`up-to-date`** — the check ran and this build is the latest.
 * - **`update-available`** — a newer version exists; {@link UpdateCheckResult.latestVersion}
 *   carries it so the tab can name it.
 * - **`unavailable`** — the check could not be performed (no published feed yet, offline, or the
 *   updater is disabled in this build). The tab says "couldn't check" + why, never a fake "you're
 *   up to date".
 */
export type UpdateCheckStatus = 'up-to-date' | 'update-available' | 'unavailable'

/** The result of an update check. */
export interface UpdateCheckResult {
  /** Which of the three outcomes this check produced. */
  readonly status: UpdateCheckStatus
  /** The version that was checked (the running build), echoed back so the tab can compare. */
  readonly currentVersion: string
  /**
   * The latest version the feed advertised, when known. Present for `update-available` (the newer
   * version) and may be present for `up-to-date` (equal to current); `null` when the check could
   * not reach a feed (`unavailable`).
   */
  readonly latestVersion: string | null
  /**
   * A short, human reason — ALWAYS set for `unavailable` so the tab explains why it couldn't check
   * (never a silent failure); `null` otherwise.
   */
  readonly detail: string | null
  /** ISO timestamp when this check completed. Drives About's last-checked surface. */
  readonly checkedAt: string
}

/** Which release channel the updater should consult. */
export type UpdateChannel = 'stable' | 'beta'

/** Environment-local update preferences for the About tab. */
export interface UpdateSettings {
  /** Whether background checks/downloads run automatically. Manual checks remain available. */
  readonly autoUpdateEnabled: boolean
  /** Release channel to check. */
  readonly channel: UpdateChannel
  /** Last completed update-check time, or null when never checked. */
  readonly lastCheckedAt: string | null
}

/** A downloaded update waiting for an explicit user restart/install confirmation. */
export interface DownloadedUpdate {
  /** Version that was downloaded. */
  readonly version: string
  /** Release name when the feed provides it. */
  readonly releaseName: string | null
  /** Release date when the feed provides it. */
  readonly releaseDate: string | null
}

/**
 * The chezmoi credit shown in the About tab — the faithful-wrapper acknowledgement (ADR 0003).
 *
 * dotden is the GUI; the user's Den stays a plain chezmoi repository they can drive from the
 * command line at any time. Crediting chezmoi here keeps that relationship honest and visible.
 */
export const CHEZMOI_CREDIT = {
  /** The tool dotden wraps. */
  name: 'chezmoi',
  /** Its home, for the resource link. */
  url: 'https://www.chezmoi.io',
  /** The one-line acknowledgement copy (brand voice; design: settings.md "About"). */
  blurb:
    'dotden is a graphical front-end for chezmoi. Your Den stays a plain chezmoi repository — every action here maps to a real chezmoi command, and you can always reach for the command line.',
} as const

/**
 * Map an {@link UpdateCheckResult} to the one-line headline the About tab shows.
 *
 * Pure presentation — the single place the three statuses become copy, so the tab and its tests
 * agree. The `unavailable` headline is deliberately honest ("Couldn't check for updates") rather
 * than reassuring, because a failed check must never look like a successful "you're current".
 */
export function describeUpdateStatus(result: UpdateCheckResult): string {
  switch (result.status) {
    case 'up-to-date':
      return `You're on the latest version (${result.currentVersion}).`
    case 'update-available':
      return result.latestVersion
        ? `Version ${result.latestVersion} is available — you have ${result.currentVersion}.`
        : `An update is available — you have ${result.currentVersion}.`
    case 'unavailable':
      return "Couldn't check for updates."
  }
}

/**
 * Whether an update-check headline should read as a problem (so the tab can tone it).
 *
 * `unavailable` is the only non-reassuring outcome — the check didn't run — so it reads in the
 * muted/warning tone; the other two are normal informational states.
 */
export function isUpdateCheckUnavailable(result: UpdateCheckResult): boolean {
  return result.status === 'unavailable'
}
