# File history & restore

> Phase 5 — Batch D. The per-File **version history** + **restore-forward** flow, surfaced in the Diff
> pane's existing **History** tab. Part of the [design system](../README.md). Domain rules:
> **History in v1 = per-File version list + restore-forward** (see
> [scope-v1.md](../../scope-v1.md) — "What v1 delivers / History"; each Commit is a git commit;
> "restore this version" _captures that old version forward_ as a new commit — non-destructive, history
> stays continuous), **History diff → `PatchDiff`** (read-only), environment claim keeps
> history/attribution continuous.

Two screens in a **`File history`** SECTION (`320:4250`) on `05 · Screens — App`, laid out 2×1 below
the Sync-states section.

## The components (page `02 · Components — App`)

**`AppPane/History`** (`319:888`, 716×790) — the Diff pane in **History-tab** mode, a **master-detail
layout**:

- **`list-region`** — a `grow=1`, clipped, **scrollable** column of `CommitRow`s on the base
  `background`, with a faint scrollbar thumb (7 versions overflow ⇒ the scroll is real, not faked).
- **`resize-handle`** — a thin divider with a centered grip pill (a **shadcn `ResizablePanel`
  handle**) so the user can drag the list/panel split.
- **`preview-panel`** — a **fixed-height** strip on a raised **`card`** surface (visually distinct from
  the list, so the eye reads "top scrolls, this stays & reflects my selection"): a header
  (`7b1e44 · Sync nvim plugins`, "read-only"), the selected version's read-only `DiffLine` patch, a
  muted **"Kept in history — nothing is deleted"** line, and one **filled ember Primary
  `Restore this version`** button.

Built by **detaching** an `AppPane/Diff` instance (`detachInstance()` preserves variable bindings —
`clone()` would drop them and render the frames black), then switching the `History` `Tab` to
`State=Active`, stripping the read-only-irrelevant header controls (the `modified` `StatusTag` +
**Discard**/**Commit changes** buttons), and re-flowing the content into the three zones above. Reusing
the detached Diff frames keeps every border/card/diff-line binding intact.

**`CommitRow`** SET (`313:790`, `State=Default|Selected`) — full anatomy in
[components.md](../components.md). A **selectable** version-list row: `git-commit` lead + `Message` over
`Sha · Meta`, optional green **Current** `Pill` (`HasTag`), and a trailing **disclosure `chevron-right`**
(the "opens a preview" hint). `State=Selected` = `secondary` bg + an **ember left rail** + ember
commit-dot. No per-row restore button — restore is the single panel action. `Icon/rotate-ccw` (`309:754`)
is the restore glyph (new this batch; stroke copied from `Icon/sync` to keep the bound color).

## The design calls (incl. the affordance pass)

| Call                                                 | Decision                                                                                                                                                                                                                                                                                                                                                                                                 |
| ---------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Tab, not new pane**                                | History reuses the Diff pane's existing `Changes / History / Scope` tabs (the tab already existed) — `AppPane/History` is the **History-tab body**, swapped into `AppShell`'s center slot (`Center#114:1`), not a separate window.                                                                                                                                                                       |
| **Master-detail, scroll/fixed split**                | The list scrolls; the preview is pinned on a distinct surface and swaps to the selected row — with a draggable **resize handle** between (user feedback: use a shadcn panel resizer). Chosen over an inline accordion (long diffs would shove rows) and over a side-by-side split (redundant column inside an already 3-pane window).                                                                    |
| **Restore is one filled panel button**               | A single **filled ember Primary** `Restore this version` lives in the preview panel — it restores the version you're previewing, so the target is unambiguous _and_ it's obviously a button at rest. (Superseded an earlier per-row ghost-text button: text-styled actions failed the "what's clickable before I move the mouse?" test, and a row button + panel button = two restores for one version.) |
| **Legible to non-devs too (affordance rules)**       | Project baseline locked here: **actions are filled** (presentation is flat text), **selection is loud** (ember rail + tint), **two distinct surfaces** (list vs raised panel), **disclosure chevrons** on interactive rows, and a plain-language **reassurance** line. The goal: open the screen and instinctively know what's clickable vs presentation.                                                |
| **Restore-forward ⇒ non-destructive ⇒ Default tone** | The confirm `Dialog` is **`Tone=Default`**, _not_ Destructive: restoring captures the old version forward as a new commit, so nothing is lost — the copy says "Saved as a new commit; your current version stays in history." A red/destructive treatment would misrepresent the action.                                                                                                                 |

## The two screens

| Screen                             | What it shows                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                          |
| ---------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **File history** (`320:4251`)      | Home backdrop with the center pane swapped to `AppPane/History`. Header = `~/.zshrc` + ⋯; History tab active; a **scrollable** VERSION HISTORY list of 7 `CommitRow`s (latest = **Current**, `7b1e44` Selected — ember rail) over a draggable resize handle and the fixed **preview panel** (read-only `7b1e44` diff + "kept in history" line + filled **Restore this version**). Left tree (`.zshrc` selected) + inspector (FILE / **Recent commits** / Environments) stay as the live app state — history and incoming are independent, so no neutralization needed. |
| **Restore — confirm** (`323:4746`) | The File-history screen dimmed by a `Scrim` + a centered `Dialog` (`Tone=Default`, rotate-ccw badge): **"Restore this version?"** / restore-forward copy / **Cancel** + ember **Restore**. Reuses the Batch-A `Dialog` primitive.                                                                                                                                                                                                                                                                                                                                      |

**Build mechanics.** Screen 1 = `clone(54:3)` → reparent into the section (relative `48,88`) → reassert
`fills` (clone-black gotcha) → `AppShell.setProperties({"Center#114:1": <History>})`. Screen 2 =
`clone(screen 1)` (preserves the center-swap override) → reassert fill → add an **absolute**
(`layoutPositioning='ABSOLUTE'`) `Scrim` + centered `Dialog`. White-fill + binding audits on the new
components clean (0 flags).

## Relationship to the rest of Phase 5

History sits alongside [commit](./commit.md) (where versions are _created_) and
[sync states](./sync-states.md) (where they're _transported_). The restore confirm reuses the same
`Dialog` modal as the [confirm dialogs](./confirm-dialogs.md). Full timeline/branching UI is explicitly
deferred past v1.
