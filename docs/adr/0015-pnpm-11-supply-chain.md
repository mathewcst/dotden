# pnpm 11 with supply-chain hardening

The monorepo uses **pnpm 11** (`packageManager: "pnpm@11.6.0"`), which requires **Node 22+** — pnpm 11 is pure-ESM and dropped Node ≤ 21. Combined with Vite 8's floor, `engines.node` is `>=22.12`. In pnpm 11 **all pnpm settings live in `pnpm-workspace.yaml`** (camelCase); `.npmrc` is auth/registry-only (the repo has none) and the `package.json#pnpm` field is no longer read.

We keep pnpm 11's default supply-chain hardening rather than relaxing it:

- **`minimumReleaseAge: 4320`** — refuse dependency versions younger than **3 days** (the value is **integer minutes**; there is no `"3d"` form, and the v11 default is `1440` = 1 day). Setting it explicitly makes it **strict** (too-fresh versions hard-fail resolution, not warn-and-fallback), so deliberately bleeding-edge pins are exempted in **`minimumReleaseAgeExclude`**: `@dotden/*`, `babel-plugin-react-compiler`, `electron-vite`, `electron`, `electron-builder`, `electron-updater`.
- **Default-deny build scripts.** pnpm 11 removed `onlyBuiltDependencies` (and `ignoredBuiltDependencies` / `neverBuiltDependencies` / `onlyBuiltDependenciesFile` / `ignoreDepScripts`) and consolidated them into a single **`allowBuilds`** map (`name → boolean`). Because **`strictDepBuilds` defaults to `true`**, an unapproved dependency with an install/build script makes `pnpm install` **exit non-zero** (`ERR_PNPM_IGNORED_BUILDS`) — including under `--frozen-lockfile`. The allowlist is populated for the stack's real native builders (`esbuild`, `@tailwindcss/oxide`, `@swc/core`, `electron`, `electron-winstaller`) via `pnpm approve-builds`, then committed.
- **`nodeLinker: hoisted`** — required so `electron-builder` can resolve the desktop app's production deps (ADR 0010). It weakens pnpm's phantom-dependency strictness; an accepted electron-builder constraint (electron-builder#7554).

## Consequences

- The existing pnpm-9 `pnpm-lock.yaml` is regenerated **once** via a non-frozen `pnpm install`, then committed before CI uses `--frozen-lockfile`. (turbo 2.9.18 already parses the pnpm-11 lockfile correctly.)
- CI must ship `allowBuilds` in the repo (the interactive `pnpm approve-builds` prompt won't fire non-interactively) and keep fresh pins in `minimumReleaseAgeExclude`, or installs hard-fail.
