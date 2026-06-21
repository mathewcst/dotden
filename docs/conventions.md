# Conventions

Day-to-day development patterns for dotden. This is the practical "how we write
code here" companion to the decisions captured in `adr/`. `../CONTEXT.md` is the
domain glossary (what words mean); this file is craft (how we build). When a rule
here is also a hard, irreversible decision, it links to its ADR.

## Tests live in `__tests__/`

Test files and their fixtures live in a **`__tests__/` directory adjacent to the
code under test** — one per source directory, never co-located beside production
files and never in a single repo-wide tree.

```
src/main/foundation/
  chezmoi-adapter.ts
  remote-client.ts
  process.ts
  __tests__/
    faithful-wrapper.test.ts
    remote-client.test.ts
    temp-git-repo.fixture.ts      # fixtures are test-only → they live here too
```

- Imports step up one level: `./remote-client.js` → `../remote-client.js`. Imports
  _between_ test/fixture files in the same `__tests__/` stay `./`.
- Vitest's default globs pick up `**/__tests__/**` with no extra config.
- See **ADR 0019** (amended 2026-06-15) for the rationale and the runner choice.

## Components: one primary per file, split before it sprawls

This is a **guide, not a lint gate** — judgment over mechanical caps.

- **One _primary_ component per file.** A private sub-component may share the file
  **when it is only used by that file's main component** (e.g. `Select` +
  `SelectOption`). The moment a second component is reused elsewhere, it gets its
  own file.
- **~500 lines per component is the smell ceiling.** Past it, look to split — not
  for DRY's sake but for debuggability: a small component is easier to reason about
  and fix than one file hiding five concerns.
- No `react/no-multi-comp` rule is enforced; the legitimate co-located-sub-component
  case is common enough that a hard rule would cost more than it saves.

## Main-process layering

`main` / `preload` / `renderer` is a security boundary (ADR 0004). _Inside_ `main/`:

- **`foundation/` is Electron-free** — adapters/domain over the bundled chezmoi & git
  binaries. **Never `import 'electron'`** from `foundation/` (directly or
  transitively); this is what keeps the faithful-wrapper seam testable in plain Node.
- **IPC registration + service wiring** splits out of `index.ts` into `ipc/`
  (or `services/`) as it grows; `index.ts` keeps lifecycle + the window only.
- **Frameless window chrome** is renderer-owned for layout, main-owned for native
  effects. Titlebar controls call a narrow preload/IPC API (`window.minimize`,
  `window.toggleMaximize`, `window.close`); only `index.ts` resolves the sending
  `BrowserWindow`. Drag regions live in renderer CSS (`app-region: drag`), and
  every clickable titlebar element must opt out with `app-region: no-drag`.
- Dependency direction is one-way: `index.ts` / `ipc` → `foundation`, never back.
- See **ADR 0023**.

## Renderer layering: features by domain capability

The renderer organizes by **domain-capability feature**, not by file type. See
**ADR 0027** for the rationale (and the rejected `git/`/`file/` and module-global-store
alternatives).

```
src/renderer/
  App.tsx                 # thin root: <LaunchProvider> → LaunchRouter (which
                          # wraps <DenSessionProvider key={role}> on the 'app' route)
  features/
    launch/   shell/   workspace/   commit/   sync/   apply/
    secrets/  scope/   file-history/   onboarding/   returning/   settings/
    └─ each feature:
         components/  lib/               # (+ hooks/ as needed — none today)
                                         # per subdir gets its own __tests__/ (ADR 0019)
  shared/                 # dotden-specific components used by 2+ features
    components/  lib/      #   (ConfirmDialog, StatusTag, apply-theme, utils…)
  ui/                     # scaffolded shadcn primitives — flat, exempt
```

- **A feature = a user-facing capability in glossary words** (`../CONTEXT.md`). The
  change-lifecycle split follows ADR 0006's seam: `commit/` outbound, `sync/`
  transport, `apply/` inbound (Conflict folds in — it only exists during an Apply).
- **Never overload a glossary term with a code name.** The old `Workspace.tsx` was the
  _den window_, not a domain Workspace (ADR 0005) — that lie is how it became a
  1377-line god-component. The window is `shell/`; a domain Workspace is `workspace/`.
- **Placement rule.** A module imported by **one** feature lives in that feature's
  `components/`/`lib/`; imported by **2+**, it moves to `shared/`. shadcn primitives
  (`button`, `switch`…) stay in `ui/`.
