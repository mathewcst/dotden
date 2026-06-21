# User Flow

The **expected behavior** of every dotden screen and the **end-to-end journeys** a user
travels — from first install, through daily use, to a second environment and beyond.

This folder answers two questions an implementing agent keeps asking:

1. **"What is the flow here?"** → [`journeys/`](journeys/) — narrative, cross-screen stories.
2. **"What should screen / component X do, and what does it fall back to?"** →
   [`screens/`](screens/) and [`states/`](states/) — per-surface reference specs.

> [!IMPORTANT]
> These docs describe **target behavior** (the spec), derived from the Figma design
> (file [`s9ajnbYy4cb4scVvpo1dd8`](https://www.figma.com/design/s9ajnbYy4cb4scVvpo1dd8/dotDen))
> and the canonical decision records. **Figma intent is the source of truth.** Where the
> shipped code diverges from this spec, the **code is the bug**, not these docs. Wiring gaps
> and divergences are tracked separately (audits / issues), **not** inline here — so these
> specs stay stable.

---

## How to read this folder

- **Start with a journey** if you're implementing or changing a flow end-to-end.
  Each journey links into the screen specs it touches.
- **Jump to a screen spec** if you're changing one surface and need its contract:
  layout, every element, every state, every action → outcome, and its empty/loading/error
  fallbacks.
- **Check the state docs** for cross-cutting matrices (sync states, banners, empty states)
  that appear across many screens.

Everything is cross-linked. File names are stable; link to files, not headings.

## Conventions (so this stays searchable + consistent)

- **Vocabulary is load-bearing.** Speak the [`CONTEXT.md`](../../CONTEXT.md) glossary exactly:
  **Den, environment, Remote, Provider, File, directory, Workspace, Nook, Scope, Placement,
  Secret reference, Track, Untrack, Delete everywhere, Conflict, Commit, Apply, Sync,
  Auto-sync.** Capitalize product concepts; **environment** stays
  lowercase. UI copy follows [`brand-and-vocabulary.md`](../brand-and-vocabulary.md).
- **Quote UI copy verbatim** in `"double quotes"`, mirroring Figma exactly. If a label is a
  guess or TBD, mark it `<!-- TBD -->`.
- **Reference Figma nodes** as `node 54:3` so they're greppable against
  [`design-system/inventory.md`](../design-system/inventory.md).
- **Reference code** as `file_path:line` — clickable, e.g. `src/renderer/features/shell/components/DenWindow.tsx`.
- **Link decisions, don't restate them.** Point at the governing ADR
  (e.g. [ADR 0026](../adr/0026-launch-routing-derives-entry-screen-from-registration-state.md))
  and summarize the decision in one line.
- **Never fail silently.** Every screen spec must state its empty / loading / error / offline
  fallback — those states are first-class UI, not afterthoughts.

## Relationship to the rest of `docs/`

| Source | Owns | This folder adds |
|---|---|---|
| [`CONTEXT.md`](../../CONTEXT.md) | Domain glossary (what each term means) | Uses the vocabulary; never redefines it |
| [`design-system/screens/`](../design-system/screens/) | Visual spec per surface (tokens, components, Figma node assembly) | **Behavior + flow**: actions, transitions, fallbacks, entry/exit |
| [`adr/`](../adr/) | Decisions + rationale | Links the decision into the flow where it bites |
| [`scope-v1.md`](../scope-v1.md) | What ships in v1 vs deferred | Marks per-flow what's v1 vs v1.1+ |

Design-system screen specs say **what a surface looks like**; these docs say **how it behaves
and where it leads**. Read both for a complete picture.

---

## The journeys

| # | Journey | The story |
|---|---|---|
| 01 | [First install → first Den](journeys/01-first-install-and-first-den.md) | Launch the app for the first time → create a new Den → connect a Remote → discover & Track files → first Commit → enable Auto-sync → enter the app |
| 02 | [Daily use](journeys/02-daily-use.md) | Edit → see pending changes → Commit → Sync (push); pull/notify of incoming → Review & Apply |
| 03 | [Second environment (adopt)](journeys/03-second-environment-adopt.md) | Install on machine 2 → connect the existing Den → claim an identity → pick Workspaces → Review & Apply onto this OS |
| 04 | [Conflicts](journeys/04-conflicts.md) | An incoming change collides with a local edit → Conflict resolver (Keep / Take / Both) → complete & Apply |
| 05 | [Secrets](journeys/05-secrets.md) | Commit-time secret detection → choose path → convert to a Secret reference via a password manager |
| 06 | [Errors, offline & diagnostics](journeys/06-errors-offline-diagnostics.md) | Offline change queue → reconnect & flush; Apply failure → retry; the Diagnostics console & on-error details |

## The screens

> Filled in as specs land. Each links its Figma node(s) and the route/condition that renders it.

- **Shell & home** — [home (3-pane)](screens/home.md) · [workspaces pane](screens/workspaces-pane.md) · [diff pane](screens/diff-pane.md) · [inspector pane](screens/inspector-pane.md) · [titlebar & status bar](screens/titlebar-statusbar.md)
- **Onboarding** — [onboarding/](screens/onboarding/) (landing chooser → connect → discover → commit → auto-sync → done)
- **Returning** — [returning/](screens/returning/) (claim identity → pick Workspaces → Review & Apply)
- **Operations (Commit · Apply)** — [operation surface](screens/operation-surface.md) (shared `ChangeList | Diff | OperationPanel` skeleton; Commit + Review & Apply variants) · [conflict resolver](screens/conflict-resolver.md) (in-center resolution)
- **File history** — [file history & restore](screens/file-history.md)
- **Secrets & errors** — [secret detection & references](screens/secrets-and-errors.md)
- **Settings** — [settings/](screens/settings/) (Automation · Commit · Sync & polling · Repository · Privacy · Environments · Diagnostics · About)
- **Tray & notifications** — [tray & OS notifications](screens/tray-and-notifications.md)
- **Diagnostics** — [diagnostics console](screens/diagnostics.md)

## Cross-cutting states

- [Sync states](states/sync-states.md) — syncing / up to date / N incoming / not synced · N changes
- [Banners](states/banners.md) — error / offline / incoming
- [Empty & loading states](states/empty-states.md) — every "nothing here yet" fallback

## Motion

- [Motion](motion.md) — interaction-animation principles, named patterns (the boot ticker, banner
  slide, toast, dialog scrim, operation-surface slide-up…), spring/duration tokens, and the reduced-motion rule.
  Screen specs reference these patterns by name rather than redefining them.

---

## Templates

To keep specs uniform and grep-friendly, every screen and journey doc follows a fixed shape.
Copy from [`_TEMPLATE-screen.md`](_TEMPLATE-screen.md) or [`_TEMPLATE-journey.md`](_TEMPLATE-journey.md).
