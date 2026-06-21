# Journey — First install → first Den

> A new user launches dotden for the first time, creates a new Den, connects an empty Remote
> they own, Tracks their configs, makes a first Commit, picks an automation level, and lands
> in the app.

| | |
|---|---|
| **Preconditions** | App installed. chezmoi + git are **bundled** (offline-capable first run — no install/download step, [ADR 0001]). No Den set up on this environment. User has, or can create, an **empty private** git repository on a Provider. |
| **Outcome** | This environment is registered to a new Den; configs are Tracked + Committed; the Remote has the first push; the user is in the app. |
| **Figma** | Page `04 · Screens — Onboarding` (`71:2`), section **"First environment — V1"** (`615:746`). Boot screen: section **"Boot"** (`801:1613`) — "Preparing" `801:1614`, "Boot error" `801:1620`. |
| **v1 status** | Ships v1 — **greenfield only** (empty repo). Adopting an existing repo is the [second-environment journey](03-second-environment-adopt.md) or v1.1 ([ADR 0022]). |
| **Screens touched** | boot → [welcome](../screens/onboarding/welcome.md) → [create repo](../screens/onboarding/create-repo.md) → [connect](../screens/onboarding/connect.md) → [discover](../screens/onboarding/discover.md) → [first commit](../screens/onboarding/first-commit.md) → [keep in sync](../screens/onboarding/keep-in-sync.md) → [done](../screens/onboarding/done.md) → [home](../screens/home.md) |

