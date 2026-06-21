# 0034 — `den-session` is a shared state leaf; the slices move out of features

**Status:** accepted · 2026-06-21 · amends ADR 0027 (the scoped den-session store survives;
its location and the slice-colocation rule change). Consequence of ADR 0033's layering.

ADR 0027 created one scoped Zustand store composed from per-feature slices
(`commit/lib/commit-slice.ts`, …), built by a factory inside `<DenSessionProvider>`, all kept
inside `features/shell/`. Two import facts: **(a)** the store factory imports sibling feature
slices (`shell/lib/den-session-store.ts` → `commit/lib`, `secrets/lib`, `apply/lib`); **(b)**
features import `useDenSession` back. Under the three-layer rule (ADR 0033) the provider moves
to `app/` — which turns every feature's `useDenSession` import into an illegal `feature → app`
edge, and exposes that **(a)** was already a `feature → feature` reach ADR 0027 tolerated only
because it all sat inside one `shell/` folder.

## Decision

**Promote `den-session/` to a shared leaf** — a renderer-root peer of `components/`, `lib/`,
`hooks/` — and **move the slices into it.**

```
den-session/             ◀ shared leaf — imports only lib/ + the @shared IPC contract
  store.ts               factory + the composed DenSessionState type
  context.ts             React Context + useDenSession(selector) hook
  slices/                session · commit · secrets · apply
  tree-node-model.ts     the den tree shape the store builds (was workspace/lib)
  remote-axis.ts         session-derived A/B decoration (was shell/lib)
```

Features import `useDenSession` from `@/den-session` — a **leaf**, so the edge is legal and
lint-clean. The `app/`-level `<DenSessionProvider key={role}>` only _mounts_ the store; ADR
0027's A/B reset stays structural (remount = new store). `den-session/` imports nothing
upward.

**Why move the slices out of features (superseding ADR 0027's colocation).** The store _is_
the shared-state seam — its slices are shared by definition: each is composed into one
cross-feature store and read by multiple panes. Keeping them in `features/x/lib` forced the
store to reach across into sibling features and forced the composed _type_ to union
feature-owned types — the coupling ADR 0033 forbids. Co-locating all slices with the store
makes the seam honest and the graph acyclic. **Cost:** a capability's state logic no longer
sits beside its components/tests. We accept it — an enforceable, cycle-free graph beats
colocation for the one genuinely shared piece of state. (Mirrors the composition guidance
"the provider is the only place that knows how state is managed.")

## Alternatives considered

- **Keep slices in features; provider in `app/`; carve a "features may import the session
  hook" exception** (or a shared hook shim). Rejected: an exception erodes the one-way graph,
  and the composed-store _type_ still has to import every slice somewhere — the upward type
  edge returns.
- **Context-interface dependency injection** — a generic `DenSessionState` interface +
  `useDenSessionStore<T>(selector)` in a shared leaf, features depend only on the interface,
  `app/` injects concrete slices. Most decoupled and fully enforceable, but every slice is
  declared twice (interface + impl) — boilerplate out of proportion to a single-app renderer.
  Kept in reserve if the store ever needs genuine multi-implementation DI.

## Consequences

- `git mv` the four slices + `tree-node-model` + `remote-axis` into `den-session/`; repoint
  imports. The slice cluster can finally use `@/den-session` instead of the relative-import
  workaround ADR 0027 documented — so ADR 0027's "store slices import each other relatively"
  convention is **retired** (they are one module now).
- The node-env slice tests move with the slices and import within `den-session/` relatively
  (same node-env-no-alias reasoning as before, new home).
- `tree-node-model` leaving `workspace/` is what lets the **Tree view stay a feature** while
  its _model_ becomes shared — the tree placement settled in ADR 0033's discussion.
- New session state → a slice in `den-session/slices/`, never a new `features/x/lib` slice.
