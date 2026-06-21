# dotden

A cross-platform desktop GUI that wraps **chezmoi**, letting a user manage and sync their **Den** — their whole configuration — across every **environment** they work on, without learning chezmoi's command line.

This file is the **domain glossary** — what the words mean, and nothing else. Everything else has a home: decisions and their rationale live in [`docs/adr/`](docs/adr/); what ships in v1 in [`docs/scope-v1.md`](docs/scope-v1.md); post-v1 direction in [`docs/roadmap.md`](docs/roadmap.md); the synced-vs-local data model in [ADR 0024](docs/adr/0024-synced-vs-local-data-architecture.md); brand, UI labels, and copy in [`docs/brand-and-vocabulary.md`](docs/brand-and-vocabulary.md).

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

**Placement** _(dotden — where a File or Folder lands on each OS)_: The target path a File or Folder resolves to on a given OS. By default a File has **one** Placement — the same relative path under `$HOME` on every environment — so the user sets nothing. When two OSes need the file in different locations (e.g. `~/.config/foo` on Linux vs `%AppData%/foo` on Windows), the user adds a **per-OS Placement override**. The Placement inspector lists **one row per OS the user actually has** (derived from the environment registry, never a generic OS menu): the first environment shows only its own OS; a second environment on a new OS adds its row, each with a click-to-change path. Placement is **location only** — a File's content is shared across all its Placements. Per-OS _content_ differences (templating, OS conditionals) are a **separate, later** concept, not Placement. Placement and **Scope** are siblings: Scope decides _whether_ a File applies on an OS; Placement decides _where it lands_ when it does. A File excluded by Scope on an OS has no Placement there.
_Avoid_: path (chezmoi-internal / too generic), location (prose only), mapping, destination (that is chezmoi destination state).

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

**Commit** _(dotden verb — maps to chezmoi `add` / `re-add` plus git commit)_: Take an environment's current edited Files and Folders and intentionally record them into the **Den**, ready to Sync. Primary button label: **Commit changes**.
_Avoid_: save, capture, upload.

**Apply** _(dotden verb — maps to chezmoi `apply`)_: Write source/target state onto an environment's real files and folders. The "make this real here" direction.
_Avoid_: install, restore, pull (pull is the git step underneath), download.

**Sync** _(dotden verb — transport)_: Move already-Committed changes between environments and check for incoming changes. Sync is transport only; it does not automatically Commit or Apply by default.