> [!NOTE]
> **Source of truth = design + the decisions recorded below.** Where the shipped code differs,
> the code is the bug — see [Enforcement flags](#enforcement-flags) at the end.

## The flow

### 0. Boot — "Preparing dotden" *(Figma section "Boot" `801:1613`)*

On cold launch, before anything else, dotden shows a **boot screen with honest, descriptive
stage messages** (not a generic "Preparing…" spinner). Tools are bundled, so nothing downloads;
the stages reflect what actually runs (Figma "Preparing" `801:1614`):

- **"Verifying chezmoi"** → **"Preparing git"** → **"Opening your Den"** (reads registration state).

**Motion — one message at a time, not a static list.** The stages **cycle** as a ticker: each
message slides up + fades in, holds while its real work runs, then slides up + fades out as the
next arrives — the [`stage-ticker`](../motion.md#stage-ticker) pattern. No progress bar (local, not
a download). On the happy path the whole sequence flashes by; a slow stage simply dwells on its own
message. Boot then routes by registration state ([ADR 0026]): a first-time environment has no Den,
so it goes to the **Welcome** screen.

> The Figma "Preparing" frame (`801:1614`) currently shows the three stages **stacked** as a
> reference filmstrip; the **shipped** screen shows **one cycling message** per this spec. See
> [Enforcement flags](#enforcement-flags).

- **Fallback — boot error** (Figma "Boot error" `801:1620`): if a stage fails (bundled tool
  missing/unrunnable, or the state read throws), route to a **"dotden couldn't start"** error
  screen — deep-red banner + warning triangle, cause line *"dotden couldn't prepare its bundled
  tools (chezmoi or git)."*, a "▸ Details" disclosure (tool / host / exit code / sanitized stderr,
  read-only mono), and **Retry** / **Quit**. Never fall through to Welcome on failure, never hang
  ([never fail silently]).

### 1. Welcome — `615:747`

Eyebrow **"WELCOME"**, H1 **"Welcome to dotden"**. Body explains keeping configs in sync across
machines through a private git repo you own. Three value props:

- **"One Den, every environment"** — "Your configs live in one place and follow you to every computer."
- **"Git-backed, you own it"** — "Synced through your own GitHub repo — no lock-in, full history."
- **"Smart & safe"** — "Auto-detects configs and warns before anything touches secrets."

**Actions:** primary **"Get started →"** (begins setup) · secondary link **"I already have a Den"**
(→ [second-environment journey](03-second-environment-adopt.md)). **This screen is the new-vs-existing
fork** — there is no separate chooser screen in the design.

### 2. Create your repo — `615:854`

Eyebrow **"STEP 2 · CREATE REPO"**, H1 **"Create your repo"**. Educational, **provider-neutral** —
dotden creates **no** repo and holds **no** token ([ADR 0020]). A numbered card:

1. "Create a new repository on your git host"
2. "Make it Private — your Den stays yours"
3. "Leave it empty — no README or license needed"
4. "Copy the repository's URL"

**No provider deep links** (GitHub is the v1 flavor, not a UI dependency). **Actions:** "Back" ·
primary **"I've created it"**.

### 3. Connect your repo — `615:988`

Eyebrow **"STEP 3 · CONNECT"**, H1 **"Connect your repo"**. A **"Repository URL"** input
(placeholder `https://github.com/you/dotfiles.git  ·  or  git@host:you/dotfiles.git`), helper:
*"Uses your existing git credentials (SSH key or token) — no password or token is stored. dotden
never creates the repo for you."* **Actions:** "Back" · primary **"Connect"**.

On Connect, dotden runs `git ls-remote` (preflight) then `chezmoi init <url>` (clone). The input is
a small state machine:

| State | Trigger | Surface |
|---|---|---|
| **Idle** | default | URL input + Connect disabled until non-empty |
| **Checking** | `git ls-remote` running | spinner + "Checking access to `<host>`…" + **Cancel** (preflight can block on a GUI credential prompt; must be cancellable, never suppressed — [ADR 0020]) |
| **Reachable** | ls-remote ok | brief ✓ "Connected to `<host>`" → auto-advances |
| **Credential error** | auth/host failure | Error surface; **enumerate likely causes, never assert one** (URL wrong · repo doesn't exist · no access). Recovery: set up an SSH key/token then retry. Static gh-CLI hint. **Retry** + **Cancel** + "▸ Details" (host, scheme, exit code, sanitized stderr). dotden never auto-runs `gh auth switch`. |

**Post-clone branching** (decided by **repo content**, [ADR 0022]):
- **Empty / benign-only** (README\*, LICENSE\*, dot-prefixed entries chezmoi auto-ignores) →
  **greenfield** → continue to Discover.
- **Already a Den** (`.dotden/` + chezmoi source) → this is really a **returning** environment →
  hand off to the [returning flow](03-second-environment-adopt.md), even though the user picked
  "new". The handoff must be **explained, not silent** (see [Enforcement flags](#enforcement-flags)).
- **Foreign chezmoi** (`dot_*` sources, `run_*` scripts, `*.tmpl`, age-encrypted, `.chezmoiexternal`)
  → **blocked**: *"This repo already has a chezmoi setup. Adopting an existing chezmoi repo is coming
  in a later version — connect an empty repo for now."* Hard refuse, **no proceed-anyway** ([ADR 0022], C2).

### 4. Discover your configs — `615:1116`

Eyebrow **"STEP 4 · DISCOVER"**, H1 **"Discover your configs"**. Body: *"dotden scanned your home
folder. Pick what to track — secrets are flagged so you store them safely, never synced raw."*

`api.discover.scan()` runs a **bundled-catalog** scan (known tools → config paths, [ADR 0022]).
List header: **"N configs found · M selected"** + **"Select all"**. Grouped, checkboxed rows
(SHELL / GIT / EDITOR / SSH …); each selection is a **Track** (`chezmoi add`). The user may also
drag-drop files or use the native browse picker.

- **Secrets are flagged, not excluded.** A detected secret/key (e.g. `~/.ssh/id_ed25519`) shows an
  **amber warning row, unchecked by default**, but **still selectable** — the secret is handled at
  Commit time by the [secrets journey](05-secrets.md), not blocked here.

First run silently auto-creates **one default Workspace** (stays invisible until a second Workspace
exists, [scope-v1]). **Actions:** "Back" · primary **"Track M configs"** (count tracks selection).

### 5. Your first commit — `616:1087`

Eyebrow **"STEP 5 · COMMIT"**, H1 **"Your first commit"**. A **"Commit message"** input
(prefilled, e.g. "Initial dotden setup") + a **"Changes to commit"** card listing each added File
with its line additions (green "added" badge). **Actions:** "Back" · primary **"Commit & Push"**.

This **records and pushes in one step**: Commit (`chezmoi add`/`re-add` + `git commit`, **local**)
then the first Sync push (`git push`) seeds the Remote. The push here is **unconditional** — it is
**not** gated by the automation choice in the next step. If the user Tracked **nothing**, this step
shows an empty state and a "Continue" that skips commit+push entirely. Secret scanning runs at
Commit; a detection diverts through the [secrets journey](05-secrets.md).

### 6. Keep it in sync — `616:1230`

Eyebrow **"STEP 6 · AUTO-SYNC"**, H1 **"Keep it in sync"**. The ladder is just the **two
transport-only levels** ([CONTEXT] glossary, [ADR 0037]); **Auto-sync is pre-selected** (the
default), and the user can downgrade to Manual here or later in Settings:

- **Manual** — "Nothing automatic. You review and Apply yourself."
- **Auto-sync** *(default, pre-selected)* — "Auto-push your Commits and get notified about incoming
  changes. Applying always stays a manual review."
- A pointer: *"Change this anytime in Settings."*

Behavior detail: [Automation ladder (02c)](daily-use/automation-ladder.md).

The choice persists to the environment-local automation level. **Actions:** "Back" · primary
**"Finish setup"** (or "Enable & finish" when Auto-sync is picked).

> See [automation model](02-daily-use.md#automation-ladder) for all four levels and their exact
> commit/push/pull/apply boundaries.

### 7. You're all set — `616:1372`

All rail steps checked; success state. H1 **"You're all set"**, body confirming the Den is live.
Summary pills (e.g. **"6 configs"**, **"1 environment"**, **"Auto-sync on"**). Primary
**"Open dotden"** → `api.den.registerEnvironment()` then enters the app on the [home screen](../screens/home.md).
The environment is now registered, so the next launch boots straight to the app ([ADR 0026]).

## State transitions

| Step | Registration / route | Backend |
|---|---|---|
| Boot | reads `launchState` → no Den → Welcome | bundled-tool checks |
| Connect | — | `git ls-remote` → `chezmoi init` → content branch |
| Discover / Commit | — | `track()`, `commit()`, `syncPush()` |
| Done | registers env → app | `registerEnvironment()` |

Routing derives from **registration state**, not a persisted "onboarding complete" flag ([ADR 0026]).
The environment registry entry `{ id, label, os, subscribedWorkspaces }` syncs; credentials/paths
stay local ([ADR 0024]).

## Branches & edge cases

- **Auth fails at Connect** → credential-error state (enumerated causes, retry). See Step 3.
- **Repo not empty** → returning-handoff (has a Den) or hard-refuse (foreign chezmoi). See Step 3.
- **Offline at Connect/push** → `ls-remote` fails fast; a push attempted offline queues
  ([errors & offline journey](06-errors-offline-diagnostics.md)).
- **Secret detected at first Commit** → [secrets journey](05-secrets.md) before the Commit completes.
- **Tracked nothing** → Commit step is skippable ("Continue"); Den is connected but empty.
- **Quit mid-onboarding** → next boot finds cloned-but-unregistered → returns to Welcome ([ADR 0026]);
  no half-registered environment.

## What's v1 vs later

- **v1:** boot screen, greenfield empty-repo flow, catalog discovery, manual Track/Commit, Manual +
  Auto-sync only.
- **v1.1 / deferred:** non-empty-repo adoption & the feature-detection gate ([ADR 0022]); gh-CLI
  dynamic credential enrichment; OAuth / one-click Remote creation ([ADR 0020]).

## Enforcement flags

> What the design or code must change to match this spec. These are bugs/gaps, not open questions.

1. **Onboarding step 6 labels (Figma + code).** Figma `616:1230` uses *"Auto-commit on change
   (Recommended)"* / *"Full auto-sync"* — **off-model**. Replace with the canonical **Manual** +
   **Auto-sync** (two levels only). The Done pill *"auto-commit on"* → **"Auto-sync on"**.
   Code (`OnboardingShell.tsx`) uses a single checkbox → make it the two-level radio.
2. **Entry fork.** Design entry is the **Welcome screen + "I already have a Den" link**. Code added a
   separate `LandingChooser` screen — a divergence; the design has no separate chooser.
3. **Returning-handoff must be explained.** When a "new Den" pick connects a repo that already has a
   Den, the switch to the returning flow must show a brief inline note ("This repo already has a Den
   — switching you to connect it"), **not** a silent shell swap ([never fail silently]).
4. **Button wording.** Confirm **"Commit & Push"** (Figma) vs **"Commit & Sync"** (code) against
   [brand-and-vocabulary] — "Sync" is the canonical transport verb; "push" is used colloquially
   elsewhere. *(Pending confirmation — low stakes.)*
5. **Boot screen** designed in Figma (section "Boot" `801:1613`); spec is Step 0 above.
6. **Boot ticker (Figma).** The "Preparing" frame `801:1614` shows the three stages **stacked**;
   the spec is **one cycling message** ([`stage-ticker`](../motion.md#stage-ticker)). Either redesign
   the frame to a single-message resting state, or keep it explicitly labelled a reference filmstrip.
   *(Pending your call.)* Also: error mock pairs `exit 127` with "permission denied" — 127 is
   *not found*; fix the placeholder.

## Related

- Next: [daily use](02-daily-use.md).
- Mirror flow on machine 2: [second-environment (adopt)](03-second-environment-adopt.md).
- Decisions: [ADR 0026] (routing), [ADR 0020] (lean auth), [ADR 0006] (Commit/transport + automation
  ladder), [ADR 0024] (data boundary), [ADR 0022] (onboarding gate), [ADR 0008] (never-relax invariants).

<!-- Link reference definitions -->
[ADR 0001]: ../../adr/0001-pure-git-github-no-backend.md
[ADR 0006]: ../../adr/0006-sync-model-transport-not-commit.md
[ADR 0008]: ../../adr/0008-invariant-ownership.md
[ADR 0020]: ../../adr/0020-provider-agnostic-pure-git-floor-v1-lean-auth.md
[ADR 0022]: ../../adr/0022-onboarding-gate-is-feature-detection-not-emptiness.md
[ADR 0024]: ../../adr/0024-synced-vs-local-data-architecture.md
[ADR 0026]: ../../adr/0026-launch-routing-derives-entry-screen-from-registration-state.md
[ADR 0037]: ../../adr/0037-automation-ladder-transport-only.md
[CONTEXT]: ../../../CONTEXT.md
[scope-v1]: ../../scope-v1.md
[brand-and-vocabulary]: ../../brand-and-vocabulary.md
[never fail silently]: ../../adr/0008-invariant-ownership.md
