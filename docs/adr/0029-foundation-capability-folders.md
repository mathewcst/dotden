# 0029 — `foundation/` organizes by domain capability, mirroring the renderer

**Status:** accepted · 2026-06-20

ADR 0023 fixed the main-process _boundary_: `foundation/` is the Electron-free layer wrapping the bundled `chezmoi`/`git` binaries, and `index.ts`/`ipc/` is the Electron-aware layer above it. It did not give `foundation/` an _internal_ structure. By v1 the layer had grown to ~37 modules sitting flat in one directory — while the renderer right across the IPC seam had just been organized into domain-capability feature folders (ADR 0027). The asymmetry was the smell: two halves of the same app, one navigable by capability and one a flat bucket.

This ADR extends ADR 0023 (the boundary is unchanged) by giving `foundation/` the **same organizing axis as the renderer**: subfolders named in `../CONTEXT.md` glossary words, so a reader meets `secrets/`, `sync/`, `apply/`, `settings/`, etc. on _both_ sides of the IPC boundary.

## Decision

```
src/main/foundation/
  den-service.ts          # service seam — the facade IpcBridge calls
  den-store.ts            # .dotden/ data-model seam (ADR 0024)
  __tests__/              # den-service/den-store suites + shared fixtures
  platform/      process · path-safety · os-scope · tools · operation-tracer
  chezmoi/       chezmoi-adapter · chezmoi-status · git-transport
  environments/  environment-identity · environment-registry · discovery-scanner
                 · applicability-resolver · launch-state
  sync/          sync-engine · remote-client · push-queue · offline
  apply/         apply-planner · conflict-model · automation-policy · automation-settings
  commit/        commit-message-renderer
  file-history/  file-history
  secrets/       secret-allowlist · secret-reference · secret-scanner · pm-detect · pm-preference
  settings/      privacy-settings · subscription-settings · subscription-ignore
                 · sync-settings · appearance-override
  system/        tray-poller · update-check
```

- **Folders are glossary capabilities, not layers or file-types.** `commit/`, `apply/`, `sync/`, `secrets/`, `settings/`, `file-history/`, `environments/` name-match renderer features 1:1 (ADR 0027); a reviewer reads the same word on both sides of the seam.
- **Two seams live at the root, deliberately in no capability.** `den-service` (the facade the `IpcBridge` calls, aggregating ~25 modules) and `den-store` (the `.dotden/` synced-metadata data model, ADR 0024) are cross-cutting spine, not one capability — the main-process analog of the renderer's root `App.tsx`. Their suites and the shared `temp-git-repo.fixture` stay in the root `__tests__/`.
- **`platform/` is the one non-capability folder** — the cross-cutting infra primitives (`process`, `path-safety`, `os-scope`, `tools`, the observability `operation-tracer`) that everything builds on but that name no Den concept. `chezmoi/` sits just above it: the binary adapters.
- **Tests follow their code** (ADR 0019): every subfolder carries its own `__tests__/`. The `ipc-bridge` suite moved out of `foundation/` to `ipc/__tests__/`, beside its subject.
- **Dependency direction is preserved and now legible:** `index.ts`/`ipc` → root seams → capability folders → `chezmoi/` → `platform/`. No capability folder imports _up_; the only cross-capability edges point into the two root seams or down into `secrets/`/`platform/`.

## Alternatives considered

- **By layer (`core/` → `services/` → seam).** Honest to the dependency DAG, but diverges from the renderer's vocabulary — the whole point was symmetry across the IPC seam. Rejected.
- **Leave it flat / light-touch (`platform/` only).** Smallest diff, but leaves the asymmetry that motivated this. Rejected once we committed to mirroring ADR 0027.
- **Force `den-store` into `settings/`.** It is imported by 7 modules across 4 capabilities and imports _down_ into `secrets/`; filing it under one capability would invert the layering. Kept at root as a seam instead.

## Consequences

- The move was pure relocation + relative-import repair — no behavior change; `tsc`, the full Vitest suite (527 passing), and ESLint stayed green at every step (one commit per folder).
- New `foundation/` code chooses its folder by glossary capability; genuinely cross-cutting infra goes in `platform/`, a new seam goes at the root. When unsure, match the renderer feature of the same name.
- The ADR 0023 boundary rule is unchanged and still applies per-file: nothing under `foundation/` (any subfolder) may `import 'electron'`.
- Subfolders make the `no-restricted-imports` follow-up from ADR 0023 _easier_ to scope later (e.g. `platform/**` may not import `chezmoi/**`).
