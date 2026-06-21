# Screen — the file tree (Workspaces pane)

The left pane of the home screen: the browsable tree of everything the user tracks, organized into
**Nooks**. This spec owns the tree's **interactions** — how you add files, drag, right-click, and read
a row. The **model** (one structural node, OS-stable, path-as-metadata) is decided in
[ADR 0040](../../adr/0040-one-organizational-node-the-nook.md); the **library**
(`@headless-tree/react`, our own rows) in [ADR 0032](../../adr/0032-tree-library-headless-tree-over-pierre.md).
Vocabulary is [CONTEXT.md](../../../CONTEXT.md); copy rules are
[brand-and-vocabulary.md](../../brand-and-vocabulary.md).

> **This is the source of truth for tree behavior.** Where the design-system component docs or the
> Figma file still show the old **Group → derived-Folder → File** shape, that is the bug — reconcile
> them to **Workspace → Nook → File** (see the Figma-handoff note at the end).

## Shape

```txt
WORKSPACES                       ← pane header, with the global  + Track  affordance
▾ Personal                  12
  ▾ shell                        ← a Nook (user-shaped, OS-stable, may carry Scope)
      .zshrc        ~/.zshrc   M
      .bashrc       ~/.bashrc
  ▾ nvim                         ← a Nook seeded from ~/.config/nvim/ on track, then free
      init.lua      …/nvim/init.lua
      ▾ lua                      ← nested Nook
          plugins.lua   …/lua/plugins.lua   ↓
  .gitconfig        ~/.gitconfig  A   ← a File can sit directly in a Workspace (Nook optional)
▸ Work                       8
                                 ← this-environment footer
```

- The tree has the **same shape on every environment** — Nooks are organization, not disk layout.
- Each File row shows its **real per-OS path** (its **Placement**) as secondary text, so organization
  (the Nook) and storage (the path) are both legible and never conflated.
- A File need not live in a Nook; it may sit directly under a Workspace. Nooks are *optional*
  organization, not a required level.

## Adding files — three doors, one picker

Tracking is **not** limited to onboarding's catalog suggestions; the tree must make that obvious. All
three doors run the same path (native picker → `chezmoi add` → assign `nookId`). Affordance label
everywhere: **`Track new file…`** (ellipsis ⇒ opens the picker; the picker accepts multi-select and
whole directories).

1. **Global `+ Track`** — a persistent primary affordance in the `WORKSPACES` pane header. This is the
   always-visible proof that you can track *anything on disk*, not just what was suggested. Lands the
   file at the **root of the active Workspace** (no forced "Unsorted" Nook — a File may live directly
   under a Workspace; the user can drag it into a Nook after).
2. **Drag-from-OS** — drag a file or directory from Finder/Explorer onto the tree (react-dropzone
   highlight). Dropping onto a **Nook** joins that Nook; onto a **Workspace** lands at its root.
3. **Nook context menu** — `Track new file…` on a Nook, landing the result in that Nook.

**Tracking a directory** (door 2 with a folder, or the picker's choose-directory) recursively manages
the files under it **and seeds a Nook mirroring its structure** (ADR 0040), after which it is ordinary
user organization — reshape, flatten, rename at will.

## Drag behavior

- **Drag = organization only.** A drop sets `nookId` (for a File) or reparents (a Nook dropped on a
  Nook). It **never** changes a File's disk path, Scope, or Workspace-access. The real path shown on
  the row is unaffected by where you drag it. This invariant is *why* the node is a coined word
  (**Nook**) and not "Folder": there is no disk-location promise to break.
- **Drop targets:** Nooks and Workspaces highlight on hover; dropping resolves to "join this Nook" (or
  "Workspace root"). Because Nooks make no path promise, this is unambiguous — there is no "the file
  won't actually nest where I aimed" surprise (the failure mode a path-derived folder would have had).
- **Workspaces are drag-sealed.** You cannot *drag* a File across Workspaces (it can change sync
  availability); cross-Workspace moves go through the explicit `Move to Workspace…` menu, confirmed.
- **From-OS drops** track-in-place: the file stays where it is on disk and joins the dropped-on Nook.

## Context menus — state-aware, per target

Principle: show only actions valid for **that target and its current state**; a shared verb
vocabulary; destructive actions split to the bottom and **always confirmed**
([Delete everywhere](../../../CONTEXT.md) is the only destructive one).

| Right-click target | Menu |
|---|---|
| **File** | `Commit…` / `Apply…` *(state-gated — only when changed / incoming)* · `Set Scope…` · `Move to Nook…` · `Move to Workspace…` *(confirmed)* · `Reveal in Finder/Explorer` · `Copy path` · — · `Untrack` · `Delete everywhere` *(confirmed)* |
| **Nook** | `Track new file…` · `New Nook` *(nested)* · `Rename` · `Set Scope…` · `Move to Workspace…` · `Expand / Collapse all` · — · `Untrack all` · `Delete everywhere` *(confirmed, recursive)* |
| **Workspace** | `New Nook` · `Track new file…` · `Rename` · `Subscriptions…` *(which environments apply it)* · — · `Delete Workspace` *(confirmed; move-or-delete contents)* |
| **Empty space** | `New Nook` · `Track new file…` · `Expand / Collapse all` |

Notes:

- **No `Rename` on a File.** A File's name *is* its real-path basename; renaming is a Placement/path
  change, not a casual menu action — deferred, not a context-menu item.
- **`Set Scope…`** appears on both File and Nook (Nooks carry Scope; a File may narrow it, ADR 0040).
- **`Track new file…`** on Nook / Workspace / empty space is door 3 of the entry points above.
- Deletion wording follows brand-and-vocabulary.md (`Delete Nook` move-or-delete dialog; recursive
  warning when a tracked directory is deleted).

## Row anatomy

Left→right: **leading icon · name · real path (secondary) · Scope chip (if not All) · decoration
glyph · git-status letter**.

### Leading icon — three monochrome layers (your file-type question)

Resolved top-down, first match wins; **all single-color** so that **color stays reserved for the
status and decoration lanes**, which carry the real signal:

1. **Tool / brand glyph** — file maps to a known tool → that tool's monochrome mark (Vim on `.vimrc`,
   Neovim on `~/.config/nvim/…`, Git on `.gitconfig`, Zsh/Bash/Fish, tmux, Starship, Alacritty…). The
   file→tool mapping **rides the bundled catalog**
   ([ADR 0022](../../adr/0022-onboarding-gate-is-feature-detection-not-emptiness.md)) — the catalog
   entry that already knows "`~/.config/nvim/` = Neovim" gains an `icon` field. Glyphs from
   **simple-icons** (CC0, monochrome-native, `currentColor`; `@icons-pack/react-simple-icons`,
   tree-shakeable, cherry-pick ~30–50).
