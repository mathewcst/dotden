# Conflict resolver

> The conflict-resolution flow — the `MergeHunk` block + the flow-specific
> `AppPane/ConflictFiles|Merge|Resolve` panes + the unresolved→resolved screens. Part of the
> [design system](../README.md); built on the [`AppShell` + default panes](../components.md).

**Conflict resolver flow** (screens on `05 · Screens — App`, section _Conflict resolver_; components on
`02 · Components — App`):

- **`MergeHunk`** SET `State=Conflict|Resolved` × **`Layout=Inline|Split`** — the core block, **built
  entirely from primitives**: `Pill` (CONFLICT/RESOLVED), `StatusDot` (amber Current / blue Incoming /
  green resolved), and `Button` (`Keep mine`/`Take theirs` carry a `StatusDot` lead, `Keep both` plain,
  `Change resolution` is a Link button). `Layout=Inline` stacks the two sides; `Layout=Split` puts them
  side-by-side as columns (the split-conflict member of the Diff family).
- **`AppPane/ConflictFiles`** (left) — files being applied, grouped _Conflicts_ / _Applies cleanly_;
  rows are **`ListRow`** instances _(were `FileRow` pre-M4 — folded into `ListRow` 2026-06-14)_.
- **`AppPane/Merge`** SET `State=Unresolved|Resolved` (center) — file header (+ `Pill` conflict/resolved
  badge with icon) + the `MergeHunk` + a `ListRow` "applies cleanly" row.
- **`AppPane/Resolve`** SET `State=Unresolved|Resolved` (right) — progress `n / m` (bespoke bar), the
  keep-mine/take-theirs/keep-both legend, and the **Apply resolution** `Button` (Secondary while
  unresolved → Primary **ember** when ready, download lead) + a destructive-tinted **Abort** Ghost
  button.
- Two screens: _Conflict — unresolved_ (Apply disabled) → _Conflict — resolved_ (Apply enabled), each
  one AppShell instance with Center/Right swapped to the matching `State` variant; Left stays
  `ConflictFiles`.

Functional-color discipline holds: **amber** = mine/local, **blue** = theirs/incoming, **red** =
conflict, **green** = resolved/applied, **ember** = the primary Apply action only.

**Lesson (conflict flow, fixed retroactively).** This flow was first built with **raw frames and
hand-picked token bindings** instead of reusing the library `Button`/`StatusTag` and matching the
home screen's tokens — so it drifted: panes on `dd/ink/990` (orange tint), an `alert-triangle` with a
red fill + gray outline (a blob), and button/status icons left muted-gray while their text was
colored. The fix was to re-derive every value from the **source-of-truth home screen** (`54:3`): pane
surfaces → [pane-token rule](../figma-conventions.md), icon colors →
[icon-color convention](../figma-conventions.md). Reinforces the
[no-duplication rule](../architecture.md) — and that
componentization is now **done**: Button gained leading/trailing icon-or-`StatusDot` slots; a generic
`Pill` + `StatusDot` replaced every raw pill/dot; `FileRow` replaced the raw side-panel rows; and a
real Diff family (`DiffLine` + `DiffLineSplit` + `MergeHunk` `State`×`Layout`) replaced the dozens of
raw `dl` frames. Every pane (`Diff`/`ConflictFiles`/`Merge`/`Resolve`/`Inspector`) and the `AppShell`
titlebar (`SearchField` + workspace-switcher `Button`) were rebuilt to instances; a structural re-scan
shows **0 raw controls** left (only the bespoke Resolve progress bar remains by design), and the
white-fill + token-binding audits pass clean. Values now live in components and can't drift again.
