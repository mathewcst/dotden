# Contributing to dotden

Thanks for your interest in contributing. dotden is in early development, so things move and break — issues, ideas, and pull requests are all welcome.

By participating you agree to abide by our [Code of Conduct](CODE_OF_CONDUCT.md).

## Getting started

Requires Node `>=24` and pnpm `>=11`. Install pnpm `11.6.0` standalone; do not rely on Corepack.

```sh
pnpm install
pnpm dev      # run all apps
pnpm check    # typecheck + lint — run before every PR
```

The desktop app shells out to a **bundled** `chezmoi` + `git` (never your host install). They're fetched per build, not committed, so set them up once before `pnpm dev` reaches the desktop app:

```sh
pnpm --filter @dotden/desktop fetch:binaries          # download pinned chezmoi + git into resources/bin/
cp apps/desktop/.env.example apps/desktop/.env.local  # then point DOTDEN_*_BIN at the fetched binaries
```

Skipping this surfaces `Bundled chezmoi/git tools were not found`. See [`apps/desktop/resources/bin/README.md`](apps/desktop/resources/bin/README.md) for the layout and troubleshooting (including a Git-Bash/GNU-tar gotcha on Windows).

## Workflow

1. Open or comment on an issue before large changes, so effort isn't duplicated.
2. Branch off the default branch.
3. Keep commits focused. Be concise in messages.
4. Run `pnpm check` and `pnpm format` before pushing.
5. Open a PR describing what changed and why.

## Conventions

- The domain glossary lives in [`CONTEXT.md`](CONTEXT.md); brand and UI language in [`docs/brand-and-vocabulary.md`](docs/brand-and-vocabulary.md). Match the established vocabulary (**Den**, **environment**, **Workspace**, **Remote**, …).
- Architectural decisions are recorded as ADRs under `docs/adr/`. Add one for any significant decision.
- **Document code as you write it — we over-comment rather than under** ([ADR 0021](docs/adr/0021-code-documents-itself-over-comment.md)). This is a public repo: every exported symbol gets a TSDoc/JSDoc block (contract + `@throws`, not the obvious type), non-obvious _why_ gets an inline comment, and any chezmoi/git wrapper names the CLI command it maps to. A redundant comment is cheap; a missing one isn't. `apps/desktop/src/main/` is the reference — don't restate the obvious or add `@author`/`@version` noise.
- Shared config lives in `packages/*` — extend `@dotden/eslint-config`, `@dotden/typescript-config`, and `@dotden/prettier-config` rather than redefining rules per package.

## Adding a package

```
packages/<name>/
  package.json     # "name": "@dotden/<name>", private, "type": "module", exports
  tsconfig.json    # extends @dotden/typescript-config/base.json
  eslint.config.js # re-exports @dotden/eslint-config/base
```

Add `check:types` / `check:lint` scripts, set `"prettier": "@dotden/prettier-config"`, then run `pnpm install`.

## Adding an app

Create `apps/<name>`, scaffold the framework, extend the matching `@dotden/*` configs, and add `dev` / `build` / `check:types` / `check:lint` scripts plus the correct `build` outputs. Declare the app's env vars in `turbo.json` and run `pnpm install`.

Keep environment files inside the app that consumes them and commit an app-local `.env.example`. There is no root `.env`.

> Any dependency with a native/install build script must be added to `allowBuilds` via `pnpm approve-builds`, or `pnpm install` will fail (see ADR 0015).
