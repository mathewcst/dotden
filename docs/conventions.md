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
src/main/foundation/chezmoi/
  chezmoi-adapter.ts
  git-transport.ts
  __tests__/
    faithful-wrapper.test.ts      # one __tests__/ per source dir (ADR 0029)
src/main/foundation/den-service/  # the service seam is its own folder (ADR 0031)
  den-service.ts  types.ts        #   impl + its main-only internal types
  __tests__/                      #   den-service suites live with their subject
src/main/foundation/__tests__/    # root holds the den-store suite…
  temp-git-repo.fixture.ts        # …and shared fixtures (test-only → live here too)
```

- Imports step up one level: `./remote-client.js` → `../remote-client.js`. Imports
  _between_ test/fixture files in the same `__tests__/` stay `./`.
- Vitest's default globs pick up `**/__tests__/**`; `apps/desktop/vitest.config.ts`
  keeps the default environment as Node and only supplies renderer/shared aliases.
- Renderer component tests opt into a DOM per file with `// @vitest-environment happy-dom`.
  Use Testing Library plus `src/renderer/test/dotden-test-api.ts` to stub `window.dotden` at
  the IPC boundary. Any renderer component that owns a busy state around IPC must have a
  liveness regression proving reject/timeout exits busy with a usable recovery affordance.
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
- **`foundation/` organizes by domain capability**, mirroring the renderer (ADR 0027) — the
  same glossary words (`CONTEXT.md`) on both sides of the IPC seam. See **ADR 0029**.

  ```
  src/main/foundation/
    den-service/   den-service.ts · types.ts (+ __tests__)   # façade seam, its own folder (ADR 0031)
    den-store.ts                  # .dotden/ data-model seam (ADR 0024)
    platform/      process · path-safety · os-scope · tools · operation-tracer  (cross-cutting infra)
    chezmoi/       chezmoi-adapter · chezmoi-status · git-transport   (binary adapters)
    environments/  sync/  apply/  commit/  file-history/  secrets/  settings/  system/
  ```

  - **Capability folders are glossary words**, name-matching renderer features 1:1 where they exist
    (`secrets/`, `sync/`, `apply/`, `settings/`, `commit/`, `file-history/`, `environments/`).
  - **The two seams sit at the root level**, deliberately in no capability: `den-service/` (the façade
    `IpcBridge` calls — large enough to earn its own folder, holding its impl + main-only internal
    `types.ts`) and `den-store` (the `.dotden/` synced-metadata data model, ADR 0024) — the
    main-process analog of the renderer's root `App.tsx`.
  - **`platform/` is the one non-capability folder** — infra primitives everything builds on but that
    name no Den concept. New code picks its folder by capability; cross-cutting infra → `platform/`.

- **IPC registration + service wiring** splits out of `index.ts` into `ipc/`
  (or `services/`) as it grows; `index.ts` keeps lifecycle + the window only.
- **Frameless window chrome** is renderer-owned for layout, main-owned for native
  effects. Titlebar controls call a narrow preload/IPC API (`window.minimize`,
  `window.toggleMaximize`, `window.close`); only `index.ts` resolves the sending
  `BrowserWindow`. Drag regions live in renderer CSS (`app-region: drag`), and
  every clickable titlebar element must opt out with `app-region: no-drag`. All
  full-window renderer routes must include the shared `WindowTitleBar`/`TitleBar`
  path so boot, first-run, setup, settings, loading, and review surfaces all keep
  drag + native close/minimize/maximize parity.
- Dependency direction is one-way: `index.ts` / `ipc` → `foundation`, never back.
- See **ADR 0023**.

## The IPC contract: `src/shared`

`src/shared` is the **contract both processes speak** — every type that crosses the IPC seam
(the `DotdenApi` interface in `ipc-api.ts` and every DTO it references). It is the _type_
boundary that matches the _runtime_ boundary (ADR 0004). See **ADR 0031**.

- **The renderer never imports `main/**`.** Wire types are _declared_ in `src/shared`(capability-grouped:`scope`, `apply`, `remote`, `secrets`, `environments`, `workspace`,
`den`, …) and `foundation/` imports them _back_ when it needs them — types are **moved, not
  re-exported** (a barrel would leave the renderer transitively depending on main).
- **Contract = data shape; behavior stays main-side.** The `Os`/`Scope` _types_ live in
  `shared/scope.ts`; their _operations_ (`intersectScope`, …) stay in `foundation/platform/os-scope.ts`.
  A `main`-only type that never crosses IPC (e.g. `DenServiceOptions`) stays in `main` beside its owner.
- **`src/shared` is pure** — no `node:`, no `electron`, no `main/**` imports. That is what lets the
  renderer typecheck without `@types/node` (`tsconfig.web.json` carries only `vite/client`).
- **`@shared/*`** addresses the contract from both processes (no deep `../../../shared` chains).
  Type-only imports and renderer component value-imports may use `@shared`; plain Node store-slice
  tests should still prefer straightforward relative imports for their internal cluster.
- The standing invariant (grep-checkable): 0 renderer/preload imports from `main/**`, 0 `src/shared`
  imports from `main/**`, 0 `src/shared` imports of `node:`/`electron`.

## Renderer layering: three layers, one-way

The renderer is **three layers with a one-way dependency graph** — `app/` → `features/` →
shared leaves (`components/`, `lib/`, `hooks/`, `den-session/`). See **ADR 0033** for the
rationale (and the rejected "everything is a feature" / `components/shell` / two-layer
alternatives), **ADR 0034** for the `den-session` store, and **ADR 0035** for the lint gate
that enforces the graph. This supersedes ADR 0027's flat feature layout.

```
src/renderer/
  app/                      # composition root — MAY import features + den-session + shared
    App.tsx · main.tsx · providers/        (Tooltip, Launch, DenSession key={role})
    launch/  boot routing      shell/  DenWindow · panes · DialogLayer · TitleBar
    update/  root-mounted prompt
  features/                 # capabilities only — MAY import den-session + shared,
    onboarding  returning  workspace  commit  sync  apply         NEVER app or another feature
    secrets  settings  file-history  scope  diagnostics
    └─ each feature: components/  lib/  (+ hooks/ as needed) · per subdir its own __tests__/
  den-session/              # shared state leaf — store + slices + tree model (ADR 0034)
    store.ts · context.ts · slices/ · tree-node-model.ts · remote-axis.ts
  components/               # shared presentational — NEVER imports features/app
    ui/   vanilla shadcn (CLI-owned)       den/   dotden-branded surface (ADR 0036)
    tree/  the den file-tree view (single consumer; imports den-session *types* only)
  lib/   cn · apply-theme · ipc-timeout         hooks/   use-mobile · …
```

- **The feature bright-line (ADR 0033).** A folder earns `features/` only if it's a
  **user-facing capability a user would name**. App infrastructure — the shell frame, boot
  routing, the update prompt — is `app/`, not a feature. Diagnostics is a capability (the
  command-log viewer, ADR 0030), so it stays a feature.
- **The change-lifecycle split follows ADR 0006's seam:** `commit/` outbound, `sync/`
  transport, `apply/` inbound (Conflict folds in — it only exists during an Apply).
- **Never overload a glossary term with a code name.** The old `Workspace.tsx` was the _den
  window_, not a domain Workspace (ADR 0005) — that lie is how it became a 1377-line
  god-component. The window is `app/shell/`; a domain Workspace is `features/workspace/`.
- **Import direction is one-way and lint-gated (ADR 0035).** `app → features → {components,
lib, hooks, den-session}`. A feature never imports `app/` or another feature's internals;
  the shared leaves never import up. `eslint-plugin-boundaries` enforces it — the boundaries
  config is the canonical, machine-checked statement of this graph.
- **Placement rule.** A module used by **one** feature lives in that feature; used by **2+**,
  it moves to a shared leaf (`components/den/` for components, `lib/` for utilities, a slice in
  `den-session/` for shared state). A single-consumer component that still carries den
  vocabulary (the file Tree) stays in its feature, or in `components/` only when it imports
  shared _types_ — never feature code.
- **Components are two-tier (ADR 0036).** `components/ui/` is vanilla shadcn (CLI-owned, never
  branded); `components/den/` is the dotden-branded surface app/features import — thin wrappers
  that _compose over_ `ui/` (`den/button` imports `ui/button`) plus the bespoke design-system
  family (Badge, Pill, StatusTag, StatusDot, Banner). **Only `den/` may import `ui/`** (gated).
  Compose-over, never re-implement. Build `den/` lazily from the Figma `37:2` sheet.
- **Bespoke-native allowlist.** A few rows render native `<button>`/`<div>` for keyboard a11y
  and are _not_ shadcn-migration targets: TreeRow/FileRow (`components/tree/`), CommitRow
  (`commit/`), SidebarItem, ListRow/SelectRow, DiffLine/DiffLineSplit/MergeHunk
  (`file-history/`, `apply/`), WindowControls (`den/`). Each native element the
  `no-restricted-syntax` gate would flag carries `// eslint-disable-next-line -- bespoke:
<reason>` (ADR 0035); a stale one fails lint, so the list can't silently grow.
- **Shared state is the scoped `den-session` store (ADR 0027 + 0034).** One Zustand store
  composed from slices in `den-session/slices/`, created by a factory and handed down through
  `<DenSessionProvider key={role}>` (mounted in `app/`) — **never a module-level singleton**
  (`key={role}` resets the A/B den-session thread structurally; remount = new store). Features
  read via `useDenSession(selector)` from `@/den-session`. The app-scoped `launch` store
  (`<LaunchProvider>`) owns boot + routing. Ephemeral UI state stays in `useState`. The
  store-singleton rule stays **structurally** enforced, not linted (ADR 0027) — ADR 0035 gates
  layering + native-HTML, not the store pattern.
- **Effects follow modern-React patterns.** Prefer `useSyncExternalStore` for browser/external
  subscriptions and derived state over `setState`-in-`useEffect` (the `react-hooks` flat config
  is on). The `react-patterns` and Vercel composition / best-practice skills are the reference.
- **Code-split cold paths only; eager the hot path; warm the rest on idle.** The renderer bundle
  is read from **local disk**, not the network, so `React.lazy` buys far less than on the web —
  the only win is keeping cold code out of the **boot-path parse**, and a `Suspense` flash on
  first navigation is pure downside. So: (1) **eager-import the hot path** — `DenWindow` is a
  plain import in `app/launch` routing, because a set-up environment boots straight to the
  `app` route and a lazy split would flash the splash twice. (2) **`lazy` the cold paths** a
  set-up user may never open (setup flows, Settings + tabs, full-window Apply views, file
  history). (3) **warm those chunks on idle after boot** via `app/launch/lib/preload-chunks.ts`
  (`preloadLaunchChunks`, fired from `<LaunchProvider>` once `boot()` resolves) — the module
  registry dedupes `import()` by resolved file, so warming resolves the same chunk the `lazy()`
  site requests later, with no visible fallback. Keep the fallbacks anyway. New `lazy()` site →
  add its specifier to `COLD_CHUNKS`.
- **Aliases.** `@/` maps `src/renderer/*` (`@/app/…`, `@/features/…`, `@/components/den/…`,
  `@/den-session`, `@/lib/…`); reach for `@`, not deep `../../` chains. The **IPC contract** is
  reached via **`@shared/*`** (ADR 0031), _not_ `@/` — `@` only maps `src/renderer/*`, and the
  renderer never imports `src/main/**`. The old `@/shared/*` (renderer junk drawer) and
  `@/ui/*` (hand-authored primitives) are **retired** — both are gone (ADR 0033/0036).

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
- **Structural gates are hard (ADR 0035), craft stays a guide.** The renderer override gates
  the **layer graph** (`eslint-plugin-boundaries`) and **native-HTML-where-shadcn-exists**
  (`no-restricted-syntax`) — see _Renderer layering_ above. Comments / component size stay
  review guides; the split is structure-vs-style, not gate-vs-guide globally.
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
