# Monorepo build system: Turborepo + pnpm

dotden is a single **pnpm + Turborepo** monorepo. Packages are scoped `@dotden/*` — the repo, the root package, and every package scope use **dotden**; `menv` is only a local clone-directory name, never a canonical identifier. Workspaces are `apps/*` (deployables: `apps/desktop` = the Electron app, `apps/web` = the Astro marketing site; future `apps/relay`) and `packages/*` (shared **tooling** only: `@dotden/eslint-config`, `@dotden/typescript-config`, `@dotden/prettier-config` — there is no shared UI package; see ADR 0012).

Tasks live in each package's `package.json`; `turbo run` orchestrates them and root scripts only delegate. The check graph follows the project convention: **`pnpm check` = `turbo run check:types check:lint`** (the two run in parallel); `check:types` = `tsc --noEmit`, `check:lint` = `eslint`. The only cross-package dependencies are the shared config packages (each `tsconfig` extends `@dotden/typescript-config`; each flat ESLint config imports `@dotden/eslint-config`), so **both** `check:types` and `check:lint` depend on a transit/`topo` node (`"topo": { "dependsOn": ["^topo"] }`, matching no real script): they parallelize across packages while still invalidating the cache when a shared config changes. There is **no root `.env`** — per-app `.env` + committed `.env.example`, with variables declared in each task's `env`.

## Consequences

- Adding an app/package is a **documented manual checklist** in the README (we chose not to ship `turbo gen` generators).
- `nodeLinker: hoisted` (in `pnpm-workspace.yaml`) so `electron-builder` can resolve the desktop app's production deps on disk (see ADR 0010 / 0015).
- Package manager is **pnpm 11** (Node 22+ only), configured entirely in `pnpm-workspace.yaml`; supply-chain hardening = `minimumReleaseAge` (3 days, strict) + default-deny build scripts via the `allowBuilds` map. See ADR 0015.
