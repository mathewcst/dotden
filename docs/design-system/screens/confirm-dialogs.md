# Confirmation dialogs (Track / Untrack / Delete everywhere)

> Phase 5 — Batch A. The three deletion/tracking confirms, built from the `Dialog` modal primitive
> ([components.md](../components.md)) overlaid on a scrim-dimmed app window. Part of the
> [design system](../README.md). Domain rules: `CONTEXT.md` (Track §44, Untrack §47,
> Delete-everywhere §50, "deletions are separate intents, confirm the destructive ones" §141).

These are **main-app** modals — a `Dialog` instance centered over a dimmed `AppShell` home window,
not a wizard. They live in a **`Confirm dialogs`** SECTION (`268:1694`) on `05 · Screens — App`,
below the Returning section.

## The `Dialog` primitive (page `02 · Components — App`)

`Dialog` SET `266:732` — `Tone=Default|Destructive`; props `Title#266:0` (Sans/Heading),
`Body#266:1` (Sans/Body, muted), `HasIcon#266:2` BOOL. Full anatomy + the dropped-`INSTANCE_SWAP`-icon
rationale in [components.md](../components.md). Footer is **reused `Button` instances** (Outline
**Cancel** + Primary/Destructive **Confirm**) — Cancel is Outline because `secondary`≡`popover` would
make a Secondary button vanish on the card.

## Screen assembly (the modal-over-app pattern)

Each screen = a `Backdrop` frame (1416×936, `dd/ink/850`) holding three stacked children:

1. an **`AppShell` home instance** (1320×840 at 48,48) — the app behind the modal;
2. a **`Scrim`** rectangle (1320×840, `dd/black` @ **0.4** opacity, radius 12) covering the window —
   0.4 (not 0.55) so the already-dark app stays dimly visible for context;
3. a centered **`Dialog`** instance (`Title`/`Body`/`HasIcon` set; nested Confirm `Button` relabeled
   per screen via `Label#39:0`).

The backdrop is a **plain frame** (not auto-layout), so the scrim/dialog use normal absolute coords —
deliberately avoiding the VERTICAL-auto-layout-backdrop overlay gotcha (where overlays would need
`layoutPositioning='ABSOLUTE'`).

## The three screens

| Screen                             | Tone        | Confirm             | Copy intent (grounded in CONTEXT)                                                                                                                                               |
| ---------------------------------- | ----------- | ------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Track** (`268:1695`)             | Default     | `Track`             | §44 — start managing an untracked file; it joins the Den and syncs to other environments.                                                                                       |
| **Untrack** (`268:2033`)           | Default     | `Untrack`           | §47 — safe; copy **must** say the file _stays on disk on every environment, nothing is deleted_, and can be tracked again.                                                      |
| **Delete everywhere** (`268:2342`) | Destructive | `Delete everywhere` | §50/§141 — destructive; removes from the Den **and** deletes the real path on **every environment where it applies** (names this-mac, work-laptop, home-pc); "can't be undone". |

Functional-color discipline holds: only the destructive screen uses red (badge `alert-triangle` +
`Destructive` Confirm). The safe Track/Untrack confirms use the ember Primary Confirm — Untrack is
**non-destructive**, so it is _not_ styled as a destructive action despite being a "removal".

White-fill + binding audits clean (the only near-white fill is the Destructive button's
`destructive-foreground` label, by design).
