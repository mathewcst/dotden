# Vitest is the test runner for dotden integration and unit suites

**Status:** accepted · 2026-06-15

Use **Vitest** for dotden's TypeScript tests, starting with the faithful-wrapper seam around `ChezmoiAdapter` and `GitTransport`.

Vitest is the natural fit for this repo's Vite/electron-vite stack: it understands TS/ESM the same way the app does, runs fast in Node for pure domain and main-process adapter tests, and lets later renderer tests reuse the Vite plugin graph without adding a separate Jest/Babel universe.

The first suite intentionally exercises **real processes** for chezmoi and git through public adapter APIs. Tests may discover local binaries via `PATH` or `DOTDEN_CHEZMOI_BIN` / `DOTDEN_GIT_BIN`, while production resolution remains pointed at app-bundled resource paths.

## Consequences

- Adapter tests are integration-style: temp destination directory + temp source git repo + real chezmoi/git commands, not mocks.
- New test scripts should run through `vitest run`; UI/browser tests can be added later without changing the runner decision.

## Amendment — 2026-06-15: test files and fixtures live in a per-directory `__tests__/`

Originally this ADR placed the reusable temp-git-repo fixture _beside_ the main-process foundation code, and the first suite co-located `*.test.ts` next to the modules under test. That co-location is **superseded**: test files **and** their fixtures now live in a `__tests__/` directory **adjacent to the code they test** — one `__tests__/` per source directory (e.g. `src/main/foundation/__tests__/remote-client.test.ts`, `…/__tests__/temp-git-repo.fixture.ts`), not a single repo-wide tree.

Rationale: production source directories stay free of test-only files (clearer at a glance what ships), while tests stay close enough to their subjects that imports only step up one level (`./remote-client.js` → `../remote-client.js`). Fixtures are test-only, so they belong with the tests, not beside the shipping code. Vitest's default globs pick up `**/__tests__/**` with no config change. See `../conventions.md` for the day-to-day rule.
