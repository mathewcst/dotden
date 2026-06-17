# 0027 — Renderer feature-folders by domain capability, with a scoped den-session store

**Status:** accepted · 2026-06-16

The renderer (`apps/desktop/src/renderer/`) grew a flat `components/` bucket: ~20 loose
files mixing JSX components and non-JSX logic, a 1377-line `Workspace.tsx` god-component,
and four ad-hoc sub-folders (`onboarding/`, `returning/`, `settings/`, `ui/`). This ADR
reorganizes the renderer around **domain-capability features** and introduces a **scoped
Zustand store** as the shared-state seam. `main/` is untouched — its layering is ADR 0023.

## Decision

**1 — `features/` is organized by domain capability, named in glossary vocabulary.**
Each top-level user-facing capability gets a folder under `renderer/features/`:
`launch/` (ADR 0026 routing + the New/Connect chooser), `shell/` (the three-pane den
window), `workspace/`, `commit/`, `sync/`, `apply/`, `secrets/`, `scope/`, `file-history/`,
plus the pre-existing `onboarding/` `returning/` `settings/`. Cross-cutting dotden-specific
components live in `shared/`; scaffolded shadcn primitives stay in `ui/` (flat, exempt).

**The change-lifecycle split follows ADR 0006's seam, not git plumbing.** `commit/` is the
outbound act (Track → Changes → Commit); `sync/` is transport (push/pull, offline, incoming
_detection_); `apply/` is the inbound act (Review & Apply **+ Conflict** — a Conflict only
exists during an Apply). A single `git/` or `file/` feature was **rejected**: it reintroduces
the chezmoi/git plumbing vocabulary the product deliberately hides (ADR 0003) and erases the
Commit↔transport↔Apply distinction the whole sync model is built on (ADR 0006).

**2 — Code names must not overload glossary terms.** `Workspace.tsx` was the _den window_,
not a domain Workspace (a Group of Files, ADR 0005) — that lie is _why_ it accreted into a
1377-line god-component spanning the tree, the diff, the inspector, and three dialogs.
Likewise `git/`/`file/` collide with **File**. The composition root is therefore `shell/`,
and capabilities own their own panes/slices.

**3 — Shared state is a scoped `den-session` store, passed via React Context.** One Zustand
store, composed from per-feature slices (`commit/lib/commit-slice.ts`, …), created by a
factory inside `<DenSessionProvider>` and handed down through Context — **never a module-level
singleton** (tkdodo, "Zustand and React Context"). This is load-bearing: `App.tsx` resets the
A/B environment thread with `<… key={role}>` (remount wipes state); a global store would
_survive_ the remount and leak environment A's session into B. A provider keyed by `role`
gives each environment a fresh store with a real React lifecycle, preserving that reset.
Ephemeral UI state (input text, open menus) stays in `useState`.

## Alternatives considered

- **`git/` / `file/` feature bucket** (all of commit+sync+apply+conflict together). Rejected —
  see Decision 1: violates ADR 0003 (plumbing vocabulary) and ADR 0006 (the outbound/inbound
  seam), and `file/` overloads the **File** glossary term.
- **Type-folders (`components/` `hooks/` `stores/` at the renderer root).** Rejected: scatters
  one capability across many trees — the exact "hard to pinpoint where to change things" pain
  that motivated this. Features keep a capability's UI + state + tests in one place.
- **Module-global Zustand store with an explicit `reset()` action.** Rejected: easy to forget a
  field in `reset()`, producing a silent A/B state leak — the precise "never fail silently"
  failure mode we avoid. The scoped store makes reset structural (remount = new store).
- **Lifted `useState` + Context only (no Zustand).** Viable, and React Compiler (ADR 0011)
  removes the selector-perf argument for a store. Chosen Zustand anyway for _structure_:
  colocated actions and sliceable cross-pane state, matching the team's other apps.

## Consequences

- **Migration is phased to keep diffs reviewable.** PR1: scaffold `features/` and `git mv` the
  leaf features (pure renames, history preserved, zero logic change). PR2: add `zustand`, build
  the scoped store, split `Workspace.tsx` into `shell/` + feature panes/slices. PR3: cleanup.
  The risk-free moves never share a diff with the behavioral split.
- **`zustand` is a new renderer dependency** (none today) — a deliberate exception to the
  package-averse default, scoped to the renderer; `main/` stays dependency-light.
- Each feature is `components/` + `lib/` (+ a `hooks/` when one earns it — none today) with
  per-subdir `__tests__/` (ADR 0019). Placement rule: a module imported by one feature lives in that
  feature; imported by 2+ goes to `shared/`. Day-to-day specifics live in `../conventions.md`.
- **The scoped store is enforced structurally, not by lint (Phase 3 decision).** A guardrail _is_
  cheaply expressible: a one-line `no-restricted-syntax` rule on the selector
  `VariableDeclarator[init.callee.name='createStore']` flags a module-level `const xStore =
createStore()` while leaving the factory untouched (it does `return createStore(…)`, not a
  `VariableDeclarator`), with zero false positives on today's tree. It need not touch the shared
  `@dotden/eslint-config` either — a flat-config `files: ['src/renderer/**']` override in
  `apps/desktop` would scope it to the renderer. We **deliberately skip it anyway**: the
  factory-in-Context pattern already makes the A/B leak structurally impossible (remount = new
  store), the load-bearing `key={role}` contract is documented at `DenSessionProvider` +
  `LaunchRouter`, and we keep this "guide not gate" (ADR 0021). Recorded — rule and all — so the
  question is not re-litigated. The renderer-import and slice-relative-import conventions live in
  `../conventions.md`.
