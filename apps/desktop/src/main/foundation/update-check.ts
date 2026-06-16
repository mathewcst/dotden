/**
 * UpdateCheck — the placeholder update-check engine behind the Settings → About tab (issue 2-16).
 *
 * The About tab needs a "Check for updates" affordance so the user can confirm they are current.
 * The REAL engine — electron-updater polling the GitHub Releases feed, with a download/install
 * path — is PRD 3 (issue 3-20). This slice builds the **surface only**: a pure function that, in
 * the absence of a published feed, returns an honest {@link UpdateCheckResult} of status
 * `'unavailable'` with a reason — never a fake "you're up to date" (never fail silently).
 *
 * It is intentionally **pure + Electron-free** (ADR 0023): it takes the current version and an
 * injectable {@link UpdateFeed} so the placeholder is unit-testable and issue 3-20 can drop in a
 * real electron-updater-backed feed by passing a different `feed` — a config change, not a rewrite
 * of this seam. index.ts supplies the current version (`app.getVersion()`) and, today, the
 * `noFeed` placeholder feed.
 */
import type { UpdateCheckResult } from '../../shared/app-info.js'

/**
 * The pluggable source of "is there a newer release?" knowledge.
 *
 * The placeholder feed ({@link noFeed}) always reports there is no reachable feed. Issue 3-20
 * implements a real one over electron-updater's GitHub provider; the {@link checkForUpdates}
 * contract (and therefore the IPC + UI) stays identical, so the swap is contained here.
 */
export interface UpdateFeed {
  /**
   * Resolve the latest published version, or a structured "no feed" signal.
   *
   * @param currentVersion The running build, so a real feed can compare without re-reading it.
   * @returns `{ latestVersion }` when a feed answered; `{ unavailable: reason }` when no feed
   *   could be reached (the placeholder's only answer). NEVER throws for "no feed" — a missing
   *   feed is an expected, surfaced state, not an error.
   */
  latest(
    currentVersion: string,
  ): Promise<{ readonly latestVersion: string } | { readonly unavailable: string }>
}

/**
 * The placeholder feed used until issue 3-20 wires the real GitHub Releases feed.
 *
 * It always reports the feed is unreachable with the honest reason that no published update feed
 * exists yet — mirroring the inert `autoUpdater.checkForUpdatesAndNotify()` already in index.ts
 * (which resolves with nothing actionable in the scaffold). This keeps the About tab's check
 * truthful: it says "couldn't check — no update feed is configured for this build yet", not a
 * misleading "you're current".
 */
export const noFeed: UpdateFeed = {
  latest: async () => ({
    unavailable: 'No update feed is configured for this build yet.',
  }),
}

/**
 * Run an update check for `currentVersion` against `feed`, returning the About tab's result.
 *
 * The comparison is deliberately a plain string equality between the current and latest versions:
 * the placeholder never returns a real `latestVersion`, and issue 3-20's electron-updater feed
 * already performs the semver comparison itself (it tells us whether an update is available), so
 * this seam never needs to parse semver — it just shapes the feed's answer into the shared
 * {@link UpdateCheckResult}.
 *
 * @param currentVersion The running build version (from `app.getVersion()`).
 * @param feed The update feed; {@link noFeed} until issue 3-20.
 * @returns An honest result: `unavailable` (with a reason) when no feed answered, `up-to-date`
 *   when the latest equals current, or `update-available` (naming the newer version) otherwise.
 */
export async function checkForUpdates(
  currentVersion: string,
  feed: UpdateFeed = noFeed,
): Promise<UpdateCheckResult> {
  const answer = await feed.latest(currentVersion)

  // No reachable feed — the placeholder's path today. Surface the reason, never fake "current".
  if ('unavailable' in answer) {
    return {
      status: 'unavailable',
      currentVersion,
      latestVersion: null,
      detail: answer.unavailable,
    }
  }

  // A feed answered (the issue-3-20 path): up-to-date when equal, otherwise an update is available.
  const upToDate = answer.latestVersion === currentVersion
  return {
    status: upToDate ? 'up-to-date' : 'update-available',
    currentVersion,
    latestVersion: answer.latestVersion,
    detail: null,
  }
}
