# dotden

A cross-platform desktop GUI that wraps **chezmoi**, letting a user manage and sync their **Den** — their whole configuration — across every **environment** they work on, without learning chezmoi's command line.

## Voice

In-app copy speaks directly to the user and avoids referring to dotden in third person. External copy, such as README and website copy, may use “dotden.” See `docs/brand-and-vocabulary.md` for external copy, UI labels, and naming decisions.

## Language

**dotden**:
The desktop application itself. Named from **dot** (your dotfiles and configs) + **den** (a snug, private space that's yours) — your setup, in a space that feels like home on any computer.
_Avoid_: my env (former working name), menv (a local clone-directory name only — not a canonical identifier; repo, root package, and all package scopes use **dotden**), MyEnv, "the wrapper".

**Den**:
The whole collection of configuration a user has chosen to let dotden manage and sync across their environments. The user-facing name for chezmoi's managed set, and the product concept behind the brand.
_Avoid_: setup (marketing word only), dotfiles (jargon; too narrow for the UI), profile, settings, config (too generic); environment (now a single computer).

**environment**:
One computer — really one OS install — running dotden and participating in the user's Den. A user has many environments; the same physical laptop dual-booting two OSes is two environments. Each environment has a **stable random ID** (its identity), a **user-editable label** (default from hostname), an **OS**, and the set of **Workspaces** it subscribes to, recorded in a synced registry. Identity is the ID, never the hostname (hostnames collide and change). A reinstall keeps the same environment identity only if the user explicitly **claims** the old registry entry (see lifecycle below). Stays lowercase — it reads as natural developer language.
_Avoid_: machine (dated), device, host, node, system, client.

**Remote**: The shared git repository where dotden stores the user's Den. It is the only shared storage: dotden does not run a file-sync backend, and user-facing copy may call this “a repo you own.” The Remote lives on a **Provider** and is reached as a plain git remote — dotden is provider-agnostic at the transport floor (see ADR 0020).
_Avoid_: server, backend, cloud (except “not another cloud drive”), origin (Git-internal name).

**Provider** _(dotden — the git host the Remote lives on)_: The service hosting the user's Remote: GitHub, GitLab, Bitbucket, a self-hosted instance (GitLab/Gitea/Forgejo), or a bare git remote reached over SSH. dotden's **transport floor is pure git** and works on any Provider with working git credentials (chezmoi imposes no provider restriction). Provider-specific _conveniences_ — OAuth/device-flow sign-in, one-click Remote creation, API-based change detection — are an **additive layer above the floor**, built per-Provider and **deferred past v1**. v1 leans entirely on the user's existing git credentials and creates no Remote. **GitHub is the v1 flavor, not a single-provider restriction.**
_Avoid_: host (ambiguous with environment hostname), backend, service, remote (that's the repo, not the host).

**File** _(filesystem unit)_: An individual filesystem file dotden manages, such as `~/.zshrc`. A File is distinct from a **Folder**; use “file” only when the thing is actually one file.
_Avoid_: dotfile, config (when referring to one path), item.

**Folder** _(filesystem unit)_: A filesystem directory dotden manages recursively, such as `~/.config/nvim/`. A Folder can contain many **Files** and child Folders; committing a Folder records the current managed contents under that path rather than turning it into generic cloud-drive sync.
_Avoid_: item, collection, group.

**Workspace** _(dotden — top-level container + environment-access boundary)_: A top-level grouping the user creates, such as “Work” or “Personal.” A Workspace is the unit of **environment access**: each environment subscribes to Workspaces and applies only Files and Folders inside them.
_Avoid_: vault (implies encryption), space, profile, repo, collection.

**Group** _(dotden — organization inside Workspace)_: A nested, user-named node within a Workspace that organizes Files and Folders. Groups are purely organizational: they can nest, have no access control, have no Scope, and moving a File or Folder between Groups never changes its filesystem path.
_Avoid_: folder (filesystem term), tag, category, bundle.

**Scope** _(dotden — OS applicability for Files and Folders)_: The set of OSes where a File or Folder applies. Folder Scope is inherited by children; children may narrow but not broaden their parent Folder's Scope.
_Avoid_: filter, applicability, platform (platform = OS value itself, not rule).

**Secret reference** _(dotden — wraps chezmoi password-manager templating)_: A placeholder stored in the Remote instead of an actual secret, e.g. a 1Password `op://vault/item/field` path. The real secret never enters the repo; chezmoi resolves the reference from the user's password manager at **Apply** time.
_Avoid_: secret, credential (the resolved value), placeholder.

**Track** _(dotden verb — maps to chezmoi `add`)_: Start managing an untracked File or Folder. Track is the primary action for status **Untracked**.
_Avoid_: add (too vague), import.

**Untrack** _(dotden verb — maps to chezmoi `forget`)_: Stop managing a File or Folder while leaving the real filesystem path untouched on every environment. Non-destructive; confirmation copy must make clear the file or folder stays on disk.
_Avoid_: remove, delete, unsync, forget (chezmoi term underneath).

**Delete everywhere** _(dotden verb — maps to chezmoi `remove` / `destroy`)_: Remove a File or Folder from the Den and delete the real filesystem path on all environments where it applies. Destructive; always confirmed.
_Avoid_: remove, unmanage, trash.

**Conflict** _(dotden)_: A state where the same File changed both on an environment and on the Remote in a way git cannot merge automatically. Non-overlapping edits are not Conflicts; they auto-merge.
_Avoid_: clash, collision (use in prose only), merge error.

**Source state** _(chezmoi term)_: The canonical version of the Den stored in git, using chezmoi's encoded filenames (e.g. `dot_zshrc`). Lives locally on each environment and mirrors the **Remote**.

**Target state** _(chezmoi term)_: What chezmoi computes _should_ exist on a given environment, derived from source state plus that environment's configuration. Differs per environment.

**Destination state** _(chezmoi term)_: The actual current contents of managed files on an environment right now, before any Apply.

**Commit** _(dotden verb — maps to chezmoi `add` / `re-add` plus git commit)_: Take an environment's current edited Files and Folders and intentionally record them into the **Den**, ready to push. Primary button label: **Commit changes**.
_Avoid_: save, capture, upload.

**Apply** _(dotden verb — maps to chezmoi `apply`)_: Write source/target state onto an environment's real files and folders. The "make this real here" direction.
_Avoid_: install, restore, pull (pull is the git step underneath), download.

**Sync** _(dotden verb — transport)_: Move already-Committed changes between environments and check for incoming changes. Sync is transport only; it does not automatically Commit or Apply by default.

**Auto-sync** _(dotden low-risk automation level, environment-local)_: Automatically sends Committed changes and notifies about incoming changes. **Apply** stays a manual review.
_Avoid_: auto-commit (that's the separate full-hands-off level), continuous backup, mirroring.

**Apply automatically** _(dotden setting label; shorthand Auto-apply)_: Apply clean incoming changes without review. Conflicts and risky changes still ask first.

**YOLO mode** _(dotden setting label)_: Strongly warned full-hands-off automation that automatically Commits, Syncs, and Applies changes except Conflicts. The name is intentionally warning-shaped: “this might break things but I don't care.”

**Operation trace** _(dotden-internal, environment-local; engineering construct, never user-facing copy)_: The named, timed span tree for one user action — a Commit, Sync now, Apply, onboarding step, or poll. Distinct from **Sync** (the user-facing transport verb). See ADR 0007.
_Avoid_: transaction, session.

**Wide event** _(dotden-internal)_: The single comprehensive structured event emitted per **Operation trace**, carrying outcome, per-span timings, the typed error chain, and allowlisted business counters only — one event per operation, not many log lines.
_Avoid_: log line, metric.

**Allowlisted attribute key** _(dotden-internal)_: The compile-time-restricted set of counts/enums permitted on a **Wide event** (`fileCount`, `workspaceCount`, `environmentCount`, `outcome`, `errorClass`, `chezmoiExitCode`, `durationMs`, `automationLevel`, `queued`). Paths, file contents, secrets, `op://` references, repo URLs, and hostnames are not representable by construction — the privacy invariant lives in the type system.
_Avoid_: tag, label, field.

## Flagged ambiguities

**"Sync"** — resolved: **Sync = transport** — moving already-Committed changes between environments and landing clean incoming changes. It is explicitly **not** Commit; _nothing syncs that you didn't Commit_ (transport-not-commit, ADR 0006). "Sync now" (manual round-trip) and "Auto-sync" are valid labels. **Commit** (record, up) and **Apply** (write, down) remain the precise sub-operations that transport carries.

## Decisions captured

- **Sync transport is pure git, on any Provider.** No dotden backend, no accounts of our own, no hosting. Environments share state only through a single **Remote** the user owns on a git **Provider** (GitHub/GitLab/Bitbucket/self-hosted/bare SSH). chezmoi is provider-agnostic (it does nothing provider-specific — pure git underneath), so dotden is too at the transport floor. Cross-environment "notification" is therefore _poll-based_ (the app fetches the Remote and compares), not server push — there is nothing to push from.
- **dotden is fully self-contained.** It bundles the chezmoi binary and handles git itself (chezmoi's built-in git / a bundled git library), so the user installs nothing else. No "install chezmoi/git first" step ever. Trade-off accepted: larger download and we own keeping bundled chezmoi current, in exchange for predictable behavior and zero version drift.
- **Auth (v1): none of dotden's own — lean on the user's git credentials (V1-Lean, ADR 0020).** dotden holds **no token, no keychain entry, no GitHub App, no OAuth** in v1. Push/fetch ride the user's existing **SSH key or git credential helper**, exactly like chezmoi (which "does not store any credentials" and relies on local git config). This is what makes v1 instantly **multi-provider** with zero per-provider code.
  - **Repo creation (v1): none — the user connects an existing Remote.** dotden does **not** create the Remote. First-run is **"connect your repo"**: the user creates an _empty_ private repo on their Provider themselves, pastes the URL, and dotden runs `chezmoi init <url>` to clone+initialize it. A **remote URL is required at first-run** (sync is the whole point; no local-only mode in v1).
  - **Credential preflight:** after the URL is pasted, dotden does a `git ls-remote` to verify reachability + credentials _before_ committing to the flow; on failure it shows provider-agnostic "set up your git credentials (SSH key or token) for `<host>`" help rather than trying to fix auth itself.
  - **"Greenfield" (v1) = an _empty_ repo the user created, which dotden initializes** — as opposed to v2's "adopt a repo with _existing foreign chezmoi_ content." Only _who creates the empty repo_ moved (dotden → user); the v1↔v2 boundary (no foreign templates/scripts/encryption) is unchanged.
  - **The onboarding gate is _feature-detection_, not _emptiness_ (the gate itself is v1.1; see ADR 0022).** A reachable Remote is not necessarily safe to initialize as greenfield, and a non-empty repo is not necessarily foreign. After preflight, dotden classifies the repo into four buckets: **(A) empty** (`ls-remote` returns no refs) → greenfield init + write `.myenv/`; **(B) dotden-managed** (clone shows `.myenv/`) → second/returning environment; **(C1) non-empty, no `.myenv/`, only benign files** (plain `dot_*`, README, LICENSE, .gitignore) → **the user picks which existing files to track** (lightweight adopt); **(C2) non-empty with foreign chezmoi features dotden doesn't expose** (`run_*` scripts, logic templates, `encrypted_*`, `.chezmoiexternal`, complex `.chezmoiignore`) → **hard-refuse** with a specific reason ("uses chezmoi features dotden doesn't manage yet — full adoption is v2; connect an empty repo or use the chezmoi CLI"). **v1 proper handles only A + B** (greenfield + dotden-managed); **C1/C2 classification ships in v1.1** — it has no UI designs yet, and during v1 the sole user/designer simply connects empty repos. C2's deeper v2 treatment (preserve unsupported constructs read-only, "managed via chezmoi CLI") stays v2. This keeps the v1↔v2 line exactly where ADR 0020 put it (foreign chezmoi = v2) but enforces it correctly — a stray README is C1, not foreign.
  - **Deferred to the post-v1 convenience/automation layer (per-Provider, GitHub-first):** OAuth/device-flow sign-in (the "no PAT pasting" promise), one-click Remote creation, and API-based change detection. **Open decision for that layer:** OAuth is the _portable_ primitive (GitHub Apps are a GitHub-only concept with no GitLab/Bitbucket analogue), but a GitHub App gives tighter _least-privilege_ than OAuth's all-or-nothing `repo` scope — so revisit per-Provider-optimal vs one-portable-OAuth when building it. See ADR 0020.
- **Sync model — transport, not commit (full spec: ADR 0006).** Syncing moves already-Committed changes and lands incoming changes; **by default dotden never auto-Commits and never auto-Applies — nothing leaves an environment until you Commit it, and nothing rewrites your files without review.** The riskier automation levels (Auto-apply, YOLO mode) are explicit, warned opt-ins.
  - **Commit is always manual** — the user clicks to commit local edits into source state (a local git commit). **No silent auto-commit**, ever (avoids pushing half-finished edits or secrets without intent). This holds even when Auto-sync is on: nothing leaves the environment until the user has Committed it.
  - **Push is manual by default** ("Sync now"), so a Commit is local until pushed.
  - **Apply is notify → diff → click.** On detecting incoming changes the app notifies, shows a diff, and applies only on click — either **apply one file** or **apply all**. Never silently overwrites live files.
  - **Automation is risk-graded and safe by default** (environment-local; full ladder in ADR 0006):
    - **Manual (default):** nothing automatic; the poller notifies, you review & Apply.
    - **Auto-sync (onboarding opt-in, low risk):** auto-**push** Committed changes + auto-fetch/notify; **Apply stays a manual review.**
    - **Auto-apply (Settings opt-in, warned):** clean incoming applies automatically; conflicts / uncommitted-guard / deletions still prompt.
    - **YOLO mode (Settings opt-in, strongly warned):** full hands-off — also auto-Commits local edits + pushes + auto-applies/merges (except conflicts). _(Dev shorthand: "this might break things but I don't care.")_
    - Riskier levels are **never on by default** — each is an explicit, warned choice. **Triggers** for automatic levels: event-driven (push on Commit, act on detected incoming) + ~15 min interval backstop.
  - **"Sync now" (both modes)** = push pending + fetch + present incoming **for review** (does _not_ auto-apply, consistent with Manual mode). Behavior surfaced transparently via a `(?)` tooltip in the main view + a Settings explanation.
  - **Absolute invariants (every level, never relaxable):** never auto-resolve a Conflict; never lose data silently (lower levels use the uncommitted-edit guard; full hands-off auto-Commits _before_ merging, so edits survive as commits); act only within subscription (Workspace ∧ OS Scope ∧ not-unsynced ∧ not-deleted); incoming deletions confirm by default. _(Auto-Commit and auto-Apply occur only at the explicitly-enabled, warned levels — Auto-apply and YOLO mode — never by default.)_
  - **A background tray poller is in v1 scope (MVP, not v2).** Independent of Auto-sync, dotden keeps a lightweight tray presence that always polls the Remote on a schedule and fires an OS notification when another environment has changed files — even when the main window is closed. The poller only _detects/notifies_; Auto-sync is what _acts_. _(Implementation: poll the cheap "latest commit SHA on branch" via **`git ls-remote`** — a git primitive that works on every Provider with the user's existing credentials and needs no API token — and only fetch when it moved. Provider-agnostic by construction; a Provider's native API is an optional future optimization, not a dependency.)_
  - **Offline:** Commits locally and queue; pending pushes retry on reconnect / next Sync / next Auto-sync tick.

## MVP definition (v1)

> Store and sync files across environments, and be notified on the current OS when a file changed on a different OS, so it can be applied to the current OS.

In scope: manage **Files** organized into **Workspaces** (environment-access boundaries) and nested **Groups**, per-environment Workspace subscription, manual **Commit**, notify-and-**Apply** (one or all), bundled chezmoi + git, connecting an existing private Remote on any git Provider (user's own git credentials; dotden creates no Remote and holds no token — V1-Lean), and a tray poller with OS notifications. Everything not serving that sentence is a candidate to defer.

- **Conflict resolution: auto-merge clean, ask on collision, never lose silently.** Non-overlapping edits merge invisibly via git. True Conflicts present a per-file Keep-mine / Take-theirs / Open-both choice. Apply is blocked-with-warning when the target File has uncommitted local edits.
- **Secrets (v1): private repo + commit-time scan/warn, PLUS password-manager integration.** A commit-time scanner flags obvious secrets. The user can convert a secret into a **Secret reference** (1Password / Bitwarden / etc.) so the value stays in their vault and only the reference is synced. No dotden backend, no encryption key to distribute. _(v1.5: turn the warn into a soft-block-with-explicit-bypass and make detection the trigger for the migrate-to-password-manager nudge — see Future enhancements.)_
  - _Implications:_ (1) introduces a _narrow, guided_ slice of chezmoi templating into v1 (general templating stays hidden). (2) depends on the user's password-manager **CLI** being installed (`op`, `bw`, …) — we bundle chezmoi but not the password manager; detect and guide. (3) v1 targets the common managers (1Password, Bitwarden; `pass` for the unix crowd) — others are cheap to add since chezmoi already supports them.
- **Per-OS files (v1): verbatim sync + OS Scope.** Files sync verbatim; a File can be scoped to specific OSes so OS-only files don't sync everywhere. "Same file, different content per OS" is deferred (write in-file conditionals for now).
- **Access hierarchy (1Password-style): Workspace → Group → OS → per-file override.** A **Workspace** is the environment-access boundary; an environment subscribes to Workspaces (picked at onboarding, editable later). **Folders** nest inside a Workspace for organization and inherit its access. **OS Scope** narrows a File to certain OSes. A per-file **"unsync here"** (and Delete) is the finest control. _Resolution:_ a File applies on an environment **iff** the environment subscribes to its Workspace **∧** the File's OS Scope matches **∧** it isn't individually unsynced on this environment **∧** it isn't deleted. Enforced via generated per-environment `.chezmoiignore` rules. Access control exists **only** at the Workspace level (coarse boundary), never per-Group.
- **Stack: Electron + React (TypeScript).** Single bundled Chromium for pixel-identical UI on every OS; Node main process drives the bundled chezmoi binary (`child_process`), tray, notifications, OS keychain (`safeStorage`), autostart, auto-update (`electron-updater`). **See ADR 0004.** Trade accepted: heavier install/RAM for a tray app, in exchange for guaranteed cross-OS UI consistency and freedom to use modern libraries. Electron-security hygiene (contextIsolation on, nodeIntegration off, narrow IPC) is mandatory.
- **UI building blocks** (source-verified evaluation, see workflow eval):
  - **File tree → `@pierre/trees`** (Apache-2.0, beta). True built-in virtualization (verified in source), built-in DnD/search/inline-rename, path-first model maps to chezmoi paths. _Accepted constraint:_ rows render imperatively in shadow DOM (not rich React) — per-row signals are limited to the built-in git-status lane + an icon/text `renderRowDecoration` overlay (see the status-presentation decision below), with row actions via `renderContextMenu`. Pin the exact beta version and vendor the source; patch out the `Math.random()` jitter in the virtualization path.
  - **Diff / merge viewer → `@pierre/diffs`** (Apache-2.0, beta; same vendor as `@pierre/trees` for one design language). Component mapping: **Apply diff** → `FileDiff` (split + inline); **Conflict** → `UnresolvedFile` with the `current`/`incoming`/`both` primitive (= Keep-mine / Take-theirs / Both) whose `resolveConflict()` returns the merged file contents to pipe back into chezmoi; **History diff** → `PatchDiff`. _Caveats:_ pin the beta version; trim Shiki grammars to the config languages we render (json/yaml/toml/lua/sh/vim/…); use `CodeView` + the worker pool for large files to keep Shiki tokenization off the main thread (easy under Electron's single Chromium).
- **Frontend web-platform baseline is no longer a constraint** (Electron = evergreen Chromium everywhere). _Historical note:_ on Tauri this was a hard gate — the weakest webview was WebKitGTK on the oldest supported Linux, which blocks adopted-stylesheets-only / CSS-subgrid libraries. Moot under Electron.
- **Onboarding / discovery:**
  - **First environment ("connect your repo"):** the user creates an _empty_ private repo on their Provider, pastes the URL; dotden `git ls-remote` preflights credentials, then `chezmoi init <url>` clones+initializes. Then scan-and-suggest via a bundled **catalog** (known tool → typical config paths); suggest the paths that exist on disk; plus drag-drop / file browser for the rest. Catalog is data we maintain and grow.
  - **Second environment:** paste the _same_ Remote URL → dotden preflights + clones (now has content) → **pick which Workspaces this environment subscribes to** (checkboxes, default all, editable later) → present the subscribed Workspaces' Files as incoming → review and Apply (one or all). A File that already exists locally routes through the **Conflict** flow.
  - **v1 is greenfield-only.** "Greenfield" = an _empty_ repo the **user** created, which dotden initializes (dotden creates no Remote in v1 — V1-Lean). **Adopting a pre-existing, hand-crafted chezmoi repo** (foreign conventions, templates/scripts/encryption) is **v2** ("chezmoi integration"). This removes all advanced-feature edge cases from v1. _(v1.1 adds a feature-detection gate that accepts benign non-empty repos with a per-file "pick what to track" adopt (C1) and hard-refuses foreign-chezmoi repos (C2); see the four-bucket gate under Decisions captured and ADR 0022. Not designed yet — sequenced after the v1 proposed flow.)_
  - **One Den (one repo) per user**, always. Work/personal and any other structure are expressed with **Workspaces** (environment-access boundaries) and nested **Groups**, not separate repos or profiles.
  - **First run auto-creates one default Workspace** (e.g. "Personal"); committed Files land in the currently-viewed Workspace (or the default). The Workspace concept stays invisible until the user creates a second Workspace. No upfront Workspace-design step.
  - **Onboarding ends with an "enable auto-sync?" prompt** (the low-risk level). The **initial materialization** on a returning environment is always a **reviewed Apply**; automation levels engage only afterward.
- **Per-File status presentation (aligned to `@pierre/trees` git-status defaults).** Status has two axes; they're presented separately rather than as one custom badge:
  - **Local axis → the tree's built-in git-status lane**, driven by `setGitStatus([{path, status}])` (union `added|modified|deleted|ignored|renamed|untracked`) computed from `chezmoi status`. Mapping: uncommitted edit → **modified (M)**; new-not-committed → **added (A)**; discovered candidate not yet managed → **untracked (U)**; locally deleted → **deleted (D)**; moved → **renamed (R)**; File OS-Scoped out of this environment → **ignored** (we style it muted; muting is our CSS, not automatic). A Folder or Workspace with changed descendants gets the **automatic folder dot**. _(Confirmed in spike #00: beta.4 renders a **coloured M/A/D/R/U letter** in a fixed-width git lane at the row's **trailing edge**, **plus** tints the icon + filename — the local axis is letter **and** colour, both automatic from `setGitStatus`.)_
  - **Remote axis (incoming) + Conflict → dedicated surfaces AND a per-row overlay (v1).** Dedicated surfaces: a top-level "N incoming from `<environment>` — Review & Apply" entry → the Apply diff screen; conflicts → the Resolve view. **Plus**, in v1, each affected row carries a `renderRowDecoration` overlay icon — `↓` incoming / `⚠` conflict — shown alongside the git-status letter, so full two-axis status is visible while browsing. _Spike #00 = **GO**: the overlay text glyph lands directly **left of** the status letter with a gap (`↓ M` / `⚠ U` / `⚠ M`), no overlap or clipping at compact/default/relaxed density; long names ellipsis-truncate while the status cluster stays pinned right. Drive it with `renderRowDecoration` returning a text glyph — **no `unsafeCSS`, no `setGitStatus` overload**; injecting our own letter via `unsafeCSS` is harmful (doubles the lib's letter)._
  - _Verified API facts (`trees.software/llms-full.txt` + spike #00 against `@pierre/trees@1.0.0-beta.4`):_ `renderRowDecoration` is a **separate lane** (`[data-item-section='decoration']`, `flex:1; justify-content:flex-end`) that renders **together** with the git lane and pins its **text/icon + tooltip, non-interactive** glyph against the status letter — placement confirmed by render, not just docs. Per-row actions use `renderContextMenu` (Commit / Apply / Untrack / Delete everywhere).
- **Environment identity: synced registry, stable random ID, editable label.** The registry (in the chezmoi-ignored dotden metadata) holds per-environment `{ id, label, os, subscribedWorkspaces }`, written on first run, on rename, and when Workspace subscriptions change. "Who changed this" / last-sync / activity is **derived from git log**, never written to the registry, to avoid merge churn.
  - **Environment lifecycle:** a reinstall enters the "connect existing" path and is asked _"new environment, or returning?"_ — choosing returning **claims** an existing registry entry and adopts its ID (history/attribution stay continuous). dotden suggests the likely match by OS + hostname but **never auto-merges**. Claiming only re-associates identity; files are applied fresh from the repo via normal Apply. Settings also offer **Reassign/merge** (fix a mistaken duplicate) and **Retire/remove** (decommissioned environment).
- **Deletions: separate intents, confirm the destructive ones.** "Untrack" (safe, keeps files) and "Delete everywhere" (destructive) are distinct actions. Incoming deletions surface as first-class, clearly-marked items in the Apply review and are never applied without explicit confirmation.
- **History in v1: per-File version list + restore-forward.** Each Commit is a git commit, so v1 surfaces a per-File history with one-click "restore this version" (restoring = capturing that old version forward). Full timeline/branching UI is deferred.
- **Customizable commit-message template** (maps to chezmoi `git.commitMessageTemplate`). Default `[$os-sync-$year-$month-$day]`; editable in settings with variables: `$os` `$arch` `$hostname` `$environment` `$year` `$month` `$day` `$hour` `$minute` `$date` `$time` `$filecount`.
  - _Cross-OS-safe sourcing:_ os/arch/hostname come from chezmoi template data (`.chezmoi.os` etc., already normalized; present `darwin`→`macos`); date/time come from the app runtime clock — **never** from OS shell commands (`date` vs `Get-Date` diverge).
- **Poll cadence (accepted default):** always poll on launch + on network-reconnect; ~2–5 min while the window is focused/active; back off to ~15–30 min when idle in the tray. A cheap commit-SHA compare via `git ls-remote` (one lightweight remote ref query, no full fetch, no Provider API) gates any actual fetch. Interval is an environment-local setting.
- **Distribution (v1): unsigned**, via GitHub Releases + `electron-updater` (auto-download, apply on restart, user can defer). Packaging: macOS `.dmg`, Windows NSIS `.exe`, Linux AppImage. Code signing/notarization deferred (personal/MVP use) → revisit before public launch. Bundled chezmoi pinned per release.
- **Apply atomicity: per-file independent** — apply every File that can succeed, report failures with reasons + retry; one bad File never blocks the rest (matches chezmoi's per-path model).
- **Project shape: public OSS monorepo** — Electron app + feedback/error **relay** + landing-page site.
- **Code documents itself — over-comment rather than under (full spec: ADR 0021).** Because the repo is public, in-code docs are first-class: every exported symbol carries TSDoc, non-obvious _why_ gets an inline comment, and any chezmoi/git wrapper names the CLI command it maps to (ADR 0003). A redundant comment costs a line, a missing one costs a reader an hour — when in doubt, document. Reference implementation: `apps/desktop/src/main/`.
- **Privacy & telemetry (all off by default, opt-in via a first-launch + settings screen; no PII; never config contents/paths/secrets):**
  - **Product analytics → self-hosted Umami** (privacy-first, no cookies/tracking). Light usage metrics only: counts of Workspaces/Folders/Files/environments, engagement events (commit/push/sync/apply), avg environments per user.
  - **Automatic error/crash reporting → hosted Sentry** (opt-in, off by default; chosen as a trusted dev-world tool). No cookies/trackers; PII scrubbed in `beforeSend`; config contents never sent. Onboarding shows an explicit "what will be shared" explanation; declining is fine (with a note that it makes reproducing bugs harder).
  - **Feedback/crash form → small relay → moderated GitHub issues** (sanctioned no-backend exception; see ADR 0001 scope note). Free-text + optional attachments, **offline-queued**. Attachments are **our own scrubbed log** (we attach from a known path; user toggles) **+ screenshots only** (validated by magic bytes, re-encoded to strip EXIF/payloads, size-capped) — never arbitrary user files. PII scrubbed at log-write time + a "review what's sent" preview + server-side scrub. Relay abuse controls (OSS, so no security-by-obscurity): rate-limit by environment-id + IP, app attestation, moderation/triage before anything is public.
  - **Local observability sink (always-on, environment-local; full spec: ADR 0007).** dotden's observability model is **one Wide event per Operation trace**, written to a bounded environment-local ring buffer — the only always-on sink, and the source of the scrubbed-log attachment above. We borrow only the span-tree + `trace_id`-across-two-boundaries (renderer↔main, Electron→relay) slice of distributed tracing; no OTLP collector / tracing backend (nothing to receive it — ADR 0001). Sentry/Umami egress is consent-gated and off by default; **nothing leaves the environment except through that gate**. **Tail sampling** (keep 100% of errors + slow ops, sample fast successes 1–5%) caps ring-buffer size, not a bill, and guarantees a failing trace survives for the feedback attachment.
- **Faithful-wrapper principle: stay aligned with chezmoi; rename only for presentation.** Every dotden concept maps to a real chezmoi concept (see mapping below); we don't invent divergent semantics. The one deliberate addition on top is **Workspace/Group** organization plus per-environment **Workspace-subscription** metadata (which chezmoi has no notion of), stored in the repo in a chezmoi-ignored file so chezmoi never treats it as a managed target; subscriptions compile down to native per-environment `.chezmoiignore` rules. See ADR 0003.
- **Each safety invariant has one type-level owner (full spec: ADR 0008).** The four never-relaxable invariants above compose at runtime in the sync orchestration, so each is owned by exactly one module and expressed in types the others must consume: never-auto-resolve → the Conflict model (resolved bytes unconstructable without an explicit choice); uncommitted-edit guard → the apply planner, re-checked atomically at apply time (no plan-time → apply-time TOCTOU); act-only-within-subscription → the applicability resolver, emitted as a witness Apply _requires_ as input; confirm-incoming-deletions → the Apply-review surface. The automation ladder gates levels by depending on these types, never by re-checking. Four green pure unit tests are testability _without_ locality; the load-bearing test is at the orchestration seam, per event path.

## Data model — synced vs local

**Governing principle:** _user-authored data_ (organization + identity labels the user creates) syncs through the repo; _environment-local facts_ (paths, installed tools, tokens, runtime state) stay local.

**Synced** — in a single chezmoi-ignored `.myenv/` directory in the repo (plus native chezmoi constructs):

- Workspace/Group tree + File/Folder placements + per-environment Workspace subscriptions
- Environment registry `{ id, label, os, subscribedWorkspaces }`
- Secret-scan "sync anyway" allowlist decisions
- Shared user settings: commit-message template, theme, default Apply/notification preferences
- _(OS Scope rules live as native `.chezmoiignore`; Secret references as native chezmoi templates — already in-repo)_

**Local** — Electron `userData` / OS keychain, never synced:

- _(v1: no dotden-held credential — git auth is the user's own SSH key / git credential helper. A dotden-managed Provider token in the keychain arrives only with the post-v1 OAuth convenience layer.)_
- Password-manager choice / detected CLI presence
- Poll cadence + on/off, tray/autostart behavior
- Last-known remote SHA + poll runtime state
- Observability ring buffer + telemetry sampling-disposition state
- Actual filesystem paths and other OS-bound specifics
- chezmoi's own environment-local config

A synced setting acts as the _default_; an environment may override it locally.

## dotden ↔ chezmoi mapping

| dotden (presentation)                      | chezmoi (underneath)                                                       |
| ------------------------------------------ | -------------------------------------------------------------------------- |
| Den                                        | source state (the git repo)                                                |
| Remote                                     | git remote                                                                 |
| File                                       | managed target file                                                        |
| Folder                                     | recursively managed target directory                                       |
| Commit                                     | `add` (new) / `re-add` (existing) → `git commit`                           |
| Apply (one / all)                          | `apply` (writes target state to destination)                               |
| Sync / incoming changes                    | `git push` / `git fetch` + `status` / `diff`                               |
| Conflict — cross-environment (two envs Committed the same File; the **Remote** axis) | `git fetch` + `git merge` in the source-state repo (auto-merge non-overlapping hunks; `<<<<<<<` markers on overlap) — resolved at **pure git**, **not** `chezmoi merge` |
| Local drift — a managed File hand-edited **on disk**, outside dotden     | `chezmoi merge` (3-way **destination · source · target**, configurable merge tool, default `vimdiff`) — a different axis from the cross-env Conflict |
| Untrack                                    | `forget` (source removed, destination kept)                                |
| Delete everywhere                          | `remove` / `destroy` (source + destination removed)                        |
| Secret reference                           | `.tmpl` target + password-manager template function (`onepasswordRead`, …) |
| Scope (e.g. Windows-only)                  | per-OS `.chezmoiignore` rules                                              |
| Workspace / Group (organization)           | **no chezmoi equivalent** — dotden metadata in a chezmoi-ignored repo file |
| Workspace not subscribed on an environment | generated per-environment `.chezmoiignore` rules                           |

## Future enhancements (post-v1)

- **Onboarding tour** that surfaces features (Workspaces, Scope, history, auto-sync) for new users, if needed.
- **Adopt existing/foreign chezmoi repos ("chezmoi integration").** Connect to a hand-crafted chezmoi repo without breaking it: add `.myenv/` non-invasively, and preserve features we don't expose (full templates, `run_` scripts, externals, gpg encryption) as read-only "advanced — managed via chezmoi CLI". v1 is greenfield-only; this is the v2 bridge for power-user early adopters.
- **Visual block editor for per-OS content.** Keep a single File but mark sections as OS-specific blocks ("PATH on Windows" vs "PATH on Ubuntu") in an in-app editor. On Apply, an environment renders only its matching blocks plus the global ones, ignoring the others. This is a friendly GUI over chezmoi templates — the natural successor to OS **Scope**.
- **Soft-block detected secrets at Commit, with explicit bypass + in-flow password-manager migration (v1.5).** This is a UX refinement of the existing v1 secrets feature, not new architecture: v1 already scans at commit-time and already persists per-environment "sync anyway" allowlist decisions. Two changes: (1) replace the hard `Blocked` row ("Secret · excluded", no checkbox) with a _soft_-block the user can override via an explicit acknowledgement ("I understand the risk and commit anyway"); (2) at the moment of detection, offer to migrate the value into a **Secret reference** in the user's password manager of choice (1Password, Bitwarden, `pass`, …) instead of bypassing — turning the friction point into a guided nudge toward vault-managed secrets. Reconcile the hard-block framing in `docs/design-system/screens/onboarding.md` (the `Blocked` Discover row) and the still-to-build `secret-detected` screen when this lands.
- **Encryption (age)** for users who want secrets in the repo without a password manager (requires out-of-band key distribution to each environment).
- **Provider convenience/automation layer (committed direction, per-Provider, GitHub-first; see ADR 0020).** The friction-reducing layer above the v1 pure-git floor: OAuth/device-flow sign-in (so the user never sets up git creds or pastes a PAT), one-click Remote creation (the old "Create Den"), and API-based change detection. Built one Provider at a time — GitHub, then GitLab, Bitbucket, self-hosted GitLab/Gitea. **Bare git (arbitrary SSH URL + PAT/SSH) stays the universal escape hatch**, supported by the floor with no conveniences. Open sub-decision: per-Provider-optimal auth (GitHub App for least-privilege on GitHub) vs one-portable-OAuth-everywhere.
- **Always-on background daemon** beyond the tray.
- **MCP server inside the app (v2/v3).** Ship an opt-in MCP server users enable from within dotden, letting an LLM connect to the running app and interact with the user's Den — query/track/apply Files, inspect Workspaces/Scope, etc. Same model as Figma's in-app MCP (LLM talks to the installed app, not a cloud API). Rough idea only, not scoped.
