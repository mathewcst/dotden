/**
 * apply — IPC contract types shared by main + renderer (ADR 0030).
 * Moved out of foundation so the renderer speaks them without importing main.
 */

/**
 * The user's three-way resolution of one conflicting File — the only inputs that can
 * mint resolved bytes. The names map 1:1 onto the UI's Keep mine / Take theirs / Open
 * both, and onto `@pierre/diffs`' `MergeConflictResolution` union so the merge view's
 * choice flows straight through without translation:
 *
 * - `current` — **Keep mine**: the bytes this environment Committed (git's "ours"/HEAD).
 * - `incoming` — **Take theirs**: the bytes the Remote Committed (git's "theirs").
 * - `both` — **Open both**: the union with the `<<<<<<<`/`=======`/`>>>>>>>` markers
 *   left in, so the user consciously hand-edits the merged result. Still an explicit
 *   choice — never an automatic union.
 */
export type ResolutionChoice = 'current' | 'incoming' | 'both'

/**
 * The rungs of dotden's automation ladder (CONTEXT.md).
 *
 * - `manual` — the default. Nothing happens without the user: Commits are pushed by an
 *   explicit **Sync now**, incoming changes wait for review.
 * - `auto-sync` — low-risk, environment-local: Committed changes **push automatically**
 *   and incoming changes **notify**, but **Apply stays manual** (CONTEXT.md "Auto-sync").
 * - `auto-apply` — clean incoming changes apply without review (Conflicts/risky changes
 *   still ask). **Selectable as of issue 2-12** (Warned in the ladder UI).
 * - `yolo` — full hands-off (auto-Commit local edits, Sync, Apply except Conflicts).
 *   **Selectable as of issue 2-13** (Strongly-warned in the ladder UI). Its auto-apply
 *   verdict routes through {@link mayAutoApply} exactly like Auto-apply, and it ADDITIONALLY
 *   permits auto-Committing local edits before a merge ({@link mayAutoCommitBeforeMerge}) so
 *   hands-off local work survives as Commits. Even YOLO can never auto-resolve a Conflict —
 *   that is `ConflictModel`'s job, not the policy's (invariant #1).
 */
export type AutomationLevel = 'manual' | 'auto-sync' | 'auto-apply' | 'yolo'

/**
 * The kind of change an Apply plan item represents.
 *
 * - `create` — a File present on the Remote but absent locally (incoming-clean).
 * - `update` — a File present on both that the Remote changed (the planner shape is
 *   ready for it; the incoming-update diff path is the Review & Apply slice, 1-09).
 * - `delete` — a File the Remote removed; per invariant #4 it is always
 *   `requiresConfirmation: true` and never written without explicit user confirmation.
 */
export type ApplyChangeKind = 'create' | 'update' | 'delete'
