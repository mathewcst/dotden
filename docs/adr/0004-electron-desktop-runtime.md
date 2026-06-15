# 0004 — Electron as the desktop runtime

> Status: accepted.

**Decision:** Build dotden on Electron — a single bundled Chromium + Node main process with a React/TypeScript renderer.

**Why:** Electron ships one Chromium identically on Windows, macOS, and Linux: pixel-identical rendering, the full evergreen web platform, and no per-OS webview testing matrix. That uniformity is what unlocks the diff/merge UI dotden depends on — `@pierre/diffs`, whose 3-way conflict primitive maps directly onto our Keep-mine / Take-theirs / Both flow, styles via adopted-stylesheets and lays out with CSS subgrid, both of which need a modern, consistent engine. One runtime also makes the coherent same-vendor Pierre stack (`@pierre/trees` + `@pierre/diffs`) and its off-main-thread Shiki worker path straightforward to wire.

**The trade-off we accepted:** Electron installs are large (~100–150MB) and use more RAM than a native-webview shell — and dotden is a 24/7 tray-resident app, where footprint matters most. We consciously prioritize guaranteed cross-OS UI/UX consistency and library freedom over leanness.

**Consequences:**

- The self-contained-app machinery is first-class in Electron: bundle the chezmoi binary as an extra resource and drive it via `child_process`; tray, native notifications, OS keychain (`safeStorage`), autostart, and auto-update (`electron-updater`).
- Standard Electron security hygiene is mandatory (contextIsolation on, nodeIntegration off, strict IPC surface) since we shell out to a binary and touch the filesystem/keychain.
- Main-process logic is TypeScript/Node.
