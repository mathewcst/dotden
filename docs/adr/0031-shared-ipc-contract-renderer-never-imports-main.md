# 0031 — `src/shared` is the IPC contract; the renderer never imports `main/**`

**Status:** accepted · 2026-06-20

ADR 0004 made `main` / `preload` / `renderer` a **runtime** security boundary. ADR 0023 (main layering) and ADR 0027 (renderer feature folders) organized each side. But the _type_ boundary lagged the runtime one: the wire types that cross IPC — the `DotdenApi` interface in `ipc-api.ts` and every DTO it references (`PreflightResult`, `Scope`, `Workspace`, the `den.ts` result types, …) — were **declared inside `foundation/**`**, and the renderer imported them by reaching across the seam into `main/foundation/…`. By v1 ~45 renderer/preload imports pointed at main-process source.

Two costs followed. (1) The renderer's typecheck transitively pulled pure-node `foundation` source, forcing a `"types": ["vite/client", "node"]` hack in `tsconfig.web.json` just to make those files resolve. (2) Any `foundation/` reorg (ADR 0029) rippled across the renderer, because the renderer depended on foundation _file paths_, not on a stable contract. The runtime boundary was real; the type boundary was a leak.

## Decision

**`src/shared` is the IPC contract** — the single place every type that crosses the IPC seam lives. Both processes import _down_ into it; neither the renderer nor `preload` imports `main/**`, and `src/shared` itself imports neither `main/**` nor `node:`/`electron` (it is pure, node-free, Electron-free).

- **Contract files are capability-grouped**, the same glossary axis as the renderer (ADR 0027) and `foundation/` (ADR 0029): `scope`, `apply`, `history`, `settings`, `remote`, `secrets`, `environments`, `workspace`, `den`, plus the pre-existing `ipc-api`, `commit-template`, `appearance-settings`, `app-info`. The same capability word now spans **three** places — a renderer feature, a foundation folder, and a contract file.
- **Types are _moved_, not re-exported.** A wire type's declaration lives in `src/shared`; `foundation/` imports it back when it needs it. No barrel re-exports from `foundation` (that would leave the renderer transitively depending on main). E.g. the `Os`/`Scope` _types_ moved to `shared/scope.ts`; their _operations_ (`intersectScope`, `scopedOutPaths`, …) stay in `foundation/platform/os-scope.ts` — **contract is the data shape, behavior stays main-side.**
- **`main`-only types stay in `main`.** `DenServiceOptions`/`PollSnapshot` reference main collaborators (`OperationTracer`) and never cross IPC, so they live beside their service (`foundation/den-service/types.ts`), not in the contract.
- **`@shared/*` addresses the contract from both processes** (aliased in `electron.vite.config.ts`, `tsconfig.web.json`, `tsconfig.node.json`) — no deep `../../../shared` chains.

## Alternatives considered

- **Re-export barrels from `src/shared`.** Smallest diff, but indirection — not a real move: the renderer would still transitively depend on `main/**` through the barrel, and the node-types hack would remain. Rejected; we moved declarations.
- **Leave wire types in `foundation/` and relax the boundary.** The whole point is a _type_ boundary that matches the runtime one (ADR 0004). Rejected.

## Consequences

- **Renderer↔main type coupling is gone:** 0 renderer/preload imports from `main/**`, 0 `src/shared` imports from `main/**`, 0 `src/shared` imports of `node:`/`electron`. Verifiable by grep, intended as the standing invariant.
- **The `tsconfig.web.json` `node` types hack is dropped** — the contract is node-free, so the renderer typecheck no longer needs `@types/node`. `"types": ["vite/client"]` only.
- **A `foundation/` reorg no longer ripples into the renderer** — the renderer depends on the contract, not on foundation file paths. (ADR 0029 moves now touch ~1 renderer file, not ~40.)
- **New wire type → add it to the capability file in `src/shared`**, never to `foundation/`. If `foundation` needs it, import it back.
- **Caveat — node-env vitest has no `@shared` alias** (no vitest config, by design; mirrors the `@/` rule in ADR 0027). So a **value** import reachable from a node-env test stays **relative**; **type-only** imports (erased at compile) and renderer **component** value-imports may use `@shared`.
