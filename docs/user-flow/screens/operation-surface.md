# Screen — Operation surface (Commit · Review & Apply)

| | |
|---|---|
| **Figma** | Commit `node 283:2646` (section `283:2644`; committed state `283:3060`) · Review & Apply `node 228:1154` (section `231:1682`; applied state `230:1393`) · Conflict `node 126:649` unresolved / `129:832` resolved (`design-system/inventory.md`) |
| **Enforcement target** | `src/renderer/features/commit/components/` (`ChangesDiff.tsx`, `CommitRow.tsx`) · `src/renderer/features/apply/components/` (`ReviewApply.tsx`, `IncomingInspectorCard.tsx`, `ConflictResolver.tsx`, `ConflictCallout.tsx`) |
| **Route / render condition** | Opened *over* [home](home.md) by `Commit changes` (send) or `Review & Apply` (receive); dismissed by Back/Cancel |
| **environment role** | Commit = **send** (A) · Apply = **receive** (B) — two variants of one surface, not two screens |
| **Governing ADRs** | [ADR 0006](../../adr/0006-sync-model-transport-not-commit.md) — Sync is transport, not Commit; [ADR 0008](../../adr/0008-invariant-ownership.md) — automation/Apply never auto-resolves a Conflict; [ADR 0024](../../adr/0024-synced-vs-local-data-architecture.md) — synced vs local data |
| **v1 status** | ships v1 |

## Purpose

One **operation surface** that both batch flows reuse, so send and receive feel symmetric and share components.
Whenever the user acts on a *set* of files — recording their own edits (**Commit**) or writing incoming
changes onto this environment (**Apply**) — they get the same three-region skeleton, only the left-list flags
and the right-panel action differ.

## When the user sees it

Entered from [home](home.md): `Commit changes` (header, with uncommitted edits) → **Commit** variant;
the inspector's `Review & Apply` (incoming present) → **Apply** variant. Replaces the home body for the
duration of the operation; returns home on completion or Back/Cancel.

## Layout

The same skeleton for both variants — **`ChangeList | Diff | OperationPanel`**:

```
┌ left rail ────────┬ center ───────────────────────────┬ right rail ─────────────┐
│ <operation> · N    │ <file> ● <state>   <exit> [primary]│  <OperationPanel>       │
│                    │ Changes  History  Scope   ⟷ view   │                         │
│ GROUP A · n        │ ┌───────────────────────────────┐ │                         │
│   file  ⚑ flag     │ │  <Uncommitted|Incoming> changes│ │                         │
│ GROUP B · n        │ │  …diff hunks…                  │ │                         │
│   file  +2 −1      │ └───────────────────────────────┘ │  [ primary action ]     │
└────────────────────┴────────────────────────────────────┴─────────────────────────┘
```

| Region | Commit (send) | Apply (receive) |
|---|---|---|
| **Left rail** (`ChangeList`) | changed files — `● 2 modified · ● 1 added` | incoming files — `CONFLICTS · 2` / `APPLIES CLEANLY · 71` |
| **Center** (`Diff`) | uncommitted diff + **stacked / side-by-side** toggle | incoming diff + same toggle; a selected **Conflict** resolves here (Keep / Take / Both) |
| **Right rail** (`OperationPanel`) | **Commit composer** | **Apply panel** |

The center `Diff` is the **same component** in both, with a stacked/side-by-side view toggle the diff package
already supports (mirror the existing Figma Diff component variants).

## Elements & copy

**Shared — center header**
- File path + state dot: `● modified` (orange, Commit) vs `● incoming` (blue, Apply).
- Exit + primary: Commit → `Discard` + `Commit changes`; Apply → `Skip` (this file) + `Apply`. Plus a
  surface-level **Back / Cancel** to return home (see Actions).
- Tabs `Changes · History · Scope`; diff counts `+N −N`; **view toggle** (stacked ⟷ side-by-side).
- Diff body title: `Uncommitted changes` (Commit) / `Incoming changes` (Apply) + `N hunks`.

**Commit variant — right rail `OperationPanel` (composer)** — node `283:2646`
- Header `Commit` + `N files ready to record into your Den.`
- Count chips: `● N modified` `● N added`.
- `Message` textarea, prefilled e.g. `[macos-sync-2026-06-14]`.
- `Auto-filled from your template` + `Edit template` (link); template field `[$os-sync-$year-$month-$day]`.
- Primary `Commit changes`; subline `Committed locally — Sync to share it.` (push is the separate Sync step — see [02b](../journeys/daily-use/commit-and-push.md)).

