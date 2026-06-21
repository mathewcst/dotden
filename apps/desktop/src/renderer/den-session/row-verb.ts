/**
 * `RowVerb` — the four right-click row actions the den-session routes (issue 1-08): Commit and
 * Apply run immediately on the one File; Untrack and Delete-everywhere open a confirm first.
 *
 * Defined in the den-session leaf (not the Workspace feature) because the session slice's
 * `onRowVerb` is what routes them — a shared leaf can't import a feature for the type, while the
 * Tree's `RowContextMenu` (a feature) freely imports *down* into the leaf (ADR 0033/0034).
 */
export type RowVerb = 'commit' | 'apply' | 'untrack' | 'delete-everywhere'
