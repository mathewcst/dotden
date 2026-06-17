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

## Troubleshooting (local dev)

**`Bundled chezmoi/git tools were not found. Set DOTDEN_CHEZMOI_BIN/DOTDEN_GIT_BIN …`**
The resolver found neither a bundled binary nor an env override. Two things must hold for
`pnpm --filter @dotden/desktop dev`:

1. **The binaries are fetched** — run `pnpm --filter @dotden/desktop fetch:binaries` to
   populate `resources/bin/<platform>/<arch>/`.
2. **`apps/desktop/.env.local` points at them.** Unpackaged Electron sets
   `process.resourcesPath` to Electron's _own_ folder, not this repo, so the runtime can't
   discover the repo's `resources/bin/` on its own — the `DOTDEN_*_BIN` override is the only
   way dev finds the bundled tools. (Packaged builds need neither step.) Copy
   [`../../.env.example`](../../.env.example) to `.env.local` and point each var at a fetched
   binary, e.g. on Windows:

   ```
   DOTDEN_CHEZMOI_BIN="…/apps/desktop/resources/bin/win32/x64/chezmoi.exe"
   DOTDEN_GIT_BIN="…/apps/desktop/resources/bin/win32/x64/git-dist/cmd/git.exe"
   ```

**`fetch:binaries` fails extracting git on Windows** — `tar: …: Cannot open: No such file or
directory`, the reported path visibly mangled. The `tar` on PATH under Git Bash is GNU tar
(an MSYS2/Cygwin build), which reads a `C:` drive prefix as a remote `host:path` _and_ treats
`\` as a C escape introducer, so a native Windows `-C C:\…` arrives corrupted. The
`tarExtract` helper in [`../../scripts/fetch-binaries.mjs`](../../scripts/fetch-binaries.mjs)
neutralizes both — `--force-local` for the colon, and normalizing path args `\`→`/` for the
backslashes. That helper is where the workaround lives if it ever regresses.
