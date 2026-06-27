# 0041 — dev-only debug surfaces: env-gated, loopback, sandbox-home, never packaged

**Status:** accepted · 2026-06-27 · **extends** [ADR 0004](./0004-electron-desktop-runtime.md)
(the "standard Electron security hygiene is mandatory" clause) with the rules for the _opposite_
posture — deliberately opening the app up for debugging — so the two never collide. Governs the
agent-attachable debug harness (PRD [#1](https://github.com/mathewcst/dotden/issues/1); plan in
`.scratch/debugging/`). Touches no shipped behavior.

**Decision:** dotden may expose **debug surfaces** that let an external agent attach to and drive the
running app (Chromium CDP for the renderer; a dev-only IPC bridge for main-only verbs). Every such
surface is bound by **four invariants, all required, no exceptions**: (1) **env-gated** behind
`!app.isPackaged && process.env.DOTDEN_DEBUG_CDP`; (2) **loopback-only** (`127.0.0.1`); (3)
**sandbox-home** — the surface refuses to arm unless the app's `home` (the chezmoi destination)
resolves under a disposable scratch dir, proven by `DOTDEN_AGENT_SANDBOX=1`; (4) **never packaged** —
no debug surface, port, switch, or bridge can exist in a packaged build. A surface that cannot prove
all four **fails loudly and does not arm** (never fail silently).

---

## Context — why an explicit ADR for "opening the app up"

[ADR 0004](./0004-electron-desktop-runtime.md) makes hardening mandatory: `contextIsolation` on,
`nodeIntegration` off, `sandbox` on, a strict IPC surface, denied outbound navigation. The debug
harness deliberately **inverts** part of that posture — an open CDP port is, by construction,
**unauthenticated localhost RCE**, and a dev IPC bridge adds renderer-reachable verbs outside the
production `DotdenApi` contract ([ADR 0031](./0031-shared-ipc-contract-renderer-never-imports-main.md)). That is
acceptable as a _dev convenience_ and unacceptable as a _shipped capability_. Without a written rule
the two postures rot into each other: a debug switch leaks into a release, or a "temporary" port gets
hardcoded. This ADR draws the line once so the harness work can move fast behind it.

Two extra hazards are specific to dotden and motivate invariant **(3)**:

- **Blast radius.** Driving the real app lets an attached agent invoke `Apply` or "Delete
  everywhere", which run real git/chezmoi against the user's real `$HOME` dotfiles. A debug surface
  that armed against the real home would hand an automated agent destructive reach over the user's
  actual configuration.
- **Determinism.** The app routes its launch into `fresh` / `incomplete` / `ready`
  ([ADR 0026](./0026-launch-routing-derives-entry-screen-from-registration-state.md)); a throwaway **seeded** profile is how the agent
  reaches real screens reproducibly. The same move that gives determinism (relocate `userData` +
  `home` to a scratch dir) is the move that contains the blast radius — so we require it.

## Decision

**1 — Env-gate, single flag.** Every debug surface keys off `!app.isPackaged &&
process.env.DOTDEN_DEBUG_CDP`. This reuses the established `DOTDEN_*` dev-override idiom and means a
packaged build (`app.isPackaged === true`) can never arm a surface even if the env var is present.
The flag's value doubles as the CDP port.

**2 — Loopback-only.** Debug ports bind `127.0.0.1` (IPv4, not `localhost`/`::1`). No surface listens
on a routable interface. The harness runs under WSLg in the **same** WSL distro as the agent — one
network namespace, plain loopback, no WSL↔Windows bridge — so loopback is sufficient and nothing
needs forwarding.

**3 — Sandbox-home, or refuse.** When `DOTDEN_DEBUG_CDP` is set, the app **must not** create the
window or register the bridge unless `app.getPath('home')` resolves under the disposable scratch dir.
The seed/launcher proves the sandbox by setting `DOTDEN_AGENT_SANDBOX=1` after building
`<scratch>/{userData,home}`; the guard checks both the flag and that `home` is actually inside the
scratch tree. If the check fails, the app **bails loudly** with the reason and the fix — it never
silently falls back to the real home. (`userData` relocates via `app.setPath('userData', …)`; `home`
relocates because `app.getPath('home')` derives from `$HOME` on Linux/WSL — both are dev-only reads
gated by invariant (1).)

**4 — Never packaged.** No CDP switch (`remote-debugging-port` / `remote-allow-origins`), no
`--inspect`, no dev IPC bridge, and no `__dotdenDev` global may be reachable in a packaged build.
Invariant (1)'s `!app.isPackaged` is the primary guarantee; the dev IPC bridge additionally lives in
a clearly-named dev-only module so it is obvious in review. `remote-allow-origins=*` (**required** on
Chromium 111+ for the CDP handshake to succeed) is only ever paired with the port, only in dev.

**5 — The dev IPC bridge is additive and dev-only, not a `DotdenApi` change.** The bridge
(`window.__dotdenDev`: stub-dialog / fire-tray-action / trigger-incoming / get-main-state) exposes a
renderer global **outside** the production IPC contract. It does not modify `DotdenApi`
([ADR 0031](./0031-shared-ipc-contract-renderer-never-imports-main.md)); it is registered only in the dev branch of
`whenReady` and exists only under invariant (1). It lives in `preload` (not `renderer/features`), so
the renderer layer-boundary lint ([ADR 0033](./0033-renderer-three-layer-architecture.md) /
[0035](./0035-structural-invariants-are-gated.md) /
[0036](./0036-component-surface-ui-vanilla-den-branded.md)) is not subverted; this is a documented,
bounded exception.

**6 — Renderer-first; main-process inspector is a noted escape hatch, not built.** The preload
already mirrors ~90% of the main process into `window.dotden`, so most verbs are reachable over the
renderer CDP via `browser_evaluate`. The full main-process V8 inspector (`--inspect=9229`, opened via
`require('inspector').open()` — **not** `appendSwitch('inspect')`, which silently no-ops) is **not**
built in v1; if ever needed it inherits all four invariants above, including never-packaged.

## Consequences

- **Hardening (ADR 0004) is untouched in every shipped path.** `contextIsolation` / `nodeIntegration:
false` / `sandbox` and the strict IPC surface stay exactly as-is. The debug surfaces are a
  parallel, dev-gated track that the release build proves-out via `app.isPackaged`.
- **Safety is a code invariant, not a convention.** The sandbox-home guard (invariant 3) is a small
  pure predicate and is unit-tested (PRD #1, Testing Decisions), so "an agent can only ever touch a
  throwaway home" cannot regress unnoticed.
- **Reviewers have a checklist.** Any PR touching a debug surface is checked against the four
  invariants; a surface missing any one is rejected. New debug capabilities (e.g. the deferred
  Playwright `_electron` E2E, or a future `--inspect`) inherit this ADR by default.
- **One dev-only renderer global exists** (`window.__dotdenDev`) as a documented exception to the
  single-IPC-surface rule — bounded to dev, named to be obvious, and outside `DotdenApi`.
- **Operational note:** an armed dev build has an open localhost RCE port. That is acceptable on a
  developer's WSL box and is the explicit reason invariants (1) and (4) forbid it ever shipping.
- **The committed `.mcp.json` is inert without the app.** It only points a driver at
  `127.0.0.1:9222`; with no armed app on that port it connects to nothing, so committing it leaks no
  capability.
