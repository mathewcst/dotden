# Screen — Home (3-pane)

| | |
|---|---|
| **Figma** | `node 54:3` (canonical shell); with Console open `node 781:7726` (`design-system/inventory.md`) |
| **Enforcement target** | `src/renderer/features/shell/components/DenWindow.tsx` (`LeftPane.tsx` · `CenterPane.tsx` · `RightInspector.tsx`); incoming card `src/renderer/features/apply/components/IncomingInspectorCard.tsx` |
| **Route / render condition** | Default in-app screen once an environment is registered & ready ([ADR 0026](../../adr/0026-launch-routing-derives-entry-screen-from-registration-state.md)) |
| **environment role** | both — one unified surface that **sends** (Commit) and **receives** (Review & Apply); the send/receive split is an implementation artifact, never a UX mode |
| **Governing ADRs** | [ADR 0006](../../adr/0006-sync-model-transport-not-commit.md) — Sync is transport, not Commit; [ADR 0008](../../adr/0008-invariant-ownership.md) — invariant ownership (automation never auto-resolves a Conflict); [ADR 0024](../../adr/0024-synced-vs-local-data-architecture.md) — synced vs local data |
| **v1 status** | ships v1 |

## Purpose

The everyday workbench. A **single unified surface** where you review and **Commit** your own changes *and*
see and **Apply** incoming changes from other environments — without switching modes. Wrapped by the global
[shell chrome](titlebar-statusbar.md).

## When the user sees it

The landing screen after launch routing resolves to "ready," and the place every other in-app flow returns to.

## Layout

Three panes between the [titlebar and the bottom status bar / Console](titlebar-statusbar.md):

```
WORKSPACES        +   │ 📄 ~/.zshrc ● modified   Discard  [Commit changes] …  │  ↓ 3 incoming changes      3
▾ Personal       12   │ Changes   History   Scope                    +3  −1   │  from work-laptop · 2 files, 1 conflict
  ▾ .config           │ ┌──────────────────────────────────────────────────┐ │  [ ⤓ Review & Apply ]
    ▸ nvim            │ │  Uncommitted changes                    2 hunks   │ │
      init.lua        │ │  12  export EDITOR="nvim"                         │ │  FILE
    starship.toml     │ │  14 −alias ll="ls -la"                            │ │  Workspace          Personal
  .zshrc          M   │ │  14 +alias ll="eza -la --icons…"                  │ │  Scope        macOS  Linux
  .gitconfig      A   │ └──────────────────────────────────────────────────┘ │  Last commit        3 days ago
  ▸ .ssh              │                                                      │  Secrets     ✓ None detected
▸ Work            8   │                                                      │  RECENT COMMITS …  ENVIRONMENTS …
```

- **Left — Workspaces pane:** all Workspaces visible as tree roots (`Personal`, `Work`) — the window is
  **unified across Workspaces**, not scoped to one.
- **Center — File-changes pane:** the selected File's diff + Commit affordances.
- **Right — Inspector:** incoming-changes card (when any) + File metadata + recent commits + environments.

## Elements & copy

**Left — Workspaces pane**
- Header `WORKSPACES` + add `+`.
- Workspace roots with counts (`Personal` `12`, `Work` `8`), expand/collapse, nested Folders/Groups, Files.
- File status badges: `M` (modified), `A` (added)… + per-file sync arrows.

**Center — File-changes pane**
- Header: file path `~/.zshrc` + `● modified` + `Discard` + **`Commit changes`** (primary) + overflow `…`.
- Tabs: `Changes` · `History` · `Scope`. Diff counts `+3  −1`.
- Diff body: `Uncommitted changes` · `2 hunks`, line-numbered add/remove hunks.

**Right — Inspector**
- **Incoming card** *(when incoming > 0)*: `↓ N incoming changes` + badge `N`; subline
  `from <env> · N files, N conflict`; primary **`⤓ Review & Apply`**.
- `FILE`: `Workspace` (e.g. `Personal`), `Scope` chips (`macOS` `Linux`), `Last commit` (`3 days ago`),
  `Secrets` (`✓ None detected`).
- `RECENT COMMITS`: message + short SHA + age.
- `ENVIRONMENTS`: per-env row — name, state (`Synced 4m ago` / `N changes incoming` / `Offline 2d ago`),
  health dot. **Read-only peer status** — you cannot operate another environment from here (see below).

