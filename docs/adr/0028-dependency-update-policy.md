# Dependency updates: cooldown-gated, majors verified by peer-graph

`ncu --workspace --root` surfaces every available bump, but "update all" is unsafe here: some majors break this stack's _peer graph_ even though they install cleanly. Routine bumps are already protected by pnpm 11's `minimumReleaseAge` cooldown (ADR 0015) — `ncu` honours it and tags too-fresh versions `[cooldown]`, so freshness is handled automatically. **Cooldown does not catch peer-incompatible majors; those need a human call before the version moves.** The rule: take patch/minor freely; for any major, verify the real blocker is its peer/runtime-dependency graph (not just the version number) before bumping, and bump coupled families together.

## What moves, what is held

**Taken (patch/minor, peers verified):** the ESLint 9→10 family (`eslint` + `@eslint/js` + `globals` as one coupled bump — every plugin already declares `^10` peer support and typescript-eslint ≥8.61 covers ESLint 10); React 19.2 patches; `electron`/`electron-builder`/`electron-updater`, `lucide-react`, `vitest`, `zustand`, Tailwind 4.3.1 on desktop; `astro`/`@astrojs/check` on the marketing site; `prettier`, `typescript-eslint`, `eslint-plugin-astro`; pnpm 11.6→11.7.

**Held on purpose (a major that breaks the peer graph):**

- **Babel 7, not 8** (`@babel/core`, `@babel/plugin-transform-runtime`, `@babel/runtime`). Babel exists in this repo _only_ to run the React Compiler pass (ADR 0011). `babel-plugin-react-compiler@1.0.0` pins `@babel/types ^7.26.0` internally and ships no Babel 8 support, so Babel 8 would create a split `@babel/types` tree. `@rolldown/plugin-babel` already accepts Babel 8 — the compiler plugin is the sole blocker. Revisit when React Compiler declares Babel 8 support. (Babel 8 also raises the Node floor to `^22.18 || >=24.11`.)
- **Vite 7 on the marketing site** (`apps/web`, `astro` catalog). Astro 6.4 depends on `vite ^7` _directly_ and warns/breaks under Vite 8; the desktop app intentionally runs Vite 8 (ADR 0011). The two apps diverging on Vite major is expected, not drift — `vite` and the matching `@tailwindcss/vite`/`tailwindcss` stay pinned in the `astro` catalog. Bump when a future Astro major adds Vite 8 support.
- **`@types/node` on v24**, tracking the Node 24 runtime (`engines.node >=24`). Floating the ambient types ahead of the runtime major invites phantom-API typings.

The held entries carry the same rationale inline in `pnpm-workspace.yaml` so a later `ncu` run doesn't re-tempt the bump.

## Consequences

- ESLint 10 installs clean but has _behavioral_ shifts (config resolved per linted-file directory; JSX identifiers now count as references, which can move `no-unused-vars` results). One real finding surfaced — a dead `let available = false` initializer in `pm-detect.ts` flagged by `no-useless-assignment` — fixed in the same change. It is committed on its own so a full `pnpm check:lint` diff is reviewable in isolation.
- `prettier-plugin-tailwindcss` 0.6→0.8 is pre-1.0, where a minor _can_ change class-sort output — but this bump reordered no classes in our sources, so it carries no formatting churn. (The repo has some unrelated pre-existing prettier drift; left untouched here.)
- `apps/desktop` referenced `electron-updater` as a literal `^6.6.2` that bypassed the catalog; folded back to `catalog:desktop` so the version has a single source of truth. electron-builder, however, reads `electron-updater`'s version _straight from `package.json`_ and validates it as semver — it can't dereference pnpm's `catalog:` protocol, so `pnpm package` aborts on the unparseable `catalog:desktop` string before `beforePack` even runs. The catalog stays the single source of truth; `electron-builder.yml` `extraMetadata.dependencies.electron-updater` mirrors the concrete version (deep-merged over `package.json` before electron-builder's dependency checks), so the two must move together when the catalog version bumps.
- These holds are not permanent — each names the upstream release that unblocks it. Re-evaluate when React Compiler ships Babel 8 support and when Astro's next major adopts Vite 8.
