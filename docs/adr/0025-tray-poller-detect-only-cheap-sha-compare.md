# 0025 — The TrayPoller detects-and-notifies only, over a cheap latest-SHA compare

**Status:** accepted · 2026-06-16

dotden needs to learn that _another environment changed the Den_ even when the window is closed, so the user gets told without having to open the app. This ADR fixes how that background watcher behaves. It sharpens ADR 0006 (Sync is transport, not Commit/Apply) and ADR 0008 (`AutomationPolicy` gates levels by depending on the invariant owners) for the always-on case, and builds on ADR 0020 (the transport floor is pure git, no Provider API).

## Decision

The **`TrayPoller` only detects and notifies — it never Commits, Applies, or resolves anything.** When it sees the Remote move, it raises an OS notification (and nudges an open window to refresh); landing the change is still the user's reviewed Apply. Three rules make that cheap and correct:

1. **Detection is a `git ls-remote` latest-SHA compare, not a fetch and not a Provider API.** Each tick reads the branch's advertised commit SHA (the `latestRemoteSha` primitive, ADR 0020) and compares it to the SHA this environment has already seen (seeded from local `HEAD`). It **fetches/notifies only when the SHA moved**, so a quiet Remote costs one tiny network round-trip and nothing else — no clone, no rate-limit cost, no battery drain. This is provider-agnostic by construction: it works on any git Remote, with no GitHub/GitLab API.

2. **The poller is independent of Auto-sync.** Even a `manual` environment polls, because _notify-on-incoming is awareness, not automation_. Auto-sync changes whether a Commit auto-pushes (ADR 0008); it does not change whether the user is told about incoming changes. So the watcher runs at every automation level, and turning Auto-sync off never turns the watcher off.

3. **The cadence is adaptive: idle backoff, focus speed-up.** The interval lives between a fast floor (used while the window is focused — the user is working, freshness matters) and a slow idle ceiling (reached by multiplying the interval after each quiet tick). Activity (the SHA moved, or the window gains focus) snaps it back to the floor; `powerMonitor` wake/unlock forces an immediate fresh tick (a timer set before sleep may be stale). So the watcher feels live in use yet costs almost nothing idle.

The watcher is **Electron-free at its core** (ADR 0023): the SHA reader, the notifier, the timer scheduler, and the reconnect signal are all injected seams, so the entire poll loop — including the SHA-moved decision and the backoff math — is driven by a fake clock in plain-Node unit tests. `index.ts` wires the real `Tray` (which keeps the process alive with the window closed), `Notification`, `setTimeout`, and `powerMonitor`.

## Why

- **Fetching every tick would be wasteful and, on metered Providers, rate-limit-hostile.** The advertised-SHA compare is the cheapest possible "did anything change?" question git can answer, and it is exactly enough: if the SHA did not move, nothing is incoming. Fetching is reserved for when there is something to fetch.
- **A Provider API would break the v1-lean floor (ADR 0020).** Change-detection via the GitHub/GitLab API is a per-Provider convenience deferred past v1; `git ls-remote` gives the same signal on _any_ Remote with the user's existing credentials.
- **Coupling the watcher to Auto-sync would be a correctness bug.** Users who keep Apply manual (the safe default) are precisely the ones who most need to be _told_ something is waiting. Awareness must not be gated behind an automation opt-in.
- **A fixed cadence forces a bad trade.** Fast everywhere drains battery; slow everywhere feels dead when you are actively working. Backing off while idle and speeding up on focus gets both.

## Consequences

- **The poller never carries an invariant.** It is on ADR 0008's "must not re-check an owner's invariant" list for a reason: it only observes a SHA and fires a notification, so there is no Apply/Conflict/subscription decision in it to get wrong. Landing a change always re-enters through `SyncEngine` → `ApplyPlanner` → the reviewed Apply, where the owners gate safety.
- **A read error never kills the watcher.** A transient `ls-remote` failure (offline, flaky DNS) is surfaced (never fail silently) and the next tick is still armed — the background loop must never crash the app.
- **The tray is functional chrome only here.** This slice gives the tray a blank icon and a tooltip so the process stays resident with the window closed; the branded, live-state-driven native tray menu is a later slice (issue 3-06), and richer notification content is issue 3-07.
- **The automation level is environment-local.** Auto-sync is per-environment by definition (CONTEXT.md), so the level persists in Electron `userData`, never in the synced `.myenv/` (ADR 0024). A missing/corrupt/forward-incompatible settings file falls back to the safe Manual rung — never silently into a more-automated mode.
