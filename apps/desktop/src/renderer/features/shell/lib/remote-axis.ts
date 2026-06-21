import type { RemoteAxisMarker } from '@shared/den'

/**
 * The `@pierre/trees` `renderRowDecoration` return shape for one row's Remote axis.
 *
 * `renderRowDecoration` paints a non-interactive overlay lane that the 1-00 spike
 * proved lands directly LEFT of the local git-status letter (`↓ M`, `⚠ U`) with a gap
 * and no clipping. Returning `null` means "no Remote-axis glyph for this row".
 */
export interface RemoteAxisDecoration {
  /** The glyph painted in the overlay lane: `↓` incoming or `⚠` conflict. */
  readonly text: string
  /** Tooltip explaining the marker (never fail silently — the user sees what it means). */
  readonly title: string
}

/**
 * Map a File's **Remote-axis marker** (the SECOND status axis) to the glyph the tree's
 * `renderRowDecoration` overlay paints beside the local git-status letter (issue 1-09,
 * geometry per the 1-00 spike).
 *
 * The local axis (M/A/D/R/U) is owned by `setGitStatus`; this is the independent Remote
 * axis — what the Remote has for the File that this environment has not applied yet:
 * - `incoming` → `↓` (a clean incoming change, blue in the spec);
 * - `conflict` → `⚠` (changed both here and on the Remote — handed to the ConflictModel
 *   owner, issue 1-11; shown so the user sees it, never auto-resolved).
 *
 * A File with no incoming marker returns `null` (no overlay glyph). Kept as a pure
 * function (no React, no DOM) so it is trivially unit-testable and the same mapping
 * drives both the tree decoration lane and the Review surface.
 *
 * @param marker The File's Remote-axis marker, or `undefined` when nothing is incoming.
 * @returns The overlay glyph + tooltip, or `null` for no Remote-axis decoration.
 */
export function remoteAxisDecoration(
  marker: RemoteAxisMarker | undefined,
): RemoteAxisDecoration | null {
  switch (marker) {
    case 'incoming':
      return { text: '↓', title: 'Incoming change from the Remote' }
    case 'conflict':
      return { text: '⚠', title: 'Conflict — resolve before applying' }
    default:
      return null
  }
}