**Auto-sync** _(dotden's one automation level, environment-local; the default — ADR 0037)_: Transport-only automation — automatically **pushes** your Committed changes and **fetches & notifies** about incoming changes. **Apply always stays a manual review.** The automation ladder is just **Manual ←→ Auto-sync**; Auto-sync is pre-selected at onboarding and downgradable to Manual. Invariant: automation only moves data through git (reversible, touches no live file); writing your working tree is always a deliberate human Apply.
_Avoid_: auto-commit, auto-apply, continuous backup, mirroring (dotden has no auto-write-to-disk level — see ADR 0037).

> **Retired (ADR 0037):** **Auto-apply** ("Apply automatically") and **YOLO mode** were removed. "Clean" means no git conflict, not safe-to-write; automation never writes the working tree. Kept here only so the terms aren't silently reused.

**Operation trace** _(dotden-internal, environment-local; engineering construct, never user-facing copy)_: The named, timed span tree for one user action — a Commit, Sync now, Apply, onboarding step, or poll. Distinct from **Sync** (the user-facing transport verb). See ADR 0007.
_Avoid_: transaction, session.

**Wide event** _(dotden-internal)_: The single comprehensive structured event emitted per **Operation trace**, carrying outcome, per-span timings, the typed error chain, and allowlisted business counters only — one event per operation, not many log lines.
_Avoid_: log line, metric.

**Allowlisted attribute key** _(dotden-internal)_: The compile-time-restricted set of counts/enums permitted on a **Wide event** (`fileCount`, `workspaceCount`, `environmentCount`, `outcome`, `errorClass`, `chezmoiExitCode`, `durationMs`, `automationLevel`, `queued`). Paths, file contents, secrets, `op://` references, repo URLs, and hostnames are not representable by construction — the privacy invariant lives in the type system.
_Avoid_: tag, label, field.

**Diagnostics** _(dotden — user-facing)_: The area where a user inspects what dotden actually did underneath — the real CLI commands and their (redacted) output — to self-diagnose a problem and gather the details for a bug report. The one surface that shows real, redacted command output, as opposed to **Operation trace** and **Wide event**, which are internal and scrubbed.
_Avoid_: logs (too generic), debug console (that names one view — the **Console**), telemetry.

**Command record** _(dotden-internal)_: One captured CLI invocation underneath an Operation — its command, arguments, exit code, redacted stdout/stderr, `traceId`, and timestamp. Correlated to its **Operation trace** and **Wide event** by `traceId`. Secrets are redacted at the moment of capture (structure-preserving) before the record is ever persisted.
_Avoid_: log line, log entry, span (that's the **Operation trace**).

**Command log** _(dotden-internal, environment-local)_: The bounded, on-disk ring buffer of **Command records** for an environment — the store the **Diagnostics** surfaces read from. Lives in the Electron-free foundation beside the operation tracer (ADR 0023). Redacted at rest; an opt-in, explicitly-warned unredacted mode is session-scoped and never the default.
_Avoid_: log file (it is a bounded buffer, not raw text on disk), history (that's File version history), trace buffer.

**Console** _(dotden — user-facing, opt-in view)_: The live tail view of the **Command log**, surfaced behind an opt-in setting for users who want to watch what dotden is doing in real time. One of several **Diagnostics** surfaces; the everyday surfaces are the on-error **Details** disclosure and the **Copy diagnostics** export, not the Console.
_Avoid_: terminal (implies interactive input), debugger, log viewer.

## Flagged ambiguities

**"Sync"** — resolved: **Sync = transport** — moving already-Committed changes between environments and landing clean incoming changes. It is explicitly **not** Commit; _nothing syncs that you didn't Commit_ (transport-not-commit, ADR 0006). "Sync now" (manual round-trip) and "Auto-sync" are valid labels. **Commit** (record, up) and **Apply** (write, down) remain the precise sub-operations that transport carries.

## dotden ↔ chezmoi mapping

| dotden (presentation)                                                                | chezmoi (underneath)                                                                                                                                                            |
| ------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Den                                                                                  | source state (the git repo)                                                                                                                                                     |
| Remote                                                                               | git remote                                                                                                                                                                      |
| File                                                                                 | managed target file                                                                                                                                                             |
| Folder                                                                               | recursively managed target directory                                                                                                                                            |
| Commit                                                                               | `add` (new) / `re-add` (existing) → `git commit`                                                                                                                                |
| Apply (one / all)                                                                    | `apply` (writes target state to destination)                                                                                                                                    |
| Sync / incoming changes                                                              | `git push` / `git fetch` + `status` / `diff`                                                                                                                                    |
| Conflict — cross-environment (two envs Committed the same File; the **Remote** axis) | `git fetch` + `git merge` in the source-state repo (auto-merge non-overlapping hunks; `<<<<<<<` markers on overlap) — resolved at **pure git**, **not** `chezmoi merge`         |
| Local drift — a managed File hand-edited **on disk**, outside dotden                 | `chezmoi merge` (3-way **destination · source · target**, configurable merge tool, default `vimdiff`) — a different axis from the cross-env Conflict                            |
| Untrack                                                                              | `forget` (source removed, destination kept)                                                                                                                                     |
| Delete everywhere                                                                    | `remove` / `destroy` (source + destination removed)                                                                                                                             |
| Secret reference                                                                     | `.tmpl` target + password-manager template function (`onepasswordRead`, …)                                                                                                      |
| Scope (e.g. Windows-only)                                                            | per-OS `.chezmoiignore` rules                                                                                                                                                   |
| Placement (per-OS path override)                                                     | shared `.chezmoitemplates` content + a stub entry (`{{ template … }}`) at each OS's target path + generated per-OS `.chezmoiignore` rules ("same contents, different location") |
| Workspace / Group (organization)                                                     | **no chezmoi equivalent** — dotden metadata in a chezmoi-ignored repo file                                                                                                      |
| Workspace not subscribed on an environment                                           | generated per-environment `.chezmoiignore` rules                                                                                                                                |
