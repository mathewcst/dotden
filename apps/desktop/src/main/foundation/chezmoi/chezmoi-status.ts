/**
 * chezmoi-status — parse `chezmoi status` porcelain into dotden's local status axis.
 *
 * This is the pure, Electron-free (ADR 0023) translator that turns the bundled
 * `chezmoi status` output into the **local axis** the three-pane File tree renders
 * (issue 1-07). The renderer shows the {@link FileGitStatus} list this produces as a
 * coloured M/A/D/R/U letter beside each File row.
 *
 * ## chezmoi status format (the faithful mapping, ADR 0003)
 *
 * `chezmoi status` prints one line per changed managed File as `XY <path>`. Per
 * `chezmoi help status`, the two columns are (verified empirically against the
 * bundled binary):
 * - **column 1 / X** = the difference between the last state chezmoi *wrote* and the
 *   *actual* state on disk — i.e. the **local edit the user made on THIS environment**
 *   (`Entry was created/deleted/modified`);
 * - **column 2 / Y** = the difference between the *actual* state and the *target*
 *   state, i.e. **what `chezmoi apply` will do** — the *incoming-from-source* change
 *   (`Entry will be created/deleted/modified`, or `Script will be run`).
 *
 * dotden's local axis is "what changed on THIS environment", so the local axis reads
 * column **X only**. Issue 1-07 is the *local axis only*; the incoming/Remote axis
 * (the ↓/⚠ rendering driven by column Y) is issue 1-09 — folding Y in here would put
 * incoming-only changes (which the user never touched locally) onto the wrong axis.
 *
 * Empirical column shapes (bundled chezmoi v2):
 * - local edit → `MM <path>` (X=M local-modify, Y=M apply-will-modify) → **modified**;
 * - local delete → `DA <path>` (X=D local-delete, Y=A apply-will-re-add) → **deleted**;
 * - incoming-only modify → ` M <path>` (X=blank, Y=M) → **no local decoration**;
 * - incoming-only add → ` A <path>` (X=blank, Y=A) → **no local decoration**;
 * - pending run-script → ` R <path>` (X blank — `R` is "Not applicable" to column 1
 *   per chezmoi's table; it only ever appears in column 2) → **no local decoration**.
 *
 * Per-column codes are single characters: `A` added, `D` deleted, `M` modified, or a
 * space (no change in that column). The mapping of the **X** column onto the
 * dotden File status vocabulary is `M → modified`, `A → added`,
 * `D → deleted`. `untracked`/`renamed`/`ignored` are NOT emitted here: chezmoi only
 * reports *managed* Files, renames surface as add+delete, and `ignored` (the muted,
 * out-of-OS-Scope rendering, issue 1-15) is layered on by the caller from
 * `.chezmoiignore`, not from `status`.
 */
import type { FileGitStatus } from '../../../shared/den.js'
import type { FileGitStatusCode } from '../../../shared/den.js'

/** What the incoming/apply-direction status column says Apply would do. */
export type IncomingApplyStatus = 'add' | 'modify' | 'delete'

/**
 * Translate one chezmoi status column character into dotden's local-axis code.
 *
 * Returns `null` for a blank/unrecognized column (including `R`, which chezmoi only
 * ever emits in the *incoming* column — issue 1-09's axis — never the local column),
 * so a row with no local change degrades to "no decoration" rather than inventing a
 * status (never fail silently).
 *
 * @param code A single status column character from a `chezmoi status` line.
 */
function codeToStatus(code: string): FileGitStatusCode | null {
  switch (code) {
    case 'M':
      return 'modified'
    case 'A':
      return 'added'
    case 'D':
      return 'deleted'
    // `R` (a script to run) and a blank space both mean "no local change on this
    // environment" for the X column: per `chezmoi help status` `R` is "Not applicable"
    // to column 1, surfacing only in column 2 (the incoming axis, issue 1-09).
    default:
      return null
  }
}

