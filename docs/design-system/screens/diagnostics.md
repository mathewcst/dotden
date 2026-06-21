# Diagnostics (Feature 1 · Figma page `03 · Screens — App`, section `791:8424`)

> The observability surfaces from [ADR 0030](../adr/0030-diagnostics-local-redacted-command-log.md):
> three layered surfaces over one redacted **Command log** — the on-error **Details** disclosure
> (load-bearing), the **Copy diagnostics** export, and the opt-in **Console**. Vocabulary is ratified in
> [CONTEXT.md](../../../CONTEXT.md) (Diagnostics · Command record · Command log · Console). Built from the
> [design system](../README.md); new components in [components.md](../components.md) /
> [inventory.md](../inventory.md) (section `791:10664`).

## New shell structure

The app grid graduates from `[titlebar / banner / body]` to **`[titlebar / banner / body / BottomPanel /
StatusBar]`** — a real, global change, not a one-off Console pane:

- **`BottomPanel`** (`778:1490`) — a reusable VSCode-style tabbed region. The **Console** is one tab; the
  ghost `+` reserves room for future tabs. Header carries the toolbar (**Copy diagnostics** · filter ·
  clear · collapse · close); body tails completed **Command records**, not byte streams.
- **`StatusBar`** (`776:9624`) — a new full-width bottom bar. **Env identity (`🖥 this-mac ● · macOS`) is
  relocated here from the sidebar footer** (the `AppPane/Workspaces` footer is hidden on these screens).
  It also carries the **Diagnostics badge** — the VSCode-native discoverability path — and sync status.

## Screens

- **Console open** (`781:7726`) — everyday three-pane app with the Console docked. `StatusBar` in
  `Console-on` (ember-active Diagnostics badge). The tail shows a real debugging moment: `chezmoi apply`
  fails with a redacted `op read … Authorization: Bearer [REDACTED]` stderr (`CommandRecord` Expanded), the
  user runs `op signin`, the next `apply` succeeds. Exit chips (green `0` / red `exit N`), timestamps, and
  `traceId` chips per record.
- **On-error Details** (`784:7912`) — **the load-bearing surface.** A failed Sync raises a red error banner
  ("couldn't read a secret from 1Password") with **View details** + Retry. The panel opens in **Details**
  mode — tab reads `Details`, **Copy diagnostics** is the ember primary, records filtered to the failed
  Operation's `traceId`. `StatusBar` in `Errors` (red `2` count, "Sync failed"). **Ungated by the Console
  toggle** (ADR 0030): an error always summons the panel.
- **Settings — Diagnostics** (`788:8288`) — `SettingsShell` with `SettingsContent/Diagnostics` swapped in
  and an active `Diagnostics` nav item: **Enable Console** toggle · **Copy diagnostics** · **Open log
  location**; a loud amber **Unredacted-mode** card (session-scoped, "writes real secret values to disk",
  with the _Copy diagnostics always stays redacted_ caveat); and a redact-at-write footnote.

## Redaction visual language

Masked spans render as a deliberate ember `[REDACTED]` token (not raw `••••`), so "we protected this"
reads as intentional, not noise. Templated/secret-bearing stdout is shown as `[rendered output omitted]`
(structural omission per ADR 0030). **Copy diagnostics** is always redacted regardless of Unredacted mode.

## Open / deferred

- **`BottomPanel` Mode variant** — Details mode is currently a screen-level override (tab label + primary
  Copy diagnostics). Promote to a `Mode=Console|Details` variant when built.
- **`CommandRecord` text props** — command/args/timestamp/traceId are raw text per instance; expose as
  component TEXT properties when the component graduates.
- **Output-omitted variant** — add a `State=Expanded-omitted` CommandRecord (`[rendered output omitted]`).
- The Diagnostics nav `SidebarItem` icon is `SquareTerminal` (swapped on the detached Settings screen).
