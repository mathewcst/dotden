# 0023 — Main-process layering: an Electron-free `foundation`, with IPC/wiring as its own layer

**Status:** accepted · 2026-06-15

The Electron security split — `main` / `preload` / `renderer` — is already fixed by ADR 0004 (contextIsolation on, nodeIntegration off, a narrow contextBridge). This ADR governs the layering **inside `src/main/`**, which ADR 0004 does not address.

**`foundation/` is the Electron-free layer.** It holds the adapters and domain logic that wrap the bundled `chezmoi` and `git` binaries (`ChezmoiAdapter`, `GitTransport`, `RemoteClient`, the `process` runner, `tools` resolution). The load-bearing rule: **a module under `foundation/` must never `import 'electron'`** (directly or transitively). It depends only on `node:*` and its own siblings. That single constraint is what lets the whole faithful-wrapper seam run under Vitest in plain Node against real binaries and temp dirs — no `BrowserWindow`, no app bootstrap, no mocking the Electron runtime (see ADR 0019 and the `__tests__/` suites).

**IPC registration + service wiring becomes its own layer as it grows.** Today `src/main/index.ts` mixes three concerns: window/app lifecycle, the (inert) auto-updater, and `ipcMain.handle` bridge registration + lazy `RemoteClient` construction. The first IPC-shaped concern that arrives after `RemoteClient` should pull the bridge + service wiring out of `index.ts` into a dedicated `src/main/ipc/` (or `services/`) layer, leaving `index.ts` owning lifecycle and the window only. `index.ts` is allowed to import Electron and `foundation/`; the dependency direction is one-way (`index.ts` / `ipc` → `foundation`, never back).

## Alternatives considered

- **No layering rule — let `main/` organize itself.** Rejected: `index.ts` would keep accreting IPC handlers and service construction with no seam, and the temptation to reach for an Electron API from inside an adapter would quietly destroy the in-Node testability that ADR 0019 depends on.
- **Run the `improve-codebase-architecture` skill now and refactor against findings.** Deferred, not rejected: that skill finds _deepening opportunities in existing code_, and at ~1,700 LOC of mostly-clean greenfield there is almost nothing to deepen — it would churn. **Re-run it once the first real vertical slices land** (notably the SyncEngine / orchestration seam named in ADR 0008), where the layering will actually be exercised.

## Consequences

- The `foundation/`-never-imports-`electron` rule is a convention today (see `../conventions.md`); it is cheap to make mechanical later via `no-restricted-imports` in `@dotden/eslint-config` scoped to `foundation/**`, and that is the recommended follow-up the day a contributor first reaches for `electron` inside an adapter.
- New main-process code chooses its layer by its dependencies: needs a binary or domain logic and no Electron → `foundation/`; needs `ipcMain`/`app`/`BrowserWindow` → `ipc/` or `index.ts`.
- This keeps the ADR 0008 invariant-ownership story coherent: the orchestration seam where the four safety invariants compose will sit in the Electron-free layer (or just above it), testable without the Electron runtime.