## States & variants

- **Center:** empty (no File selected) / clean (no uncommitted changes) / dirty (hunks + `Commit changes`).
- **Inspector incoming card:** absent (0 incoming) / present (`N incoming` + `Review & Apply`) / cleared
  (after Apply completes on the [operation surface](operation-surface.md)).
- **Inspector incoming card with Conflict:** subline shows `… N conflict`; opening it enters the
  [operation surface](operation-surface.md) Apply variant, where conflicts resolve in-center. `Apply` is
  **gated until every Conflict is resolved** (standard git); Conflicts are never auto-resolved
  ([ADR 0008](../../adr/0008-invariant-ownership.md)).
- **Sync / environments:** see [states/sync-states.md](../states/sync-states.md).

## Actions → outcomes

| Action | Trigger | Result | Enforcement (IPC / state) |
|---|---|---|---|
| Select a File | click tree row | center shows its diff; inspector shows its metadata | renderer session state |
| Discard | `Discard` | reverts the File's uncommitted edits (confirmed) | maps to chezmoi re-add/forget semantics |
| **Commit** | `Commit changes` | records edits into the Den, ready to Sync | `api.den.commit(...)` → `add`/`re-add` + `git commit` |
| **Review & Apply** | incoming card `⤓ Review & Apply` | opens the [operation surface](operation-surface.md) (**Apply** variant) over the home body — left = incoming files (`conflicts` / `clean`), center = incoming diff, right = Apply panel | renderer mode → operation:apply; `api.den.apply(...)` → `chezmoi apply` |
| **Commit** (from surface) | home `Commit changes` | opens the [operation surface](operation-surface.md) (**Commit** variant) | renderer mode → operation:commit |

## Motion

- **Commit changes** / **Review & Apply** open the [operation surface](operation-surface.md), which slides up
  over the home body — see [`operation-surface`](../motion.md#operation-surface). Home itself does not animate
  the Apply in-place; the dedicated surface owns the review.
- On return, the changed tree rows re-render with [`row-enter`](../motion.md#row-enter--list-reorder) and a
  confirmation [`toast-in`](../motion.md#toast-in). **Reduced motion:** instant swap; rows update instantly.

## Fallbacks (never fail silently)

- **Empty (no Den content yet):** first-run empty state inviting the user to Track files — see
  [states/empty-states.md](../states/empty-states.md).
- **Empty (no File selected):** center prompts to pick a File from the tree.
- **Loading:** tree + diff show skeletons; never a blank pane.
- **Error (Apply fails):** the `applying` card surfaces the failure + the fix, and a Console row captures the
  redacted command output ([titlebar-statusbar](titlebar-statusbar.md#fallbacks-never-fail-silently)).
- **Offline:** incoming polling pauses; status bar shows `Offline`; queued work flushes on reconnect
  (journey [06](../journeys/06-errors-offline-diagnostics.md)).

## Exits

- `Commit changes` / `Review & Apply` → the [operation surface](operation-surface.md) (Commit / Apply variant),
  which returns home on completion or Back/Cancel.
- Conflicts in the incoming set resolve **in-center** on that surface (Keep / Take / Both).
- Settings / notifications / profile via the [titlebar](titlebar-statusbar.md).

## Related

- Chrome: [titlebar & status bar](titlebar-statusbar.md). Journeys: [02 daily use](../journeys/02-daily-use.md).
- **Decision log (session 2026-06-21):**
  - **Send + receive = one unified surface** (center = my changes, right = incoming) — confirmed original intent.
  - **environment = identity, not remote control.** No chezmoi agent on peers; only the Remote is shared. The
    `ENVIRONMENTS` list is read-only; cross-environment effects come from editing the shared **Den**
    (Scope / Placement / Workspace subscription), applied when the peer syncs — never by driving its filesystem.
  - **Review & Apply opens the [operation surface](operation-surface.md)** (Apply variant) — this **supersedes**
    an earlier "in-place, no overlay" call that wrongly assumed Apply was a trivial confirm. Commit gets the
    symmetric Commit variant.
  - **Window unified across Workspaces** — left pane shows all Workspaces; no per-Workspace scoping.
