import boundaries from 'eslint-plugin-boundaries'

/**
 * Renderer layer-boundary gate — the machine-checked statement of the renderer's
 * three-layer architecture (ADR 0033) and two-tier component surface (ADR 0036),
 * gated per ADR 0035. **Read the `boundaries/elements` + `dependencies` rules below as
 * the canonical dependency graph** — this config _is_ the architecture documentation.
 *
 * The one-way graph:
 *
 *     app → features → shared leaves (components/{ui,den}, lib, hooks, den-session)
 *
 * plus the surface split (ADR 0036): only `den/` — and the narrow `app/providers/`
 * plumbing exception — may import `ui/`. Nothing imports `app/`; a feature never imports
 * another feature.
 *
 * SCOPE / CWD. Desktop renderer only. It lives in the shared `@dotden/eslint-config`
 * (ADR 0035) but is `files`-scoped to `src/renderer/**`, so it is inert for any other
 * consumer of `react-app` (today desktop is the only one). Every path here — the element
 * `pattern`s AND the resolver `project` — is relative to the app root, the cwd ESLint
 * runs from (`apps/desktop`, where `check:lint` is `eslint .`).
 *
 * v6 NOTES. This is `eslint-plugin-boundaries@6`, a rewrite over the v5-era syntax the
 * ADR 0035 snippet first sketched (A6 reconciles that snippet to this shipped form):
 *
 *  - The modern rule is `boundaries/dependencies`; `boundaries/element-types` is now a
 *    deprecated alias of it. We use the modern rule.
 *  - `checkInternals` defaults to **false**, so a file importing another file of the SAME
 *    element instance is _internal_ and not checked. That is precisely how a feature
 *    imports its own subtree freely while staying walled off from OTHER features: the
 *    per-feature `capture: ['feature']` makes each feature a DISTINCT element instance, so
 *    `features/a → features/b` is a cross-instance dependency that IS checked and — with
 *    no feature→feature allow rule — disallowed. `feature` is therefore the one element
 *    with **no self-allow**; every other element self-allows for intra-layer wiring.
 *  - Imports resolve through `eslint-import-resolver-typescript` so the renderer's `@/*`
 *    and `@shared/*` tsconfig aliases map to real files. Node-only resolution can't see
 *    them, and an unresolved import is treated as external and skipped — so without this
 *    the gate would silently ignore every aliased cross-layer import (i.e. almost all of
 *    them, since the convention is `@/…` over deep `../../`). Imports that resolve OUTSIDE
 *    `src/renderer/` (the `@shared/*` IPC contract, node_modules) match no element and are
 *    left to other concerns — the renderer-never-imports-main wall is the separate grep
 *    invariant of ADR 0031, not this gate.
 */
export const rendererBoundaries = {
  files: ['src/renderer/**/*.{ts,tsx}'],
  // Tests deliberately reach across layers (a feature test mounting an app harness, a
  // den-session test importing a feature fixture, shared test utilities). ADR 0035 ignores
  // them — they assert behavior, not architecture.
  ignores: [
    'src/renderer/**/__tests__/**',
    'src/renderer/**/*.test.{ts,tsx}',
    'src/renderer/test/**',
  ],
  plugins: { boundaries },
  settings: {
    // Resolve `@/…` (→ src/renderer) and `@shared/…` (→ src/shared) via the renderer build
    // tsconfig, which owns those `paths`. Boundaries reuses eslint-plugin-import's resolver
    // infrastructure — the `import/resolver` setting — even without that plugin installed.
    'import/resolver': {
      typescript: { project: 'tsconfig.web.json' },
    },
    // First match wins — most specific patterns lead (providers before app; den/ui before
    // the components catch-all).
    //
    // `mode: 'folder'` is LOAD-BEARING, not decoration: it makes the matched *folder* the
    // element instance, so every file under e.g. `features/onboarding/**` shares one
    // instance. That is what makes an intra-feature import _internal_ (same instance →
    // unchecked) while a `features/onboarding → features/commit` import is cross-instance
    // and IS checked. (Under `mode: 'full'` each FILE is its own instance, which wrongly
    // flags a feature importing its own siblings.) Patterns name the folder; folder mode
    // matches every file beneath it. The `*` in the feature pattern is captured as the
    // feature name, so the instances stay distinct per feature.
    'boundaries/elements': [
      { type: 'providers', mode: 'folder', pattern: 'src/renderer/app/providers' },
      { type: 'app', mode: 'folder', pattern: 'src/renderer/app' },
      {
        type: 'feature',
        mode: 'folder',
        pattern: 'src/renderer/features/*',
        capture: ['feature'],
      },
      { type: 'den-session', mode: 'folder', pattern: 'src/renderer/den-session' },
      { type: 'den', mode: 'folder', pattern: 'src/renderer/components/den' },
      { type: 'ui', mode: 'folder', pattern: 'src/renderer/components/ui' },
      { type: 'shared', mode: 'folder', pattern: 'src/renderer/{components,lib,hooks}' },
    ],
  },
  rules: {
    'boundaries/dependencies': [
      'error',
      {
        default: 'disallow',
        rules: [
          // Root providers — the ONLY app-side path to ui/ (the plumbing exception, ADR 0036).
          {
            from: { type: 'providers' },
            allow: { to: { type: ['providers', 'ui', 'den', 'den-session', 'shared'] } },
          },
          // Composition root — the one layer that may fan into features. NOT ui/ directly
          // (only providers/ and den/ may touch ui/, ADR 0036).
          {
            from: { type: 'app' },
            allow: {
              to: { type: ['app', 'providers', 'feature', 'den-session', 'den', 'shared'] },
            },
          },
          // A feature may use the shared leaves + the den surface + the session store — but
          // NOT app, NOT ui/ directly, and NOT another feature. There is deliberately no
          // `feature` in this list: cross-feature imports are disallowed by default, and
          // intra-feature imports are internal (same instance) and unchecked.
          {
            from: { type: 'feature' },
            allow: { to: { type: ['den-session', 'den', 'shared'] } },
          },
          // Shared state leaf — pure state; reaches only sideways/down (lib/hooks via shared).
          {
            from: { type: 'den-session' },
            allow: { to: { type: ['den-session', 'shared'] } },
          },
          // Branded surface — composes over ui/ primitives and shared utilities.
          { from: { type: 'den' }, allow: { to: { type: ['den', 'ui', 'shared'] } } },
          // Vanilla shadcn — a primitive may use another primitive + shared utilities.
          { from: { type: 'ui' }, allow: { to: { type: ['ui', 'shared'] } } },
          // Bottom leaf — utilities/hooks import only their own kind. Never up the graph.
          { from: { type: 'shared' }, allow: { to: { type: ['shared'] } } },
        ],
      },
    ],
  },
}

export default rendererBoundaries
