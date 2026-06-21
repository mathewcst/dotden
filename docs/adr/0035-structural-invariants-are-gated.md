# 0035 — Structural invariants are gated, not guided

**Status:** accepted · 2026-06-21 · a **scoped reversal** of "guide not gate" (ADR 0021,
ADR 0027 Phase 3) — for architecture + design-consistency only, not for craft.

ADR 0021 and ADR 0027 deliberately chose guides + review over lint gates, reserving hard
gates for cheap/deterministic hygiene (stale-disable error, prettier auto-apply). Under that
regime the renderer accumulated **61 native-HTML-where-shadcn-exists** sites (a prior audit,
`.scratch/AUDIT/shadcn-conformance.md`) and the layering drift ADR 0033 fixes — i.e.
guide-only **demonstrably failed** to hold the two invariants that matter most for renderer
coherence: the dependency graph and design-system consistency. Both are now expressible as
zero/low-false-positive lint rules. And — correcting a prior assumption — the team is **not
package-averse** about structural tooling: _"if an already-existing package solves our
problem, let's use it."_

## Decision

**Gate the structural invariants in CI.**

1. **Layer boundaries → `eslint-plugin-boundaries`** (purpose-built, flat-config). The rule is
   `boundaries/dependencies` set to `default: "disallow"` with the ADR 0033 graph
   (`boundaries/element-types` is now a deprecated alias — we use the modern rule). Elements are
   matched **first-match-wins**, so the most specific patterns lead (`app/providers` before `app`;
   `components/{den,ui}` before the catch-all `shared`), each in `mode: "folder"` so the matched
   _folder_ is the element **instance**. Because `checkInternals` defaults off, a same-instance
   import is internal and unchecked — which gives cross-feature encapsulation for free:
   `capture: ["feature"]` makes each feature folder a DISTINCT instance, so `features/a →
features/b` is cross-instance (checked, and with no feature→feature allow rule, disallowed)
   while a feature's own subtree stays internal. `feature` is thus the one element with **no
   self-allow**; every other element self-allows for intra-layer wiring (`app/App.tsx` imports
   sibling `app/` modules, a shadcn primitive imports another). Aliased imports (`@/*`,
   `@shared/*`) resolve via `eslint-import-resolver-typescript`, else an unresolved import is
   silently skipped. **`ui` is importable only by `den/` and `app/providers/`** — the
   latter being the narrow root-provider exception (ADR 0036): default plumbing like
   `TooltipProvider` / sonner `<Toaster/>` mounts vanilla `ui/`, with no `den/` wrapper.

   ```js
   // @dotden/eslint-config/renderer-boundaries.js — files: ['src/renderer/**/*.{ts,tsx}']
   // Canonical config; cwd is apps/desktop (where check:lint runs `eslint .`).
   settings: {
     "import/resolver": { typescript: { project: "tsconfig.web.json" } }, // resolve @/ , @shared/
     "boundaries/elements": [
       // First match wins; mode:'folder' → the matched folder IS the element instance.
       { type: "providers",   mode: "folder", pattern: "src/renderer/app/providers" },
       { type: "app",         mode: "folder", pattern: "src/renderer/app" },
       { type: "feature",     mode: "folder", pattern: "src/renderer/features/*", capture: ["feature"] },
       { type: "den-session", mode: "folder", pattern: "src/renderer/den-session" },
       { type: "den",         mode: "folder", pattern: "src/renderer/components/den" },
       { type: "ui",          mode: "folder", pattern: "src/renderer/components/ui" },
       { type: "shared",      mode: "folder", pattern: "src/renderer/{components,lib,hooks}" },
     ],
   },
   rules: { "boundaries/dependencies": ["error", { default: "disallow", rules: [
     // v6 object selectors. Root providers: the ONLY app-side path to ui/ (plumbing, ADR 0036).
     { from: { type: "providers" },   allow: { to: { type: ["providers","ui","den","den-session","shared"] } } },
     { from: { type: "app" },         allow: { to: { type: ["app","providers","feature","den-session","den","shared"] } } },
     // No `feature` here: cross-feature disallowed; intra-feature is internal (unchecked).
     { from: { type: "feature" },     allow: { to: { type: ["den-session","den","shared"] } } },
     { from: { type: "den-session" }, allow: { to: { type: ["den-session","shared"] } } },
     { from: { type: "den" },         allow: { to: { type: ["den","ui","shared"] } } },
     { from: { type: "ui" },          allow: { to: { type: ["ui","shared"] } } },
     { from: { type: "shared" },      allow: { to: { type: ["shared"] } } },
   ]}]}
   ```

