# Bundled tool binaries

Release packaging places pinned `chezmoi` and `git` binaries here under `<platform>/<arch>/`.

Expected runtime layout inside `process.resourcesPath`:

- `bin/<platform>/<arch>/chezmoi` (or `chezmoi.exe`)
- `bin/<platform>/<arch>/git` (or `git.exe`)

Development and integration tests can override discovery with `DOTDEN_CHEZMOI_BIN` and `DOTDEN_GIT_BIN`.
