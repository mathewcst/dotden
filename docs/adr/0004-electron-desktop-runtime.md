# 0004 — Electron as the desktop runtime

> Status: accepted.

**Decision:** Build dotden on Electron — a single bundled Chromium + Node main process with a React/TypeScript renderer.

**Why:** Electron ships one Chromium identically on Windows, macOS, and Linux: pixel-identical rendering, the full evergreen web platform, and no per-OS webview testing matrix. That uniformity is what unlocks the diff/merge UI dotden depends on — `@pierre/diffs`, whose 3-way conflict primitive maps directly onto our Keep-mine / Take-theirs / Both flow, styles via adopted-stylesheets and lays out with CSS subgrid, both of which need a modern, consistent engine. One runtime also makes `@pierre/diffs` and its off-main-thread Shiki worker path straightforward to wire. (The file tree later moved off the same-vendor `@pierre/trees` to `@headless-tree/react` — [ADR 0032](0032-tree-library-headless-tree-over-pierre.md); `@pierre/diffs` stays for diff/merge.)

**The trade-off we accepted:** Electron installs are large (~100–150MB) and use more RAM than a native-webview shell — and dotden is a 24/7 tray-resident app, where footprint matters most. We consciously prioritize guaranteed cross-OS UI/UX consistency and library freedom over leanness.

**Consequences:**

- The self-contained-app machinery is first-class in Electron: bundle the chezmoi binary as an extra resource and drive it via `child_process`; tray, native notifications, OS keychain (`safeStorage`), autostart, and auto-update (`electron-updater`).
- Standard Electron security hygiene is mandatory (contextIsolation on, nodeIntegration off, `sandbox` on, strict IPC surface, CSP) since we shell out to a binary and touch the filesystem/keychain. As defense-in-depth atop that, the single BrowserWindow denies outbound navigation and new-window creation (`will-navigate` + `setWindowOpenHandler`, routing real links to the OS browser via `shell.openExternal`) — the renderer is a fixed local app and should never leave it.
- A **single-instance lock** (`app.requestSingleInstanceLock`) is required, not optional: dotden is a sync app with an always-on TrayPoller and a login-item, so a second launch must focus the existing window rather than spawn a rival process that would double-poll and race git/chezmoi writes against the same Den + userData.
- Native-chrome identity: `app.setAppUserModelId` (matching the electron-builder `appId`) is set before any `Notification` so Windows attributes toasts/taskbar to dotden; the window stays hidden until `ready-to-show` to avoid flashing an unpainted frame on cold start.
- Main-process logic is TypeScript/Node.
