/**
 * history — IPC contract types shared by main + renderer (ADR 0031).
 * Moved out of foundation so the renderer speaks them without importing main.
 */

/**
 * One version of a File in its Commit history — a single `git log` entry scoped to the
 * File, shaped for the History tab's `CommitRow` (file-history.md).
 *
 * Every field is what the row shows so it can be recognised: the Commit message, a short
 * SHA, a readable timestamp, and the author. {@link sha} is the FULL 40-char SHA (the
 * stable handle the preview + a later Restore use); {@link shortSha} is the 7-char display
 * form. {@link current} marks the version that matches the current Den state (the tip that
 * the File is at right now) so the list can badge it **Current**.
 */
export interface FileVersion {
  /** Full 40-char commit SHA — the stable handle for the preview/diff + restore (issue 2-02). */
  readonly sha: string
  /** The 7-char short SHA the row displays (e.g. `7b1e44`), derived from {@link sha}. */
  readonly shortSha: string
  /** The Commit message subject the user recognises the version by. */
  readonly message: string
  /** The author's name (the environment label, per dotden's commit identity). */
  readonly authorName: string
  /** The author's email, for completeness/attribution (not always shown). */
  readonly authorEmail: string
  /** The author date in strict ISO-8601 (e.g. `2026-06-16T10:30:00-03:00`) for a readable timestamp. */
  readonly committedAt: string
  /**
   * `true` for the version that matches the current Den state — the most recent Commit
   * that touched this File (the tip of its history). The renderer badges it **Current**
   * (file-history.md) so the user can tell which version is live. Exactly one version in a
   * non-empty list is `current` (the newest), or none when the list is empty.
   */
  readonly current: boolean
}
