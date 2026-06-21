# Journey — Daily use · Automation ladder (02c)

> How much of the daily loop dotden carries for you. Two levels only — **Manual** and **Auto-sync** — and
> automation is **transport-only**: it moves data through git, it never writes your working tree.

Part of [Daily use](../02-daily-use.md). This is the automation that can drive the **send**
([Commit & push, 02b](../02-daily-use.md)) and **receive** ([Receive & Apply, 02a](receive-and-apply.md))
halves for you. The decision is recorded in
[ADR 0037](../../../adr/0037-automation-ladder-transport-only.md) (which revises
[ADR 0006](../../../adr/0006-sync-model-transport-not-commit.md)).

| | |
|---|---|
| **Preconditions** | An environment is registered & ready; a Remote is configured (onboarding) |
| **Outcome** | The chosen level governs what dotden does without being asked; the user can change it anytime |
| **Default** | **Auto-sync**, pre-selected at onboarding; downgradable to Manual at onboarding or in Settings |
| **v1 status** | ships v1 |
| **Screens touched** | onboarding automation pre-select (Journey 01), [Settings](../../screens/settings/automation.md) toggle, [status bar](../../screens/titlebar-statusbar.md) (state), tray/notifications |

## The core promise

> **Automation only ever moves data through git (push / fetch — reversible, touches no live file).
> Writing your working tree is always a deliberate human [Apply](receive-and-apply.md).**

There is **no auto-write-to-disk level**. "Clean" means *no git conflict*, not *safe to write over a live
shell or editor config* — so applying is always a deliberate human moment on the
[operation surface](../../screens/operation-surface.md). This is why YOLO and Auto-apply were cut
([ADR 0037](../../../adr/0037-automation-ladder-transport-only.md)).

## The two levels

| Level | Send (Commit → push) | Receive (fetch → Apply) | Risk |
|---|---|---|---|
| **Manual** | nothing automatic — you Commit, you push (`Sync now`) | poller **fetches to notify** only; you `Review & Apply` | — |
| **Auto-sync** _(default)_ | auto-**push** after each manual Commit | poller auto-**fetches** + **notifies**; **Apply still manual** | low |

What's the **same** at both levels:
- **Commit is always manual.** dotden never records your edits for you — the deliberate Commit is the feature
  (it's where you choose what enters the Den), and it keeps faith with chezmoi's commit-gated grain
  ([ADR 0003](../../../adr/0003-faithful-chezmoi-wrapper.md)).
- **Apply is always manual.** Incoming changes are only ever *presented*; they're written when you Apply on the
  [operation surface](../../screens/operation-surface.md) — [02a](receive-and-apply.md).
- The [invariants](../../../adr/0008-invariant-ownership.md) hold regardless: never auto-resolve a Conflict,
  never lose data silently, act only within subscription, confirm incoming deletions.

The only thing the level changes is **transport**: whether your Commits push themselves, and whether incoming
is fetched on a timer vs only when you ask.

## Triggers (what fires automation)

- **Receive — one background poller, both levels.** A tray/background poller **fetches on a fixed interval at
  every level** (even Manual must, to surface "N incoming"). The level only changes what happens *after* a
  fetch: Manual and Auto-sync both **notify** — neither applies. Interval is a sensible default (≈5 min),
  Settings-tunable (not specced here).
- **Send — event-driven, not polled.** Under Auto-sync, a **manual Commit is the trigger**: the Commit
  completes, then dotden pushes it. Under Manual nothing auto-pushes — you push with `Sync now`. (There is no
  file-watcher auto-Commit at any level — that was YOLO, removed.)

## What the user sees

- **Status bar** ([titlebar-statusbar](../../screens/titlebar-statusbar.md)) reflects transport state at both
  levels: `Syncing…` during an auto-push/fetch, `Synced <time> ago` when idle, `N incoming` when a fetch finds
  work, `Offline` when the poller is paused.
- **Incoming notification** — when a fetch finds incoming, dotden notifies (tray + the home inspector's
  incoming card). Identical at Manual and Auto-sync — the difference is only that Auto-sync got there without a
  `Sync now`. Acting on it is still a click into [Review & Apply](receive-and-apply.md).
- **Auto-push** is quiet: a brief status-bar `Syncing…` → `Synced`, no modal. A **failure is never silent** —
  it surfaces with the fix and a Console row ([ADR 0030](../../../adr/0030-diagnostics-local-redacted-command-log.md)).

## Choosing & changing the level

- **At onboarding** (Journey 01): an automation step with **Auto-sync pre-selected**; the user can switch to
  Manual before finishing. This reverses ADR 0006's "default is fully manual" — safe now that the ladder is
  transport-only ([ADR 0037](../../../adr/0037-automation-ladder-transport-only.md)).
- **In Settings**: a single toggle between Manual and Auto-sync, changeable anytime; the change takes effect on
  the next trigger (no restart). *(Settings UI specced separately, not here.)*

## Branches & edge cases

- **Offline** — poller pauses; a queued auto-push holds and **flushes on reconnect**; status bar shows
  `Offline` (journey [06](../06-errors-offline-diagnostics.md)). Nothing is lost or silently dropped.
- **Auto-push fails** (e.g. rejected non-fast-forward) — surfaced with the fix; the local Commit is intact and
  retried/`Sync now`-able. Auto-sync never force-pushes.
- **Incoming arrives under Auto-sync** — it is fetched and announced, **not applied**. Identical to Manual from
  the Apply side; only the fetch was automatic.
- **Conflict / incoming deletion in the fetched set** — irrelevant to the level: both are resolved/confirmed by
  the human on the [operation surface](../../screens/operation-surface.md), because there is no auto-apply path
  ([ADR 0008](../../../adr/0008-invariant-ownership.md)).

## What's v1 vs later

- **v1:** both levels, the onboarding pre-select, the Settings toggle, transport-only automation.
- **Not in v1 (and not planned):** any auto-write-to-disk level (Auto-apply / YOLO) — removed by
  [ADR 0037](../../../adr/0037-automation-ladder-transport-only.md), not deferred.

## Related

- [Receive & Apply (02a)](receive-and-apply.md) — the manual Apply that Auto-sync never replaces.
- [Commit & push (02b)](../02-daily-use.md) — the send half Auto-sync auto-pushes.
- [ADR 0037](../../../adr/0037-automation-ladder-transport-only.md) (the decision),
  [ADR 0006](../../../adr/0006-sync-model-transport-not-commit.md) (transport-not-commit),
  [ADR 0008](../../../adr/0008-invariant-ownership.md) (invariants).
- Glossary: [`CONTEXT.md`](../../../../CONTEXT.md) — **Auto-sync**, **Sync**, **Apply**.
