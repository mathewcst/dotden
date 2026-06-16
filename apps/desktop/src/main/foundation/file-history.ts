/**
 * FileHistory — the pure read model behind the per-File **History tab** (issue 2-01).
 *
 * dotden's History in v1 is **per-File**: every version the user ever Committed for one
 * File, newest first (file-history.md screen spec; scope-v1.md "History"). Because every
 * Commit is already a real git commit (ADR 0003, faithful chezmoi wrapper), the version
 * list is **derived purely from `git log`** scoped to the File's source-state path — there
 * is NO separate history store (the issue's load-bearing acceptance criterion). This module
 * is the pure transform from `git log`'s machine-parsable stdout into the ordered
 * {@link FileVersion} list the renderer renders as `CommitRow`s; the I/O (running git and
 * resolving the File's source path) lives in {@link import('./den-service.js').DenService}.
 *
 * Keeping the parse pure (no shell, no Node) makes the ordering, short-SHA, and timestamp
 * rules unit-testable without a real repo, and keeps the foundation Electron-free (ADR 0023).
 */

/**
 * The field separator `git log --pretty` emits between fields, mirrored from
 * {@link import('./git-transport.js').GitTransport} so this parser splits the SAME format
 * the transport produces.
 *
 * ASCII Unit Separator (`\x1f`) — a control byte that cannot appear in a commit SHA,
 * author name/email, ISO date, or a one-line subject, so each line splits unambiguously.
 */
const GIT_LOG_SEP = '\x1f'

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

/**
 * Parse the raw `git log` stdout (scoped to one File) into the ordered version list.
 *
 * Expects exactly the format {@link import('./git-transport.js').GitTransport.log} emits:
 * one commit per line, fields `%H␟%an␟%ae␟%aI␟%s` joined by {@link GIT_LOG_SEP}, NEWEST
 * FIRST (git log's default order — the History tab shows newest first, file-history.md).
 *
 * The list is returned in the same newest-first order. The FIRST entry (the most recent
 * Commit that touched the File) is flagged {@link FileVersion.current} because it is the
 * version the File currently matches in the Den — the **Current** badge. An empty/whitespace
 * input (a File with no committed history yet, e.g. tracked-but-never-committed, or a brand
 * new repo) yields an empty list rather than throwing, so the tab shows an honest empty
 * state instead of an error (never fail silently).
 *
 * Parsing is total: a malformed line (missing fields) degrades each missing field to an
 * empty string rather than crashing the whole list, so one odd commit never blanks the tab.
 *
 * @param rawLog The stdout of `git log --pretty=format:%H␟%an␟%ae␟%aI␟%s -- <sourcePath>`.
 * @returns The File's versions, newest first, with the newest flagged `current`.
 */
export function parseFileHistory(rawLog: string): readonly FileVersion[] {
  const trimmed = rawLog.trim()
  if (trimmed.length === 0) return []
  const lines = trimmed.split('\n').filter((line) => line.length > 0)
  return lines.map((line, index) => {
    const [sha, authorName, authorEmail, committedAt, ...subjectParts] = line.split(GIT_LOG_SEP)
    return {
      // Defaults keep the parse total: a malformed line becomes empty fields, never a crash.
      sha: sha ?? '',
      shortSha: shortSha(sha ?? ''),
      // Re-join in case a (control-byte-free) subject somehow contained a separator.
      message: subjectParts.join(GIT_LOG_SEP),
      authorName: authorName ?? '',
      authorEmail: authorEmail ?? '',
      committedAt: committedAt ?? '',
      // The newest Commit (index 0) is the version the File currently matches → Current.
      current: index === 0,
    }
  })
}

/**
 * Shorten a full 40-char SHA to git's conventional 7-char display form.
 *
 * A non-SHA or already-short value is returned as-is (sliced at most to 7), so this never
 * throws on the malformed-line fallback above.
 *
 * @param sha The full commit SHA (or an empty/short fallback).
 * @returns The first 7 characters — the short SHA the `CommitRow` shows.
 */
export function shortSha(sha: string): string {
  return sha.slice(0, 7)
}
