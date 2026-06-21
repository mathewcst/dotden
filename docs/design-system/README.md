# dotden — App Design System

> The visual + component system for the **dotden desktop app** (Electron + React),
> designed in Figma (`s9ajnbYy4cb4scVvpo1dd8`, file "dotDen") and mirrored to code via
> shadcn/ui. Split from the former monolithic `design-system.md` into one topic per file.
> Domain & vocabulary: [../../CONTEXT.md](../../CONTEXT.md) · architecture decisions:
> [../adr/](../adr/).

> Scope: the **app** only. The marketing landing page is a separate (now-deprecated)
> artifact and shares none of these constraints.

This folder is the design system, one topic per file. Grep a keyword, open the file, follow
the relative links. Start here to find the right file.

> 🗺️ **Need a Figma node ID** — a component, its property keys, a page, a screen, or a token
> bind-ID? → **[inventory.md](./inventory.md)** is the canonical map. Grep it first; it saves a
> canvas crawl. (Treat IDs as living — re-confirm by name before a mutation.)

## Definition of Done — document as you go (the strict rule)

**A design portion is _done_ only when its docs are.** A "portion" is fine-grained: any committed
change to a component, screen, token, or page structure — _or_ a newly-learned gotcha/decision.
Document it **the moment it's true, not at end-of-session** — the gotchas that slip are the deferred
ones. A fresh agent must be able to read this folder and be fully current before touching Figma.

| When you…                                             | Update…                                                                                                                            |
| ----------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------- |
| Add/change a **component** (anatomy, props, variants) | [components.md](./components.md) + [inventory.md](./inventory.md) (ID + prop keys) + set a one-line `.description` in Figma        |
| Hit a **gotcha / API quirk / workaround**             | [figma-conventions.md](./figma-conventions.md) — new `###` heading (grep-able)                                                     |
| Make a **decision / pick between alternatives**       | the relevant doc inline; if architectural → an [ADR](../adr/)                                                                      |
| Finish a **screen or flow**                           | [screens/&lt;flow&gt;.md](./screens/) + [inventory.md](./inventory.md) (section/screen IDs)                                        |
| Change **tokens / type / effects**                    | [color-tokens.md](./color-tokens.md) / [typography.md](./typography.md) / [radius-spacing-effects.md](./radius-spacing-effects.md) |
| Move/rename **pages or components**                   | [architecture.md](./architecture.md) + [inventory.md](./inventory.md)                                                              |

Enforcement is this checklist — read it and follow it. (A `/design-done` ritual command may be added
later; no hook for now.)

## Foundations & reference (stable)

| Topic                      | File                                                     | Read this when…                                                                                       |
| -------------------------- | -------------------------------------------------------- | ----------------------------------------------------------------------------------------------------- |
| Direction                  | [direction.md](./direction.md)                           | deciding aesthetic — dark-only, ember accent, functional-color discipline, type direction             |
| Inheritance model          | [inheritance.md](./inheritance.md)                       | mapping shadcn/Nova → dotden tokens & components; the `shadcn add` + globals.css override workflow    |
| Color tokens               | [color-tokens.md](./color-tokens.md)                     | looking up a hex/token — ink ramp, ember, functional hues, semantic aliases, `status/*` domain tokens |
| Typography                 | [typography.md](./typography.md)                         | picking a text style — Geist / Geist Mono sizes, the 14 named styles                                  |
| Radius / spacing / effects | [radius-spacing-effects.md](./radius-spacing-effects.md) | radius & spacing scale values, shadow/glow effect names, density (32px controls)                      |

## Components & conventions

