import type { RemoteAxisMarker } from '@shared/den'

/**
 * The display data for one row's Remote axis decoration.
 *
 * The tree paints this non-interactive marker beside the local git-status letter
 * (`↓ M`, `⚠ U`). Returning `null` means "no Remote-axis glyph for this row".
 */
export interface RemoteAxisDecoration {
  /** The glyph painted in the overlay lane: `↓` incoming or `⚠` conflict. */
  readonly text: string
  /** Tooltip explaining the marker (never fail silently — the user sees what it means). */
  readonly title: string
}

/**
 * Map a File's **Remote-axis marker** (the SECOND status axis) to the glyph the tree's
 * row paints beside the local git-status letter (issue 1-09).
 *
 * The local axis (M/A/D/R/U) is independent from this Remote
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

/** Format the global Remote-axis summary shown in shell chrome. */
export function remoteAxisSummary(remoteAxis: ReadonlyMap<string, RemoteAxisMarker>): string {
  const total = remoteAxis.size
  if (total === 0) return 'Up to date'
  const conflicts = [...remoteAxis.values()].filter((marker) => marker === 'conflict').length
  if (conflicts === 0) return `${total} incoming`
  return `${total} incoming, ${conflicts} conflict${conflicts === 1 ? '' : 's'}`
}
