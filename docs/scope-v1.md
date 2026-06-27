# dotden v1 — scope

What ships in v1, and what is deliberately deferred. This is the product-scope companion to the architectural decisions in [`adr/`](adr/) and the domain glossary in [`../CONTEXT.md`](../CONTEXT.md). Post-v1 direction lives in [`roadmap.md`](roadmap.md).

## MVP definition

> Store and sync files across environments, and be notified on the current OS when a file changed on a different OS, so it can be applied to the current OS.

In scope: manage **Files** organized into **Workspaces** (environment-access boundaries) and nested **Nooks**, per-environment Workspace subscription, manual **Commit**, notify-and-**Apply** (one or all), bundled chezmoi + git, connecting an existing private Remote on any git Provider (user's own git credentials; dotden creates no Remote and holds no token — V1-Lean), and a tray poller with OS notifications. Everything not serving that sentence is a candidate to defer.

## What v1 delivers

- **Manual Commit, notify-and-Apply transport.** Nothing leaves an environment until you Commit; nothing rewrites your files without a reviewed Apply. → [ADR 0006](adr/0006-sync-model-transport-not-commit.md)
- **Transport-only automation ladder** — **Manual ←→ Auto-sync** (Auto-sync the default), with four never-relaxable safety invariants. Automation only moves data through git; writing your working tree is always a deliberate Apply (no Auto-apply / YOLO). → [ADR 0037](adr/0037-automation-ladder-transport-only.md) (revises [ADR 0006](adr/0006-sync-model-transport-not-commit.md)); invariant ownership → [ADR 0008](adr/0008-invariant-ownership.md)
- **Conflict resolution** — auto-merge clean, ask on collision (per-file Keep-mine / Take-theirs / Open-both), never lose silently; Apply blocked-with-warning when the target File has uncommitted local edits. → [ADR 0006](adr/0006-sync-model-transport-not-commit.md) / [ADR 0008](adr/0008-invariant-ownership.md)
- **Access hierarchy** — Workspace → Nook → OS Scope → per-file "unsync here". A File applies on an environment **iff** it subscribes to the Workspace ∧ OS Scope matches ∧ not individually unsynced ∧ not deleted. Access control exists only at the Workspace level. → [ADR 0005](adr/0005-workspaces-as-environment-access-boundaries.md)
- **Per-OS files** — verbatim sync + OS Scope; "same file, different content per OS" is deferred (in-file conditionals for now). → [ADR 0005](adr/0005-workspaces-as-environment-access-boundaries.md)
- **Greenfield onboarding on the user's own git credentials** — connect an existing empty private Remote; dotden creates no Remote and holds no token. → [ADR 0020](adr/0020-provider-agnostic-pure-git-floor-v1-lean-auth.md); the feature-detection gate (v1.1) → [ADR 0022](adr/0022-onboarding-gate-is-feature-detection-not-emptiness.md)
- **Environment identity & lifecycle** — synced registry, stable random ID, editable label; claim / reassign / retire. → [ADR 0024](adr/0024-synced-vs-local-data-architecture.md)
- **Deletions as separate intents** — Untrack (safe) vs Delete everywhere (destructive, confirmed); incoming deletions confirmed by default. → [ADR 0006](adr/0006-sync-model-transport-not-commit.md)
- **Per-File status presentation** — two-axis (local git-status lane + incoming/conflict row decoration). → [design-system/components.md](design-system/components.md)
- **History** — per-File version list + restore-forward (each Commit is a git commit; full timeline deferred). → [design-system/screens/file-history.md](design-system/screens/file-history.md)
- **Self-contained** — bundles the chezmoi binary and handles git itself; no "install chezmoi/git first" step ever. → [ADR 0020](adr/0020-provider-agnostic-pure-git-floor-v1-lean-auth.md)
- **Stack: Electron + React (TypeScript).** → [ADR 0004](adr/0004-electron-desktop-runtime.md); main-process layering → [ADR 0023](adr/0023-main-process-layering-electron-free-foundation.md)
- **Public OSS monorepo + over-commented code.** → [ADR 0009](adr/0009-monorepo-turborepo-pnpm.md) / [ADR 0021](adr/0021-code-documents-itself-over-comment.md)
- **Privacy & telemetry, off by default** — Umami / Sentry / feedback relay / local observability sink. → [ADR 0007](adr/0007-observability-wide-events-local-traces.md); no-backend scope → [ADR 0001](adr/0001-pure-git-github-no-backend.md)

## v1 specifics (not captured in an ADR)

### Secrets

Private repo + commit-time scan/warn, **plus** password-manager integration. A commit-time scanner flags obvious secrets. The user can convert a secret into a **Secret reference** (1Password / Bitwarden / etc.) so the value stays in their vault and only the reference is synced — no dotden backend, no encryption key to distribute. Implications: (1) introduces a _narrow, guided_ slice of chezmoi templating into v1 (general templating stays hidden); (2) depends on the user's password-manager **CLI** being installed (`op`, `bw`, …) — we bundle chezmoi but not the password manager, so detect and guide; (3) v1 targets the common managers (1Password, Bitwarden; `pass` for the unix crowd) — others are cheap to add since chezmoi already supports them. The per-environment "sync anyway" allowlist is synced metadata (see [ADR 0024](adr/0024-synced-vs-local-data-architecture.md)). The full flow is mapped in [secrets journey (J05)](user-flow/journeys/05-secrets.md): commit-time scan → **soft-warn (never block)** → two-step `SecretWarning` → `SecretPicker` (Convert via a full multi-manager picker) or **Commit-anyway** (file-scoped synced allowlist); apply-side resolution from the receiving vault with a **pre-flight guided fix** for a missing CLI / locked vault; mid-flight Convert = ① re-derive (see [ADR 0039](adr/0039-state-persistence-tiers-and-the-unfinished-work-rule.md)). _The earlier "soft-block + in-flow migration" item once slated for v1.5 is **delivered in v1** by this design; the remaining v1.5/later work is age encryption + richer in-flow migration (see [roadmap.md](roadmap.md))._

### Stack & UI building blocks

Single bundled Chromium for pixel-identical UI on every OS; the Node main process drives the bundled chezmoi binary (`child_process`), tray, notifications, OS keychain (`safeStorage`), autostart, and auto-update (`electron-updater`) — see [ADR 0004](adr/0004-electron-desktop-runtime.md). The two load-bearing UI libraries:

- **File tree → `@headless-tree/react`** (headless tree, shadcn-standard; **replaced `@pierre/trees`** — [ADR 0032](adr/0032-tree-library-headless-tree-over-pierre.md)). Hands us a flat node list rendered as our own shadcn `NookRow`/`FileRow` (the one-node **Nook** model — [ADR 0040](adr/0040-one-organizational-node-the-nook.md)); built-in DnD, keyboard nav, inline rename, search, multi-select. Per-row signals = the git-status lane + a decoration overlay (`↓`/`⚠`) + a context menu. No virtualization in v1 (opt-in later; dotfile sets are small).
- **Diff / merge → `@pierre/diffs`** (Apache-2.0, beta; same vendor). **Apply diff** → `FileDiff`; **Conflict** → `UnresolvedFile` (`current`/`incoming`/`both` = Keep-mine / Take-theirs / Both; `resolveConflict()` returns merged contents to pipe back into chezmoi); **History diff** → `PatchDiff`. Pin the beta; trim Shiki grammars to the config languages; use `CodeView` + the worker pool for large files. Component mapping detail lives in [design-system/components.md](design-system/components.md).

### Onboarding & discovery

- **First environment ("connect your repo"):** the user creates an _empty_ private repo on their Provider, pastes the URL; dotden `git ls-remote` preflights credentials, then `chezmoi init <url>` clones+initializes. Then scan-and-suggest via a bundled **catalog** (known tool → typical config paths); suggest the paths that exist on disk; plus drag-drop / file browser. The catalog is data we maintain and grow.
- **Second environment:** paste the _same_ Remote URL → preflight + clone (now has content) → **pick which Workspaces this environment subscribes to** (default all, editable later) → present the subscribed Workspaces' Files as incoming → review and Apply. A File that already exists locally routes through the **Conflict** flow.
- **One Den (one repo) per user**, always — Work/personal and other structure are expressed with Workspaces and nested Nooks, not separate repos.
- **First run auto-creates one default Workspace** (e.g. "Personal"); the Workspace concept stays invisible until the user creates a second one.
- **Onboarding ends with an "enable auto-sync?" prompt** (the low-risk level). The **initial materialization** on a returning environment is always a **reviewed Apply**; automation engages only afterward.

See [ADR 0020](adr/0020-provider-agnostic-pure-git-floor-v1-lean-auth.md) (auth/repo floor) and [ADR 0022](adr/0022-onboarding-gate-is-feature-detection-not-emptiness.md) (the v1.1 feature-detection gate).

### Customizable commit-message template

Maps to chezmoi `git.commitMessageTemplate`. Default `[$os-sync-$year-$month-$day]`; editable in settings with variables: `$os` `$arch` `$hostname` `$environment` `$year` `$month` `$day` `$hour` `$minute` `$date` `$time` `$filecount`. _Cross-OS-safe sourcing:_ os/arch/hostname come from chezmoi template data (`.chezmoi.os` etc., already normalized; `darwin`→`macos`); date/time come from the app runtime clock — **never** from OS shell commands (`date` vs `Get-Date` diverge).

### Poll cadence

Always poll on launch + on network-reconnect; ~2–5 min while the window is focused/active; back off to ~15–30 min when idle in the tray. A cheap commit-SHA compare via `git ls-remote` (one lightweight remote ref query, no full fetch, no Provider API) gates any actual fetch. Interval is an environment-local setting. The tray poller is in v1 scope (MVP, not v2): independent of Auto-sync, dotden keeps a lightweight tray presence that always polls and fires an OS notification when another environment changed files — even when the main window is closed. The poller only _detects/notifies_; Auto-sync is what _acts_.

### Apply atomicity

Per-file independent — apply every File that can succeed, report failures with reasons + retry; one bad File never blocks the rest (matches chezmoi's per-path model).

### Distribution

v1 ships **unsigned**, via GitHub Releases + `electron-updater` (auto-download, apply on restart, user can defer). Packaging: macOS `.dmg`, Windows NSIS `.exe`, Linux AppImage. Code signing/notarization deferred (personal/MVP use) → revisit before public launch. Bundled chezmoi pinned per release. Toolchain → [ADR 0010](adr/0010-electron-desktop-toolchain.md). Install notes, including the unsigned macOS right-click → Open path, live in [distribution.md](distribution.md).

## Deferred

**v1 is greenfield-only** — "greenfield" = an _empty_ repo the user created, which dotden initializes (dotden creates no Remote in v1). Adopting a pre-existing, hand-crafted chezmoi repo (foreign templates / scripts / encryption) is **v2**. The v1.1 feature-detection gate accepts benign non-empty repos (C1 — per-file pick-what-to-track) and hard-refuses foreign-chezmoi repos (C2) — see [ADR 0022](adr/0022-onboarding-gate-is-feature-detection-not-emptiness.md). Everything post-v1 lives in [`roadmap.md`](roadmap.md).
