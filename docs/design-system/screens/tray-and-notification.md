# Tray & notification (Batch G — Phase 5 finale)

> The two **OS-chrome** surfaces the background **tray poller** drives even when the main window is
> closed: the menubar **tray dropdown** and the **OS notification** toast. Part of the
> [design system](../README.md); grounded in [scope-v1.md](../../scope-v1.md) — "Poll cadence"
> (tray poller in v1 scope; poll cadence) and [ADR 0006](../../adr/0006-sync-model-transport-not-commit.md)
> (notify → diff → click; the poller only _detects/notifies_, never acts), plus
> [ADR 0004](../../adr/0004-electron-desktop-runtime.md) (Electron, pixel-identical UI). Components live on
> `02 · Components` (section **`571:1299`**); screens
> on `03 · Screens — App` (section **`563:7125`**).

## The one decision that shapes everything: native chrome, not the dotden theme

Asked "branded warm-dark popover vs. native-per-OS chrome," the user chose **native-per-OS chrome**.
So unlike every other surface in this file, the tray menu and notification are **faithful macOS
mocks** — dark-mode system menu / Notification-Center card — **not** the warm-dark ember theme.

**Consequence — the one documented exception to the dd/\* token rule:** these two component sets bind
**no** `dd/*` variables. They use **literal macOS system colors** (dark translucent menu `#1F1F22`,
near-white text `#F6F6F7`, secondary `#9E9EA6`, system blue `#0A84FF`, green `#30D158`). This is
deliberate and called out in each set's `.description` + in [figma-conventions.md](../figma-conventions.md#native-os-chrome-is-the-one-documented-exception-to-the-dd-token-rule).
The token-binding audit therefore **excludes this section**; the white-fill audit flags only the
intentional native white _glyphs_ (the menubar tray dot, the app-icon dot) — no stray container fills.

**Font:** SF Pro is the real macOS system font, but it **renders at width 0** in this Figma
environment (listed in `listAvailableFontsAsync` but unusable — verified). **Inter** is the stand-in
(it was designed as an SF alternative and is visually near-identical at UI sizes). See the
[font gotcha](../figma-conventions.md#sf-pro-renders-at-width-0--use-inter-as-the-macos-system-font-stand-in).

Scope locked with the user: **4 tray states** (idle / syncing / incoming / offline) + **3
notification states** (incoming / conflict / applied-when-auto). macOS only — Windows/Linux follow the
same _content_ with their own native chrome (deferred).

## `TrayMenu` (`558:1299`) — macOS menubar dropdown · `State = Idle | Syncing | Incoming | Offline`

A dark-mode macOS menu (radius 10, 1px white@0.10 hairline, drop shadow, 256w). Vertical stack:

- **Header** — `dotden` (Inter Semi Bold 13, near-white) over a **status line** (Inter Regular,
  secondary gray) with a **leading status dot**.
- ─ separator (white@0.10, inset)
- **Sync now** + `⌘S` shortcut (right-aligned, secondary)
- **Review & Apply** — bright with a **count** when incoming, else grayed/disabled
- ─ separator · **Auto-sync: Manual** + `›` submenu arrow (the quick toggle of the automation
  level — see [ADR 0006](../../adr/0006-sync-model-transport-not-commit.md)) · ─ separator
- **Open dotden** · **Quit dotden** + `⌘Q`

`State` is the **whole API** (same pattern as `Banner`) — each variant bakes its dot color, status
copy, and which rows are enabled. No exposed TEXT/BOOL props.

| State                   | dot   | status line                   | Sync now | Review & Apply                    |
| ----------------------- | ----- | ----------------------------- | -------- | --------------------------------- |
| **Idle** `556:1300`     | green | `Up to date · just now`       | enabled  | disabled (gray, no count)         |
| **Syncing** `556:1331`  | blue  | `Syncing…`                    | disabled | disabled                          |
| **Incoming** `556:1299` | blue  | `2 incoming from work-laptop` | enabled  | **`Review & Apply (2)`** (bright) |
| **Offline** `556:1362`  | gray  | `Offline — will retry`        | disabled | disabled                          |

Disabled rows = secondary gray @ 0.5 opacity (the macOS disabled-menu-item look). Built master
(Incoming) → `clone()` ×3 → edit → `combineAsVariants` (literal colors, so `clone()` is safe here —
nothing variable-bound to drop).

## `OSNotification` (`562:1299`) — macOS notification toast · `State = Incoming | Conflict`

A dark Notification-Center card (radius 16, 1px white@0.08 hairline, big soft shadow, 360w): an
**ember app-icon** (gradient rounded-square + white dot — the dotden mark) + a content column —
header (`dotden` + `now` timestamp), **title** (Inter Semi Bold), **body** (secondary), and a
right-aligned **action button** (translucent white@0.13 pill).

| State                   | title                          | body                                        | action             |
| ----------------------- | ------------------------------ | ------------------------------------------- | ------------------ |
| **Incoming** `560:1299` | `work-laptop pushed 3 changes` | `Review and apply them on this Mac.`        | **Review & Apply** |
| **Conflict** `560:1300` | `Conflict in .zshrc`           | `work-laptop and this Mac both changed it.` | **Resolve**        |

Content mirrors the in-app `Banner` tones (Incoming/Error) but in native chrome — the closed-window
counterpart to the in-app strip. Faithful to [ADR 0006](../../adr/0006-sync-model-transport-not-commit.md):
the poller **notifies**; the action ("Review & Apply" / "Resolve") opens the app where the user decides — the
poller never applies.

> The former **Applied** state (`560:1314`, "Applied N changes from work-laptop") was the **auto-apply
> confirmation** — retired with auto-apply ([ADR 0037](../../adr/0037-automation-ladder-transport-only.md)).
> The poller never applies, so there is no background apply to announce; manual-apply confirmation is the
> in-app toast.

## Screens — `Tray & notification (macOS)` section (`563:7125`, page 03)

Two desktop scenes (1280×820, a dark-wallpaper gradient + a translucent **menubar** strip — Apple
mark · Finder · File/Edit/View/Go · battery/control-center glyphs · the monochrome **dotden tray
icon** · `Fri 9:41` clock):

1. **`Tray · incoming` (`563:7126`)** — the tray icon **highlighted** (menu open) with the
   `TrayMenu` **Incoming** instance hanging from it, right-edge aligned under the icon. The hero: what
   you see when you click the menubar icon and there are incoming changes.
2. **`Notification states` (`566:7155`)** — the tray icon at rest (menu closed) with all **3
   `OSNotification`** instances **stacked** in the top-right corner (incoming → conflict → applied), as
   Notification Center stacks them.

Each scene was kept single-purpose so the two surfaces don't collide top-right.

## What this completes

Batch G was the last build of **Phase 5**. With tray + notification done and the final QA sweep clean,
the app design system covers every v1 surface: home, conflict, returning, confirm dialogs, commit, sync
states, file history, secret + errors, settings, and now the closed-window poller surfaces.
