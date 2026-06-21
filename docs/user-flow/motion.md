# Motion

How dotden moves. Small, purposeful interaction animations — defined **once here** as named
patterns + tokens, then **referenced** from screen specs (don't redefine a pattern inline; link it).

> [!NOTE]
> Library is **Motion for React** — import from `motion/react` (never `framer-motion`; the project
> migrated). `animate` from `motion/react` in components. Prefer animating via `transform` (runs on
> WAAPI) and physics **springs** for anything physical/interruptible.

## Principles

- **Calm, not flashy.** dotden is a serious tool that touches your real config files. Motion should
  reassure and orient, never perform. Low or zero overshoot by default.
- **Motion communicates state, never decorates.** Every animation maps to a real state change
  (a stage completing, a banner arriving, a dialog opening). If it doesn't clarify, cut it.
- **Fast in, calm out.** Entrances are quick and legible; exits are unobtrusive.
- **Respect [`prefers-reduced-motion`](#reduced-motion).** Every pattern has a reduced-motion
  fallback — usually opacity-only or instant. This is a first-class state, not an afterthought.
- **Never block on motion.** Animations must never delay an action's effect or trap the user
  (consistent with never-fail-silently — a stage that finishes shouldn't wait on a 1s flourish).

## Tokens

Proposed defaults — tune in review. Keep the set small; reach for these before inventing values.

| Token | Value | Use |
|---|---|---|
| `dur.fast` | 150 ms | hover, press, tab underline, checkbox |
| `dur.base` | 250 ms | most enter/exit, banner slide, toast |
| `dur.slow` | 400 ms | full-window overlay swaps (Review & Apply, Conflict) |
| `spring.snappy` | `{ type: "spring", bounce: 0, visualDuration: 0.3 }` | precise UI (panels, tabs) — no overshoot |
| `spring.gentle` | `{ type: "spring", bounce: 0.15, visualDuration: 0.35 }` | default for moving elements; a hint of life |
| `ease.out` | `easeOut`, `dur.base` | simple fades where a spring is overkill |
| `offset.sm` / `offset.md` | 8 px / 12 px | slide distances (keep subtle) |

## Named patterns

Reference these by name from screen specs (e.g. *"banner uses [`banner-slide-down`](motion.md#banner-slide-down)"*).

### `stage-ticker`
**Where:** [boot screen](journeys/01-first-install-and-first-den.md#0-boot--preparing-dotden).
One message visible at a time, cycling. Each message: **slide up from `offset.sm` + fade in**
(`spring.gentle`) → **hold** until its real work completes (min dwell ~600 ms so it's legible even
when the step is instant) → **slide up to `-offset.sm` + fade out** (`ease.out`, ~`dur.fast`).
Use `AnimatePresence mode="wait"` so each exit finishes before the next enters.
**Reduced motion:** crossfade only (opacity), no translate.

### `banner-slide-down`
**Where:** [sync / offline / error banners](states/banners.md). Banner enters by sliding down from
behind the titlebar (`y: -100% → 0`) + fade, `spring.snappy`; leaves by reversing. Pushes body
content down (animate height/layout, not overlap). **Reduced motion:** fade only.

### `toast-in`
**Where:** "Applied" toast and similar. Slide up `offset.md` + fade in (`spring.gentle`), hold,
auto-dismiss with fade out. **Reduced motion:** fade only.

### `dialog-scrim`
**Where:** [confirm dialogs](states/banners.md), restore, secret modals. Scrim fades to ~0.45;
dialog **scale `0.96 → 1` + fade**, `spring.snappy`, `dur.fast`. Exit reverses, slightly faster.
**Reduced motion:** opacity only, no scale.

### `operation-surface`
**Where:** the [operation surface](screens/operation-surface.md) (Commit / Review & Apply) opening over the
home body. The whole body **slides up from the bottom edge** + fades (`y: offset.md → 0`, `spring.snappy`,
`dur.slow`); left rail (`Workspaces → ChangeList`), center (`Diff`), and right rail (`Inspector → OperationPanel`)
swap **together** as one body, not independently. Back/Cancel reverses it. **Reduced motion:** instant swap.

### `row-enter` / `list-reorder`
**Where:** tree rows, diff hunks, discover list. New rows fade + slide `offset.sm`; reorders use
layout animation (`layout` prop). Keep per-row stagger ≤ 30 ms. **Reduced motion:** no slide/layout,
instant.

> Add new patterns here as screens need them; don't fork a near-duplicate inline in a screen spec.

## Reduced motion

Honour `prefers-reduced-motion: reduce` globally. The rule of thumb: **keep opacity, drop
translation/scale/layout**, and shorten or remove holds. No pattern above should *require* movement
to be understood — the state change must still read with motion off.