| Topic                       | File                                           | Read this when…                                                                                                                                                                                                                                                                       |
| --------------------------- | ---------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Components                  | [components.md](./components.md)               | what Figma component sets exist — atoms, dotden composites, the **`SelectRow`/`ListRow`** row families (M4), Diff family, `Toast`, `Dialog`, `Banner`, `CommitRow`, the `SecretWarning`/`SecretPicker` modals, icons, `AppShell` & panes (incl. `AppPane/Commit` & `AppPane/History`) |
| Figma conventions / gotchas | [figma-conventions.md](./figma-conventions.md) | scripting the Figma file — white-fill audit, clone→black bug, FILL→1px collapse, icon-color rule, pane-bg tokens, `vectorPaths` limits                                                                                                                                                |
| Architecture & page org     | [architecture.md](./architecture.md)           | the no-duplication rule (component-vs-raw-frame) + Figma page taxonomy (`Components — <Flow>` / `Screens — <Flow>`) mirroring React                                                                                                                                                   |
| **Node-ID map**             | **[inventory.md](./inventory.md)**             | **looking up any node ID** — every page, component (+ prop keys), section & screen, plus common token bind-IDs. Grep this first.                                                                                                                                                      |

## Screens & flows (grows per phase)

| Screen / flow           | File                                                                   | Read this when…                                                                                                                                                                                                                                                                                  |
| ----------------------- | ---------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| Signature three-pane    | [screens/signature-screen.md](./screens/signature-screen.md)           | referencing the main window — titlebar, sidebar, diff center, inspector; the source-of-truth screen (`54:3`)                                                                                                                                                                                     |
| Onboarding              | [screens/onboarding.md](./screens/onboarding.md)                       | building/editing the 7-screen first-run — `OnboardingShell`/`OnboardingMenu`/`OBContent/*`/`ListRow` (scan rows)                                                                                                                                                                                 |
| Conflict resolver       | [screens/conflict-resolver.md](./screens/conflict-resolver.md)         | the conflict flow — `MergeHunk`, `AppPane/ConflictFiles\|Merge\|Resolve`, unresolved→resolved screens                                                                                                                                                                                            |
| Returning environment   | [screens/returning-environment.md](./screens/returning-environment.md) | second-environment wizard + Review & Apply — `ReturningMenu`, `SelectRow` (workspace rows), wizard→app handoff                                                                                                                                                                                   |
| Confirmation dialogs    | [screens/confirm-dialogs.md](./screens/confirm-dialogs.md)             | Track / Untrack / Delete-everywhere confirms — the `Dialog` modal over a scrim-dimmed app window                                                                                                                                                                                                 |
| Commit flow             | [screens/commit.md](./screens/commit.md)                               | Pending → Committed — the `AppPane/Commit` composer (message + template), Commit changes → Sync now                                                                                                                                                                                              |
| Sync states             | [screens/sync-states.md](./screens/sync-states.md)                     | Syncing / Up to date / N incoming / Not synced · N changes — the `Banner` strip inserted into `AppShell` + titlebar/inspector overrides                                                                                                                                                                 |
| File history            | [screens/file-history.md](./screens/file-history.md)                   | per-File version list + restore-forward — the Diff pane's **History** tab (`AppPane/History` master-detail, `CommitRow`) + restore-confirm `Dialog`                                                                                                                                              |
| Secret + offline/error  | [screens/secret-and-errors.md](./screens/secret-and-errors.md)         | commit-time secret **2-step** (`SecretWarning` → `SecretPicker`; `RadioRow`/`PMOption`) + **Offline** & **Apply-failed** states; onboarding `DiscoverRow` Blocked→Warn reconciliation                                                                                                            |
| Settings (7 tabs)       | [screens/settings.md](./screens/settings.md)                           | the config surface — `SettingsShell` (shared `Titlebar` + nav rail + `Content` swap) + `SettingsContent/*` (Automation ladder / Commit / Sync / Repository / Privacy / Environments / About)                                                                                                     |
| Tray & notification     | [screens/tray-and-notification.md](./screens/tray-and-notification.md) | the poller's closed-window surfaces — `TrayMenu` (menubar dropdown, 4 states) + `OSNotification` (toast, 3 states) as **native macOS chrome** (the one dd/\* token exception; Inter not SF Pro)                                                                                                  |
| Diagnostics (Feature 1) | [screens/diagnostics.md](./screens/diagnostics.md)                     | the observability surfaces ([ADR 0030](../adr/0030-diagnostics-local-redacted-command-log.md)) — the global `BottomPanel`/Console, the new `StatusBar` (env identity moved here + Diagnostics badge), on-error **Details**, and Settings → Diagnostics; `CommandRecord` + the `[REDACTED]` token |