/**
 * Parse raw `chezmoi status` stdout into the dotden local-axis status list.
 *
 * Each non-empty line is `XY <path>`: the first two characters are the status
 * columns and the remainder (after a single separating space) is the
 * destination-relative File path. Only column **X** (column 1 — the local edit on
 * THIS environment) drives the local axis; column Y (what `chezmoi apply` will do)
 * is the *incoming* axis owned by issue 1-09 and is deliberately ignored here, so an
 * incoming-only change (` M`/` A`, X blank) yields no local decoration. Lines whose
 * X column reports no local change, or that carry no path, are skipped, so malformed
 * or incoming-only output degrades to "no decoration" rather than throwing.
 *
 * @param raw The exact stdout from {@link import('./chezmoi-adapter.js').ChezmoiAdapter.status}.
 * @returns One {@link FileGitStatus} per changed managed File, in input order.
 */
export function parseChezmoiStatus(raw: string): FileGitStatus[] {
  const out: FileGitStatus[] = []
  for (const line of raw.split('\n')) {
    // chezmoi pads to exactly two status columns then a space then the path; a
    // line shorter than that (or blank) has no File to decorate.
    if (line.length < 4) continue
    const x = line[0] ?? ' '
    // The path begins after the two columns and the single separating space.
    const path = line.slice(3).trim()
    if (path.length === 0) continue
    // Column X (column 1 — last-written-vs-actual) is the local edit on THIS
    // environment, and the *only* column the local axis reads. Column Y (the
    // incoming/apply-direction change) is issue 1-09's Remote axis; ignoring it here
    // keeps incoming-only changes (X blank) off the local axis entirely.
    const status = codeToStatus(x)
    if (status === null) continue
    out.push({ path, status })
  }
  return out
}

/**
 * Parse the destination-relative paths chezmoi will **delete** on the next Apply — the
 * incoming-deletion axis (issue 1-10).
 *
 * Reads **column Y only** (column 2 — actual-vs-target = what `chezmoi apply` will do)
 * and keeps lines where Y is `D` ("Entry will be deleted"): the source state removed the
 * File, so applying would remove it from the destination. This is the faithful signal
 * that surfaces an incoming deletion as a first-class, confirm-required plan item
 * ({@link import('./apply-planner.js').planIncoming}, invariant #4) — never auto-applied.
 *
 * Column X (the LOCAL edit) is deliberately ignored here: a File the user locally deleted
 * (X=D) is the local axis, not an incoming deletion. Only Y=D means "the Remote removed
 * it and Apply would delete it here".
 *
 * @param raw The exact stdout from {@link import('./chezmoi-adapter.js').ChezmoiAdapter.status}.
 * @returns The destination-relative paths an Apply would delete, in input order.
 */
export function parseIncomingDeletions(raw: string): string[] {
  const out: string[] = []
  for (const line of raw.split('\n')) {
    if (line.length < 4) continue
    // Column Y is the second status column (apply-direction); `D` = will-be-deleted.
    const y = line[1] ?? ' '
    const path = line.slice(3).trim()
    if (path.length === 0) continue
    if (y === 'D') out.push(path)
  }
  return out
}

/**
 * Parse the incoming/apply-direction column (Y) for every changed destination-relative File.
 *
 * Unlike {@link parseChezmoiStatus}, this reads column Y because Review & Apply needs to know what
 * the updated source state would do here: add, modify, or delete a File.
 */
export function parseIncomingApplyChanges(raw: string): Map<string, IncomingApplyStatus> {
  const out = new Map<string, IncomingApplyStatus>()
  for (const line of raw.split('\n')) {
    if (line.length < 4) continue
    const y = line[1] ?? ' '
    const path = line.slice(3).trim()
    if (path.length === 0) continue
    if (y === 'A') out.set(path, 'add')
    else if (y === 'M') out.set(path, 'modify')
    else if (y === 'D') out.set(path, 'delete')
  }
  return out
}