**Apply variant — right rail `OperationPanel` (Apply panel)** — node `228:1154` (right rail to be built)
- Header `Apply` + source `from <env> · <context>` (e.g. `from work-laptop · first sync`).
- Summary: `N incoming` + breakdown chips `● N conflicts · ● N clean`.
- Primary `Apply` — **disabled until all Conflicts are resolved** in-center; then it writes the full set.
  **Invariant ([ADR 0008](../../adr/0008-invariant-ownership.md)):** Apply never auto-resolves a Conflict.

## States & variants

- **Left list:** Commit — `modified` / `added` (/ `deleted`) groups; Apply — `CONFLICTS` / `APPLIES CLEANLY`
  groups, conflict rows flagged `⚠`.
- **Center (Apply, conflict file selected):** the diff becomes a **resolver** — `Keep` (local) / `Take`
  (incoming) / `Both` — node `126:649` (unresolved) → `129:832` (resolved).
- **Apply gating (locked — standard git):** the left rail **presents** the split (`CONFLICTS` vs
  `APPLIES CLEANLY`) so the user sees what's at stake, but `Apply` is **disabled until every Conflict is
  resolved** in-center (Keep / Take / Both) — you cannot complete the merge with unresolved conflicts. Once all
  conflicts resolve, `Apply` writes the **full set** at once (no partial clean-apply). A Conflict is never
  auto-resolved ([ADR 0008](../../adr/0008-invariant-ownership.md)).
- **Completion:** Commit → committed (`Not synced · N changes`, node `283:3060`); Apply → applied & in sync
  (node `230:1393`) + [`Toast · Applied`](../states/banners.md).

## Actions → outcomes

| Action | Trigger | Result | Enforcement (IPC / state) |
|---|---|---|---|
| Open Commit | home `Commit changes` | enter surface, Commit variant | renderer mode → operation:commit |
| Open Apply | home inspector `Review & Apply` | enter surface, Apply variant | renderer mode → operation:apply |
| Toggle diff view | center `stacked ⟷ side-by-side` | re-render diff layout | renderer-local |
| Resolve conflict | center `Keep / Take / Both` | conflict marked resolved | maps to git source-state resolution |
| Skip a file (Apply) | center `Skip` | excludes that file from this Apply | renderer selection |
| **Commit** | right `Commit changes` | records the set into the Den | `api.den.commit(...)` → `add`/`re-add` + `git commit` |
| **Apply** | right `Apply` (enabled once all conflicts resolved) | writes the full resolved incoming set onto this environment | `api.den.apply(...)` → `chezmoi apply` |
| **Back / Cancel** | surface-level back | discard the operation (confirm if needed), return to [home](home.md) | renderer mode → home |

## Motion

- The surface **slides up over the home body** (left + center + right swap together) — see
  [`operation-surface`](../motion.md#operation-surface); Back/Cancel reverses it. The inspector→Apply-panel
  and Workspaces→ChangeList swaps animate with the body, not independently. **Reduced motion:** instant swap.
- Diff view toggle cross-fades the layout; rows in the left list use
  [`row-enter`](../motion.md#row-enter--list-reorder). On completion, the
  [`Toast · Applied`](../motion.md#toast-in) confirms.

## Fallbacks (never fail silently)

- **Empty:** Commit unreachable with nothing changed; Apply unreachable with nothing incoming (the home
  affordances simply aren't shown).
- **Loading:** left list + diff show skeletons.
- **Error (Commit/Apply fails):** the right panel surfaces the failure + the fix; a Console row captures the
  redacted command output ([titlebar-statusbar](titlebar-statusbar.md#fallbacks-never-fail-silently)).
- **Offline:** Commit still records locally (push deferred); Apply of already-fetched incoming still works —
  see journey [06](../journeys/06-errors-offline-diagnostics.md).

## Exits

- **Commit changes** → home, `Not synced · N changes` (push via `Sync now`, or auto under Auto-sync — [02b](../journeys/daily-use/commit-and-push.md)).
- **Apply** → home, in sync (+ Applied toast); unresolved Conflicts keep the user on the surface until cleared.
- **Back / Cancel** → home, operation discarded.

## Related

- [home](home.md) (entry), [titlebar & status bar](titlebar-statusbar.md) (chrome),
  [conflict resolver](conflict-resolver.md) (the in-center resolution).
- Journeys: [02 daily use](../journeys/02-daily-use.md), [03 second environment](../journeys/03-second-environment-adopt.md),
  [04 conflicts](../journeys/04-conflicts.md).
- **Decision log (session 2026-06-21):** unified Commit + Apply into one **operation surface**
  (`ChangeList | Diff | OperationPanel`); reuse the `Diff` component (add stacked/side-by-side toggle); Apply's
  right rail becomes a dedicated **Apply panel** (source + summary + `Apply`); conflicts resolve **in the
  center**; added a surface-level **Back / Cancel**. This **supersedes** the earlier "in-place, no overlay"
  decision for Apply (which assumed Apply was a trivial confirm).