- **Shared state uses scoped Zustand stores via Context** — the app-scoped `launch` store
  (`<LaunchProvider>`) owns boot + routing; the `den-session` store (composed from per-feature
  slices, created inside `<DenSessionProvider>`) owns the den window session. Both are
  **never module-level singletons** (`key={role}` still resets the A/B den-session thread).
  Ephemeral UI state (input text, open menus) stays in `useState`. See **ADR 0027**.
- **Code-split cold paths only; eager the hot path; warm the rest on idle.** We ship a desktop
  Electron app — the renderer bundle is read from **local disk**, not the network, so `React.lazy`
  buys far less than on the web: the only real win is keeping cold code out of the **boot-path
  parse**, and the cost (a `Suspense` fallback flash on first navigation) is pure downside. So:
  (1) **eager-import the hot path** — `DenWindow` is a plain import in `LaunchRouter`, because a
  set-up environment boots straight to the `app` route and a lazy split would flash the splash
  twice. (2) **`lazy` the cold paths** a set-up user may never open (the setup flows, Settings + its
  tabs, the full-window Apply views, file history). (3) **warm those chunks on idle after boot** via
  `launch/lib/preload-chunks.ts` (`preloadLaunchChunks`, fired from `<LaunchProvider>` once `boot()`
  resolves) — the module registry dedupes `import()` by resolved file, so warming there resolves the
  same chunk the `lazy()` site requests later, and `Suspense` unwraps in the same render with no
  visible fallback. Keep the fallbacks anyway (honest safety net; never a blank screen). When you
  add a new `lazy()` site, add its specifier to `COLD_CHUNKS`.
- **`@/` for renderer-internal imports** (`@/features/…`, `@/shared/…`, `@/ui/…`); reach for
  `@`, not deep `../../` chains. Two deliberate exceptions: (1) imports into `src/shared/**`
  and `src/main/**` use relative paths — the `@` alias only maps `src/renderer/*`, so there
  is no alias to use; (2) the **store slices** (`*/lib/*-slice.ts` + `shell/lib/den-session-store.ts`)
  import each other **relatively**, because the node-env slice tests value-import them and vitest
  runs with **no `@/` alias** (no vitest config, by design — it keeps the slices testable in plain
  Node). `@/` resolves under `tsc` but throws at test runtime, so the cluster stays relative.
- **The scoped store is structurally enforced, not lint-enforced.** A guardrail _is_ cheaply
  available — a one-line `no-restricted-syntax` rule
  (`VariableDeclarator[init.callee.name='createStore']`) catches a module-level `const xStore =
createStore()` while leaving the factory's `return createStore(…)` alone, and a desktop-scoped
  `files: ['src/renderer/**']` override keeps it out of the shared `@dotden/eslint-config`. We
  **deliberately skip it anyway**: the factory-in-Context pattern already makes the A/B leak
  impossible (remount = new store) and the `key={role}` contract is documented at
  `DenSessionProvider` + `LaunchRouter`, so the rule would only restate the pattern. "Guide not
  gate" (ADR 0021). See **ADR 0027** for the recorded decision.

## Comments: over-comment, but only what earns its line

dotden is public OSS read by newcomers and AI agents — bias toward **more**
explanation. Full policy in **ADR 0021**; in practice:

- TSDoc every **exported** symbol — document the _contract_ (`@throws`,
  what params/returns _mean_), never restate the TypeScript type.
- Explain the non-obvious _why_ inline; name the chezmoi/git CLI command any
  wrapper maps to (ADR 0003).
- Over- beats under-, but a comment that only echoes the code is noise — drop it.
- **Enforced at review, not by lint** (deliberate — see ADR 0021). "Add the docs"
  is a valid review block. There is no `jsdoc` rule and we don't want one.

## Respect eslint & prettier

- **Run lint clean.** `pnpm check:lint` (and `pnpm check` for types too) before
  pushing. The shared config is `@dotden/eslint-config`.
- **`eslint-disable` is a last resort, and never bare.** Every disable must carry an
  inline reason after `--`:

  ```ts
  /* eslint-disable turbo/no-undeclared-env-vars -- integration fixture discovers local test binaries. */
  ```

  Stale disables are a hard **error** — `reportUnusedDisableDirectives` is on in the
  shared base config, so a disable that no longer suppresses anything fails lint.
  The _reason_ requirement itself is a review convention (no extra plugin).

- **Prettier is applied, not gated.** Formatting is auto-applied on edit via a Claude
  Code hook, and `pnpm format` reformats the repo on demand. There is no
  `format:check` CI step — we keep the tree formatted rather than verifying it.
