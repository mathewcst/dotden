# 0040 — one organizational node: the Nook replaces Groups and derived Folders

**Status:** accepted · 2026-06-21 · **revises** [ADR 0032](./0032-tree-library-headless-tree-over-pierre.md)
(the tree model) and [ADR 0005](./0005-workspaces-as-environment-access-boundaries.md) (the
organization tier); updates the **CONTEXT.md** glossary (retire _Group_, repurpose the filesystem
noun _Folder_ → _directory_, add _Nook_) and **brand-and-vocabulary.md**. The tree _library_
(`@headless-tree/react`, ADR 0032 §1) is unchanged — only the node taxonomy it renders is simplified.

**Decision:** the file tree has **one** structural node — the **Nook** — replacing both the
user-created **Group** and the path-derived **Folder** node of ADR 0032. A Nook is pure, OS-stable,
user-shaped organization that carries Scope and is **never bound to a disk path**. A File's real
location is per-OS metadata (**Placement**), shown on the row, not encoded in the tree's shape.

---

## Context — why two structural concepts was wrong

ADR 0032 modeled a Workspace as **Group (user org) → Folder (derived from the File's real target
path) → File**. Two structural concepts, and the second one leaked:

- **It was unstable.** ADR 0032 itself states "the tree legitimately rearranges per OS" — because
  Folders derived from **Placement**, the _same Den_ rendered a _different shape_ on macOS vs
  Windows. The structure a user learned didn't hold across their environments.
- **It conflated two unrelated things** — _where a File syncs to_ (its disk path) and _how the user
  organizes it_ (their mental grouping). The tree leaked the storage model into the organization
  model.
- **It forced special cases** — "the same `.config/nvim/` can appear under two Groups, each painting
  only its own files" (ADR 0032). That weirdness existed _only because_ Folders were derived.

The underlying data truth (CONTEXT.md **Placement**): a File's **content is shared**; its **location
is per-OS metadata**. So a path-derived tree node was always the wrong primitive — it rendered a
per-OS storage detail as if it were stable user organization.

## Decision

**1 — One structural node: the Nook.** Delete **Group**. Delete the **derived Folder tree-node**.
The tree is **Workspace → Nook (nestable) → File**. A File carries exactly one `nookId`; ancestor
membership is implied by the Nook's `parentId` chain. No multi-Nook, no tags.

**2 — A Nook is organization-only and OS-stable.** It is user-named, nestable, drag-reorderable, and
**not bound to any disk path** — so the tree has the **same shape on every environment**. Moving a
File between Nooks changes `nookId` only; it **never** changes the File's disk path, and a Nook's
name/shape **never** drives where a File lands. (The coined term **Nook** carries zero filesystem
baggage — it cannot be mistaken for a directory — which is precisely what makes this invariant legible
where a plain "Folder" would imply disk coupling.)

**3 — The real path is metadata, always visible.** Each File row exposes its real per-OS path
(`→ ~/.config/nvim/init.lua`), i.e. its **Placement**. Organization (the Nook tree) and storage (the
path) are fully decoupled and both legible: you reshape the tree freely; the path is shown, and
changes only via an explicit Placement action.

**4 — Nooks are seeded from directories, then free.** Tracking a **directory** recursively manages
the files under it _and_ auto-seeds a Nook tree mirroring the directory's structure (so you don't
lose a 30-file nvim layout). After seeding it is ordinary user organization — reshape, flatten,
rename, merge at will. The disk structure is a _starting suggestion_, not a cage.

**5 — Drag = organization only.** Drag-from-OS onto a Nook (react-dropzone highlight on Nooks and
Workspaces) tracks-in-place and joins that Nook. Within-tree drag reparents (`nookId` for a File, a
Nook dropped on a Nook reparents). **Workspaces are drag-sealed**; cross-Workspace moves go through an
explicit menu (carried over from ADR 0032). No drop ever changes a File's path, Scope, or access.

**6 — Scope rides the Nook.** Scope keeps its inheritance semantic — it simply moves from the
derived Folder onto the user-shaped Nook (Groups carried no Scope, so nothing is lost): a Nook's Scope
is inherited by its descendants; a File may **narrow** but not broaden it. "This _Work_ Nook is
macOS-only" reads better than scoping a derived path node.

