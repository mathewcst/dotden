/**
 * UpdateCheck — the update-check engine behind the Settings → About tab.
 *
 * The About tab needs a "Check for updates" affordance so the user can confirm they are current,
 * and the main process needs a real feed-backed seam for background update checks.
 *
 * It is intentionally **pure + Electron-free** (ADR 0023): it takes the current version and an
 * injectable {@link UpdateFeed}. `index.ts` adapts electron-updater's GitHub provider into this
 * pure seam; tests can still use {@link noFeed} or a fake feed.
 */
import type { UpdateCheckResult } from '../../../shared/app-info.js'

/**
 * The pluggable source of "is there a newer release?" knowledge.
 *
 * The placeholder feed ({@link noFeed}) always reports there is no reachable feed. The production
 * feed is backed by electron-updater in `index.ts`; this contract stays Electron-free.
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
 * The placeholder feed used when updater support is unavailable.
 *
 * It always reports the feed is unreachable with an honest reason. This keeps the About tab's check
 * truthful: it says "couldn't check — no update feed is configured for this build yet", not a
 * misleading "you're current".
 */
export const noFeed: UpdateFeed = {
  latest: async () => ({
      unavailable: 'No update feed is available for this build.',
  }),
}

/**
 * Run an update check for `currentVersion` against `feed`, returning the About tab's result.
 *
 * The comparison is deliberately a plain string equality between the current and latest versions:
 * electron-updater already performs the semver comparison itself for the production feed, so this
 * seam never needs to parse semver — it just shapes the feed's answer into the shared
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