2. **Category glyph** — no tool match but a recognizable type → Lucide `File*` family (`FileCode` for
   `.lua/.sh/.js`, `FileJson` for `.json/.yaml/.toml`, `FileText` for `.md/.txt`).
3. **Generic `File`** — the extension-less long tail (most raw dotfiles). A **Nook** uses a folder-ish
   glyph; expand/collapse uses the disclosure chevron.

simple-icons lacks a few tools (**Kitty, SSH, ripgrep, fzf**); those fall straight through to the
Lucide layer (e.g. SSH → `KeyRound`, Kitty → `SquareTerminal`, ripgrep/fzf → `Search`). **Not** a
multicolor file-icon theme (Seti/Material/VSCode-style) — that would fight the status colors and the
restrained dark brand (rejected, ADR 0040).

### Status + decoration (unchanged from the design system)

Two independent axes, carried over from the existing tree component spec:

- **Local (git) lane** — a colored `M/A/D/R/U` letter at the row's trailing edge, from `chezmoi
  status` (modified / added / deleted / renamed / untracked; OS-scoped-out renders muted/`ignored`). A
  Nook/Workspace with changed descendants gets the automatic folder dot.
- **Remote + Conflict decoration** — a `↓` (incoming) / `⚠` (conflict) glyph *left of* the status
  letter, via `renderRowDecoration`. Secret-flagged files keep their amber `alert-triangle`.

### Path + Scope

- **Real per-OS path** as secondary text on every File row — the structural defeater of "is my Nook a
  disk location?". It reflects this environment's **Placement**; it changes only via an explicit
  Placement action, never via drag/rename.
- **Scope chip** shown only when a File/Nook is not `All` (label **Applies to**, per
  brand-and-vocabulary.md).

## Empty states

- **No Den content yet:** first-run invite to **Track files or directories** (drag here or choose from
  suggested configs) — see [states/empty-states.md](../states/empty-states.md).
- **Empty Nook:** "This Nook is empty" + `Track new file…`.
- **No File selected:** center pane prompts to pick a File.
- **Loading:** skeleton rows; never a blank pane.

## Enforcement flags (reconcile to this spec)

1. **Model** — design-system + Figma still show `Group`/`FolderRow`; collapse to one `NookRow`
   (`groupId` → `nookId`). *(design + code)*
2. **Global `+ Track` in the pane header** + `Track new file…` everywhere — likely **net-new** in
   Figma. *(design)*
3. **Drag-from-OS dropzone** onto Nooks/Workspaces — verify/add. *(design + code)*
4. **Per-target context menus** as tabled above — verify/add. *(design)*
5. **Three-layer monochrome icon resolution** (simple-icons → Lucide → generic), catalog `icon` field.
   *(design + code)*
6. **Real path as secondary row text** — verify it's shown on File rows. *(design)*

## Related

- Decisions: [ADR 0040](../../adr/0040-one-organizational-node-the-nook.md) (the Nook model),
  [ADR 0032](../../adr/0032-tree-library-headless-tree-over-pierre.md) (tree library),
  [ADR 0005](../../adr/0005-workspaces-as-environment-access-boundaries.md) (Workspace access),
  [ADR 0022](../../adr/0022-onboarding-gate-is-feature-detection-not-emptiness.md) (the catalog the
  tool-icons reuse).
- Screens: [home.md](home.md) (the pane in context), [operation-surface.md](operation-surface.md)
  (Commit/Apply, reached from row actions).
- **Figma:** the tree reshapes (Group/Folder → Nook), gains the `+ Track` affordance, the per-target
  context menus, and the tool-icon layer — a handoff delta is owed (track alongside the existing
  pending Figma handoffs).