**7 — Vocabulary.** **Den → Workspace → Nook → File.** **directory** = a real on-disk directory (the
filesystem noun the old _Folder_ glossary entry held). _Group_ is retired; _Folder_ as a dotden entity
is retired (it survives only as the plain English "a directory you can track recursively").

**Interaction layer** (entry points, context menus, icons) is specified in
[`user-flow/screens/file-tree.md`](../user-flow/screens/file-tree.md); the load-bearing decisions:

- **Tracking an arbitrary file** has three doors into one native picker (`chezmoi add`): a persistent
  **`+ Track`** button in the Workspaces-pane header (the always-visible proof that tracking isn't
  limited to onboarding's suggestions), **drag-from-OS** onto a Nook, and a Nook context-menu entry.
  Menu/affordance label: **`Track new file…`**.
- **Context menus** are state-aware and per-target (File / Nook / Workspace / empty space), with
  destructive actions (`Delete everywhere`) split to the bottom and always confirmed.
- **Row icons** resolve in three monochrome layers — **tool/brand glyph** (a Vim mark on `.vimrc`,
  Git on `.gitconfig`, …) → **Lucide `File*` category glyph** (code/data/docs) → **generic `File`**.
  The file→tool mapping rides the **bundled catalog**
  ([ADR 0022](./0022-onboarding-gate-is-feature-detection-not-emptiness.md)); the catalog entry that
  already knows "`~/.config/nvim/` = Neovim" gains an `icon` field. All glyphs are single-color so that
  **color stays reserved for the status (M/A/D/R/U) and decoration (↓/⚠) lanes**, which carry the real
  signal. Brand glyphs come from **simple-icons** (CC0, monochrome-native, `currentColor`,
  tree-shakeable via `@icons-pack/react-simple-icons`); the few tools it lacks (Kitty, SSH, ripgrep,
  fzf) fall through to the existing **lucide-react** layer. See file-tree.md for the resolution detail.

## Consequences

- **The tree is OS-stable** — the same shape on every environment, the headline win. ADR 0032's
  per-OS rearrange is designed out, not patched.
- **chezmoi faithfulness is unaffected** (ADR 0003/0038). Nooks are dotden-only metadata in a
  chezmoi-ignored repo file, exactly as Groups were; directories are still recursively managed
  underneath. The CONTEXT.md mapping row becomes **Workspace / Nook (organization) → no chezmoi
  equivalent**.
- **Recursive operations ride the Nook.** "Untrack / Delete-everywhere / Commit the whole nvim setup"
  acts on a Nook's subtree. The "watch this directory for new untracked files" behavior
  (brand-and-vocabulary.md) survives as **registry metadata — a watched-paths set — not a tree node**,
  surfacing new files as **Untracked** candidates in a Discover-style list.
- **Metadata migration:** the persisted `groupId` becomes `nookId`; the derived Folder layer (and the
  per-Group `parentId` notion) collapses into the Nook's `parentId` chain. One-time, mechanical.
- **The library decision stands.** `@headless-tree/react` (ADR 0032 §1) renders `NookRow`/`FileRow`
  instead of `GroupRow`/`FolderRow`/`FileRow` — fewer node kinds, same headless model.

## Considered options

- **Keep Group, make derived Folders _stable_** (derive from one canonical home-relative path instead
  of per-OS Placement). Rejected: still two concepts, still couples organization to disk hierarchy —
  treats the user's freedom to organize as subordinate to storage layout.
- **Collapse to one node but keep the name "Group."** Rejected on naming: "Group" is a learned term,
  "I dragged a folder and it became a Group" is friction, and — decisively — a plain organizational
  word in an app _full of real paths_ still invites the "does reshaping it move files on disk?"
  assumption. A den-native coined term (**Nook**) sheds that overload entirely.
- **Multicolor file-icon theme (Seti/Material/VSCode-style).** Rejected: color in this tree is
  _meaningful_ (status + decoration lanes); a rainbow type theme fights it and clashes with the
  restrained "lit dwelling" dark brand.

## Naming — why "Nook"

Den-native (extends the dwelling metaphor: your **Den** is organized into **Nooks**), short, and
charming. Its decisive property is disambiguation: a coined word carries **no filesystem meaning**, so
it cannot be confused with a directory the way "Folder" can — turning the disk-coupling worry into a
non-issue. Accepted trade-off: "nook" connotes _small_, but in use it is size-neutral (a Nook holds 3
files or a deeply-nested config tree equally).