2. **Native-HTML-when-shadcn-exists → core `no-restricted-syntax`** on `<button>`,
   `<input>`, `<select>`, `<textarea>`, `<label>` in the renderer. Bespoke a11y-native rows
   opt out with `// eslint-disable-next-line -- bespoke: <reason>`;
   `reportUnusedDisableDirectives` (already on) stops those exemptions from rotting.

This consciously reverses "guide not gate" **for structure/design only.** Craft concerns —
comments (ADR 0021), component size / one-per-file (`conventions.md`) — stay guides. The
split is **structure-vs-style**, not gate-vs-guide globally.

## Alternatives considered

- **Hand-rolled `no-restricted-imports` path patterns** instead of `eslint-plugin-boundaries`
  (zero new package). Works, but verbose for a layered graph and has no first-class
  feature-encapsulation; the purpose-built package is clearer and the team opted into it.
- **Gate boundaries only; keep native-HTML a guide.** A reasonable conservative split
  (boundaries is the crisp, false-positive-free win; native-HTML carries allowlist noise).
  Rejected in favor of both — design-consistency is exactly what the audit was about, and the
  escape-hatch keeps the allowlist visible and reasoned.
- **Stay guide-only (ADR 0021 status quo).** Rejected — the regime the drift accumulated under.

## Consequences

- **As shipped (A5 · 2026-06-21; snippet reconciled A6 · 2026-06-21).** The **layer-graph gate
  (Decision 1) is live and green** — `eslint-plugin-boundaries@6`, a rewrite over the v5-era
  syntax (the Decision snippet above now shows the shipped v6 `boundaries/dependencies` form).
  Implementation: `packages/eslint-config/renderer-boundaries.js`. Two v6 facts shape it: element
  `mode: 'folder'` makes each feature folder one _instance_, so intra-feature imports are internal
  and unchecked while cross-feature imports are checked and disallowed (cross-feature encapsulation
  needs no capture-template, just the per-feature `capture`); and `@/*`/`@shared/*` aliases resolve
  through `eslint-import-resolver-typescript` (node resolution can't see them, and an unresolved
  import is silently skipped). On landing the gate immediately caught two real drifts a manual pass
  had missed — a misfiled `CommitRow` (commit/ → file-history/, its sole consumer) and the
  `returning`/`onboarding` split (merged, ADR 0033). **The native-HTML gate (Decision 2) is
  deferred to Phase B:** ~25 native-HTML sites remain and most are settings/secrets/onboarding
  **form inputs** that need a real `den/` shadcn migration (Phase B), _not_ a `-- bespoke:` disable,
  so enabling the rule now would force ~25 dishonest disables. It lands when Phase B migrates those
  inputs. (The shadcn vendor files — `components/ui/**`, the `use-mobile` hook — are config-exempt
  from `react-hooks/set-state-in-effect`: CLI-owned code kept `shadcn add`-clean, ADR 0036.)
- Adds `eslint-plugin-boundaries` to `@dotden/eslint-config`, in a renderer-scoped `files:`
  override (the graph is renderer-specific).
- **The boundaries config _is_ the architecture documentation** — the element/rule list is the
  canonical, machine-checked statement of ADR 0033 + ADR 0036.
- ADR 0027's "scoped store is structurally enforced, not lint-enforced" still holds — the
  store-singleton rule stays skipped (structural reset covers it). This ADR gates _layering_
  and _native-HTML_, not the store pattern.
- **The bespoke-native allowlist** (tree rows, file rows, commit rows, diff lines, window
  controls) is documented in `conventions.md`; each live exception carries its `-- bespoke:`
  reason and dies the moment it stops being needed.
