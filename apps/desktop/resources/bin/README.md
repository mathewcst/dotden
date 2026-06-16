# Bundled tool binaries

dotden ships its own pinned `chezmoi` (the dotfile engine it wraps) and `git` (the Sync
transport) so a user never installs or updates either tool themselves. These binaries are
**fetched per build, not committed** — only [`tools.lock.json`](./tools.lock.json) (the
pinned source of truth) and this README live in git.

## How it works (issue 3-19)

1. [`tools.lock.json`](./tools.lock.json) pins the exact chezmoi + git versions, their
   per-platform/arch release assets, download URLs, and sha256 checksums. Bump a release
   here and nowhere else — that is what makes two environments on the same dotden version
   behave identically.
2. [`scripts/fetch-binaries.mjs`](../../scripts/fetch-binaries.mjs) downloads each asset,
   **verifies its sha256** against the lock (fail loud on mismatch), and lays it into the
   layout below.
3. [`scripts/before-pack.mjs`](../../scripts/before-pack.mjs) is electron-builder's
   `beforePack` hook: it fetches the binaries for the target being packaged so every
   `pnpm package` ships a populated `bin/`.

```bash
pnpm --filter @dotden/desktop fetch:binaries          # host platform/arch
node apps/desktop/scripts/fetch-binaries.mjs --all     # every pinned target (CI matrix)
```

## Runtime layout (inside `process.resourcesPath`)

[`src/main/foundation/tools.ts`](../../src/main/foundation/tools.ts) resolves:

- **chezmoi** — a single static binary: `bin/<platform>/<arch>/chezmoi` (or `chezmoi.exe`).
- **git** — the full relocatable [`desktop/dugite-native`](https://github.com/desktop/dugite-native)
  tree (a bare git launcher can't find its `libexec`/templates), extracted to
  `bin/<platform>/<arch>/git-dist/`; its launcher is `git-dist/bin/git`
  (POSIX) or `git-dist/cmd/git.exe` (Windows).

`<platform>`/`<arch>` are Node's `process.platform` / `process.arch` values.

Development and integration tests can override discovery with `DOTDEN_CHEZMOI_BIN` and
`DOTDEN_GIT_BIN` (e.g. point at host installs) — see `tools.ts`.
