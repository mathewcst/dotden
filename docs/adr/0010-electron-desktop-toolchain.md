# Electron desktop toolchain: electron-vite 6 (beta) + Vite 8, packaged by electron-builder

The desktop renderer is bundled by **electron-vite** (one config for main/preload/renderer, HMR, secure defaults — `contextIsolation` on, `nodeIntegration` off, preload via `contextBridge`), and the app is packaged and auto-updated by **electron-builder** + **electron-updater** using the **GitHub provider** (reads `latest*.yml` from GitHub Releases; no backend).

We deliberately adopt **electron-vite `6.0.0-beta` + Vite 8** (Rolldown) rather than the GA **electron-vite 5 + Vite 7**. Rationale: we are scaffolding with no app code yet, so we take the future-proof toolchain now (Vite 8 + `@vitejs/plugin-react@6`) and avoid a later Vite 7→8 migration plus a React-Compiler re-wiring. **Accepted risk:** the main/preload bundler rides a breaking-major beta (only `beta.0`/`beta.1` exist) and `@rolldown/plugin-babel` is still `0.x`. This is contained because nothing ships yet.

## Considered options

- **Electron Forge (Vite template)** — rejected: Vite support is officially _experimental_ through 7.11.2, and Forge's Squirrel-based updater is macOS/Windows only, forfeiting **Linux AppImage** auto-update.
- **update.electronjs.org / Velopack** — rejected as primary: electronjs.org has no Linux AppImage auto-update; Velopack forces its own packaging CLI. `electron-builder` + `electron-updater` is the only mature option auto-updating all three OS targets (incl. AppImage delta via blockmap) with no backend.
- **electron-vite 5 + Vite 7 (GA)** — the fallback if the beta proves unstable; pairs with the classic React-Compiler Babel path (ADR 0011).

## Consequences

- Packaging config (`electron-builder.yml`: dmg / NSIS / AppImage + GitHub publish) is present but not yet active; code signing + notarization (Apple Developer ID, optional Windows cert) are deferred to the first release. macOS auto-update will not actually install without Developer-ID signing + notarization.
- `electron-updater` must be a runtime **`dependency`** of `apps/desktop` (else it isn't packaged and auto-update silently no-ops).
