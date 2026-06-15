# Vitest is the test runner for dotden integration and unit suites

**Status:** accepted · 2026-06-15

Use **Vitest** for dotden's TypeScript tests, starting with the faithful-wrapper seam around `ChezmoiAdapter` and `GitTransport`.

Vitest is the natural fit for this repo's Vite/electron-vite stack: it understands TS/ESM the same way the app does, runs fast in Node for pure domain and main-process adapter tests, and lets later renderer tests reuse the Vite plugin graph without adding a separate Jest/Babel universe.

The first suite intentionally exercises **real processes** for chezmoi and git through public adapter APIs. Tests may discover local binaries via `PATH` or `DOTDEN_CHEZMOI_BIN` / `DOTDEN_GIT_BIN`, while production resolution remains pointed at app-bundled resource paths.

## Consequences

- Adapter tests are integration-style: temp destination directory + temp source git repo + real chezmoi/git commands, not mocks.
- The reusable temp-git-repo fixture lives beside the main-process foundation code until a dedicated test package exists.
- New test scripts should run through `vitest run`; UI/browser tests can be added later without changing the runner decision.
