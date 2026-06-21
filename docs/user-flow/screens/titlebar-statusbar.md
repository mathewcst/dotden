# Screen — App shell chrome (titlebar · bottom status bar · Console)

| | |
|---|---|
| **Figma** | titlebar + body on home `node 54:3`; bottom bar + Console on `node 781:7726` (`design-system/inventory.md`) |
| **Enforcement target** | `src/renderer/features/shell/components/TitleBar.tsx`, `StatusBar.tsx`, `BottomPanel.tsx`, `EnvironmentBadge.tsx`; Console rows `src/renderer/features/diagnostics/components/CommandRecord.tsx` |
| **Route / render condition** | Global chrome — wraps every in-app screen (not onboarding/returning full-takeover steps) |
| **environment role** | n/a (chrome is environment-agnostic; it *displays* the current environment, never switches it) |
| **Governing ADRs** | [ADR 0007](../../adr/0007-observability-wide-events-local-traces.md) — trace/diagnostics model behind the Console; [ADR 0023](../../adr/0023-main-process-layering-electron-free-foundation.md) — Command log the Console tails |
| **v1 status** | ships v1 |

## Purpose

The persistent frame around every working screen. It does **not** carry navigable context — it carries
**identity and ambient status**: what you're searching, the global actions, which **environment** you're on,
its sync health, and a toggle into the live **Console**. Each domain concept has exactly one home here so
nothing is shown twice.

## When the user sees it

Always, once past launch/onboarding — it's the chrome around [home](home.md) and every other in-app surface.

## Layout

```
┌─────────────────────────────────────────────────────────────────────────┐
│ [⦿⦿⦿]            🔍 Search files & workspaces…            🔔  ⚙  (M)      │  titlebar
├──────────────┬──────────────────────────────────┬─────────────────────────┤
│  left pane   │            center pane           │     right inspector     │  body (see home.md)
│              │                                  │                         │
├──────────────┴──────────────────────────────────┴─────────────────────────┤
│ ❯ Console                          Copy diagnostics  ⤓  ✖  ⌄  ✕            │  Console (collapsible)
│   … live Command-log rows …                                               │
├───────────────────────────────────────────────────────────────────────────┤
│ 🖥 this-mac •  · macOS  · ⚠ Diagnostics              ↕ Synced 4m ago       │  status bar (always on)
└───────────────────────────────────────────────────────────────────────────┘
```

- **Titlebar window controls are per-OS:** mac = **left** (traffic lights); Windows/Linux = **right**. Figma
  maintains the **mac reference only** — control placement is an OS concern, not a design variant.
- The **Console** sits *above* the status bar and is collapsible; the **status bar** is always visible.

## Elements & copy

**Titlebar**
- Window controls (OS-native, per-OS placement).
- Center: search input — `"Search files & workspaces…"`.
- Right, actions only: notifications (bell), settings (gear), profile (avatar, e.g. `M`).
- **Deliberately absent:** any Workspace label (e.g. `Personal ⌄`) and any sync pill (`Synced 4m ago`).
  Workspaces live in the [left pane](home.md); sync state lives in the status bar below.

**Status bar** (always visible)
- Left: environment `🖥 this-mac` + health dot `•` · OS `macOS` · `Diagnostics` (toggles the Console;
  turns **orange / ⚠** when error records exist).
- Right: sync state `↕ Synced 4m ago`. **This is the single home for environment · OS · diagnostics · sync.**

**Console** (collapsible — the **Diagnostics Console**, a live tail of the **Command log**)
- Tab `Console` + new-tab `+`; toolbar: `Copy diagnostics`, filter, clear, collapse `⌄`, close `✕`.
- Each row: exit-code badge (e.g. `0`, `EXIT 1`) + command (`chezmoi status`) + timestamp (`12:04:02`) +
  `traceId` (`TR-9F2C1B`) + expandable redacted `STDERR`. Secrets are redacted at capture (`REDACTED`).

## States & variants

- **Status bar — sync:** `Synced · <time> ago` / `Syncing…` / `N incoming` / `Not synced · N changes` (committed, not yet pushed) / `Offline` — see
  [states/sync-states.md](../states/sync-states.md).
- **Status bar — Diagnostics:** neutral (no errors) vs **orange `⚠ Diagnostics`** (error records present).
- **Console:** collapsed (default) vs expanded; empty (no records yet) vs streaming.

## Actions → outcomes

| Action | Trigger | Result | Enforcement (IPC / state) |
|---|---|---|---|
| Search | type in titlebar input | filters files & Workspaces | renderer-local filter over the session tree |
| Notifications | click bell | opens notifications surface | TBD spec |
| Settings | click gear | opens settings | navigates to settings/ |
| Profile | click avatar | account/profile menu | TBD spec |
| Toggle Console | click `Diagnostics` (or Console `⌄`/`✕`) | expand/collapse the Command-log tail | local UI; reads the Command log (ADR 0023) |
| Copy diagnostics | Console toolbar | copies redacted diagnostics bundle for a bug report | `api.diagnostics.copy(...)` |

## Motion

- Console expand/collapse uses [`banner-slide-down`](../motion.md#banner-slide-down) semantics in reverse
  (slides from the bottom edge, pushes body up rather than overlapping). **Reduced motion:** fade only.
- Status-bar value changes (sync text, Diagnostics turning orange) **cross-fade** in place — no movement.

## Fallbacks (never fail silently)

- **Empty (Console):** "No diagnostics yet" rather than a blank panel.
- **Loading:** status bar shows `Syncing…`; never a blank sync slot.
- **Error:** an errored operation flips `Diagnostics` to **orange ⚠** and writes a Console row with exit code
  + redacted STDERR + the fix — the error is always reachable, never swallowed.
- **Offline:** status bar shows `Offline`; see [states/banners.md](../states/banners.md).

## Exits

- Settings, notifications, profile open their respective surfaces.
- `Diagnostics` / Console is in-place (no navigation).

## Related

- [home](home.md) — the body this chrome wraps.
- Journeys: [01](../journeys/01-first-install-and-first-den.md), [02](../journeys/02-daily-use.md),
  [06 errors/diagnostics](../journeys/06-errors-offline-diagnostics.md).
- **Decision log:** the titlebar was stripped of the Workspace label and sync pill, and environment + OS +
  diagnostics + sync state were consolidated into the bottom status bar (session 2026-06-21). Window is
  **unified across Workspaces** — no per-Workspace window scoping.
