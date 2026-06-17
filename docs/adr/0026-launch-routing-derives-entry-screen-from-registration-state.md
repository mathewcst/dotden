# 0026 — Launch routing derives the entry screen from registration state

**Status:** Accepted.
**Complements** [ADR 0022](./0022-onboarding-gate-is-feature-detection-not-emptiness.md) — that gate classifies _repo content at connect time_ (empty / dotden-managed / adopt / refuse); **this** gate is the _launch-time routing_ decision (which screen to show on boot). They are different gates on different axes.
**Faithful-wrapper consequence** of [ADR 0003](./0003-faithful-chezmoi-wrapper.md) and the data model in [ADR 0024](./0024-synced-vs-local-data-architecture.md).
**Renderer home:** the `'booting'`/route machine described here now lives in `features/launch/LaunchRouter`, not `App.tsx` — see [ADR 0027](./0027-renderer-feature-folders-and-scoped-den-session-store.md) (renderer feature-folders + the scoped den-session store).

## Decision

On boot the renderer starts in a `'booting'` splash and calls a single main-process IPC, `den.launchState()`, which returns a discriminated status derived from existing state:

```
ready       — EnvironmentRegistry.self() != null        → route to 'app'
incomplete  — not registered, but sourceDir is a clone   → route to 'landing' (v1)
fresh       — nothing cloned here                         → route to 'landing'
```

There is **no stored `onboardingComplete` flag**. "Has this environment finished setup?" is _derived_ from chezmoi + the synced registry — never a dotden boolean.

## Why

`App.tsx` hardcoded `useState<Route>('landing')` with no bootstrap, so a fully set-up environment re-showed the chooser/onboarding on every launch — the bug this fixes.

The faithful predicate is **"is this environment registered in the Den?"** = `EnvironmentRegistry.self() != null` (the registry entry, written before any Apply). `self()` flips to non-null exactly at the app handoff — for a new environment via the lazy `env:list → setupIdentity` registration, for a returning one via the explicit `claim` / `registerNew` at the review step — so it cleanly means "finished setup," with no separate flag to keep in sync. A stored boolean would duplicate truth that already lives in the registry and the clone, and could drift from them (ADR 0003 / 0024).

## v1 routes `incomplete → landing`, not a resume

`self()` reads `.myenv/environments.json`, which is absent until cloned, so `self() == null` covers **both** `fresh` and `incomplete`; distinguishing them needs a separate clone check (`sourceExists`).

A would-be _returning_ environment that abandons setup after `connect` but before claiming sits in `incomplete`. Auto-routing it into the app would let `env:list` self-register it as a **brand-new** environment — minting a fresh id instead of **claiming** its existing registry entry — breaking ADR 0024's continuous-history guarantee. So `incomplete` routes to `landing` for an explicit New/Connect re-choice.

Smart-resume (re-enter the correct wizard _past_ the already-done `connect` step, deriving new-vs-returning from `suggestClaims()`) is a deliberate follow-up, not part of fixing the gate. The IPC already returns the full three-state status, so that follow-up needs **no contract change** — only new renderer routing.

## Consequences

- Add a `sourceExists()` foundation helper (detects a valid clone in `sourceDir`) — none exists today.
- `launchState()` must compute from **cheap fs + side-effect-free registry reads** and must **not** depend on a fully-built `DenService` or call `env:list`/`setupIdentity` (those register as a side effect, and the lazy/retry service singletons assume a working clone that does not exist in `fresh`). The gate cannot depend on the thing it is gating.
- The renderer gains a `'booting'` route so the chooser never flashes before the answer resolves.

## Rejected alternatives

- _Store an `onboardingComplete` flag_ — duplicates registry/clone truth and can drift; violates the derive-don't-store posture of ADR 0003/0024.
- _`incomplete → app` (self-register on open)_ — mis-registers returning environments as new, violating ADR 0024 continuous history.
- _Build smart-resume now_ — separate "resume where you left off" feature; out of scope for the gate fix and needs UX it does not have yet.
