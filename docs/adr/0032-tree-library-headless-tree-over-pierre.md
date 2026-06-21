# 0032 — `@headless-tree/react` for the file tree, replacing `@pierre/trees`

**Status:** accepted · 2026-06-21

> **Tree model revised by [ADR 0040](./0040-one-organizational-node-the-nook.md).** The
> **library** decision below (`@headless-tree/react`, §1–4) stands unchanged. What changed is the
> _node taxonomy_ it renders: the **Group → derived-Folder → File** model in "Context" is superseded
> by a **single structural node, the Nook** (Workspace → Nook → File). Read the Context section as the
> history that motivated the swap; read ADR 0040 for the current model. Concretely: `GroupRow` +
> `FolderRow` collapse into one `NookRow`; `groupId` → `nookId`; Folders are no longer derived from
> Placement (the tree is now OS-stable).

The left pane's file tree was built on `@pierre/trees` (a git-diff file tree). As the
Workspace/Group organization model firmed up, that library stopped being able to express
the interactions the tree needs. This ADR replaces it, app-wide, with
[`@headless-tree/react`](https://github.com/lukasbach/headless-tree) — the headless tree
the shadcn ecosystem standardized on — and records the tree model that forced the change.

## Context — the tree model the UI must express

A Workspace, expanded, is **Groups over real folders** (the model agreed during domain
grilling, 2026-06-21):

- **Workspace** (access boundary, ADR 0005) → **Group** (user-created, _nestable_, pure
  organization) → **Folder** (derived from the File's real target path) → **File** (leaf).
- A File carries exactly **one** `groupId` — its deepest Group; ancestor membership is
  implied by the Group's `parentId` chain. No multi-group, no tags.
- **Folders are contextual**, not canonical containers: because they are derived _within_ a
  Group's subtree, the same real folder (e.g. `.config/nvim/`) can appear under two Groups,
  each painting only its own files. Only Groups are drop targets; Folders are read-only
  reflections of chezmoi's truth.
- **Drag = `groupId` only** — pure visual organization. A drop never changes a File's path,
  Scope, or access. Cross-Workspace moves happen via an explicit menu, never drag
  (Workspaces are drag-sealed). A Group dropped on a Group reparents it.
- The folder structure nests by **this environment's resolved target path** (the File's
  **Placement**), so the tree legitimately rearranges per OS.

This needs: nestable, droppable Group nodes; mixed node kinds rendered as our own shadcn
rows; inline create/rename; per-Group path nesting; keyboard a11y. `@pierre/trees` offers
none of these — it is always-virtualized, exposes a single imperative model, renders a
light-DOM custom element (not our markup), and has no drag or mixed-node concept. The
mismatch produced two standing bugs: grouping **flattened** the path nesting (the grouped
view fell back to flat leaf rows because the one shared model can't render per-Group), and
the custom element's `scrollbar-gutter:stable` viewport forced a **permanent scrollbar**.

## Decision

**1 — Adopt `@headless-tree/react` as the only tree library, in both env A (the
Workspace organization tree) and env B (the incoming-review list).** It is the official
successor to react-complex-tree: headless (hands us a flat list of nodes we render as our
own `GroupRow`/`FolderRow`/`FileRow` in shadcn/Tailwind, ADR 0012/0017), with built-in
drag-and-drop, keyboard navigation, inline rename, search, and multi-select. The
shadcn "Tree" component is built on it and ships a **Base UI** variant — dotden's exact
stack — so it drops onto our token system rather than fighting it.

**2 — `@pierre/trees` is removed entirely.** One tree technology, one set of rows, one
context menu. Keeping pierre for env B only was **rejected**: it leaves the same
constraint in half the app and doubles the rendering/context-menu surface to maintain.

**3 — Skip virtualization for v1.** Virtualization is opt-in in `@headless-tree/react`
(bring `@tanstack/react-virtual` later if a Den ever gets large). Dotfile sets are small,
so v1 renders the full tree in a plain `overflow-auto` region. This deletes the
`scrollbar-gutter` workaround _and_ the `resetPaths`/`setGitStatus` imperative-sync hack
(`use-reactive-file-tree.ts`) that only existed because pierre built its model once at
mount, before the async store had filled.

**4 — `@pierre/diffs` is out of scope here.** The diff/patch viewer is a separate problem
from the tree and is evaluated on its own; this ADR does not change it.

## Consequences

- The model-once + imperative-refresh pattern goes away: the tree becomes a normal
  controlled React render off the scoped den-session store (ADR 0027). Bug #1 (grouping
  flattens nesting) and the persistent scrollbar are fixed by construction, not patched.
- The title-bar search (⌘K) and the git-status (M/A/D/R/U) + remote-axis (↓/⚠) decorations
  were driven through pierre's model; they must be re-expressed against `@headless-tree`'s
  node data and our own row components.
- A new core UI dependency replaces an existing one. Per ADR 0028 it is pinned and
  reviewed; the swap is a deliberate, one-time cost the project accepted for the UX/DX of a
  real organization tree ("not afraid of big refactors").
- Faithfulness (ADR 0003) is unaffected: the tree is still a _view_ over chezmoi's managed
  set; Groups remain dotden-only metadata in a chezmoi-ignored repo file (see CONTEXT.md
  mapping table). The library swap is presentation only.

## Considered Options

- **`react-arborist`** — mature and virtualized, but owns more of the markup (less
  headless), a worse fit for "render our own shadcn rows."
- **Roll our own with `@dnd-kit`** — maximum control, but reinvents keyboard nav, rename,
  search, and expansion state that `@headless-tree` already ships.
- **Keep `@pierre/trees`, push Groups into an inspector/filter instead of the tree** —
  rejected: it abandons the agreed "drag files into Groups in the tree" interaction.
