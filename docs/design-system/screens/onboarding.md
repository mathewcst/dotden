# Onboarding flow

> The 7-screen first-run, assembled from `OnboardingShell` + `OnboardingMenu` + `OBContent/*`
>
> - `ListRow` (scan rows; was `DiscoverRow` pre-M4). Part of the [design system](../README.md); the canonical application of the
>   [no-duplication rule](../architecture.md).

The onboarding flow is assembled from three components. **Component definitions live on
`03 · Onboarding · Components`; the screen instances live on `04 · Onboarding · Screens`** — see
[architecture & page organization](../architecture.md) for why definitions and screens are kept on
separate pages.

- **`OnboardingMenu`** — a `COMPONENT_SET` with a single `Step = 1…6` variant. Holds the wordmark,
  the 6-item step rail, and the footer tagline. Each variant bakes the rail state (done = ember dot +
  vector check, current = ember dot + number, upcoming = outlined number). Switching screens = switch
  this one variant.
- **`OnboardingShell`** — the window chrome: frameless titlebar + body. In code, the titlebar uses
  the global `WindowTitleBar`, the same shared real window controls as the main shell: macOS traffic
  lights on the left; Windows/Linux minimize/maximize/close on the right; the bar is draggable and
  controls are no-drag.
  The body composes an `OnboardingMenu` instance (left, fixed 360, `Step` set per screen) + a
  **content slot** (`INSTANCE_SWAP` property `Content`, default `OBContent/Welcome`).
- **`OBContent/<Step>`** — one component per step holding that step's content + footer
  (`OBContent/Welcome`, `OBContent/Connect`, …). Sized to the content region; stretches via `FILL`
  in the slot.

So each onboarding screen is **one `OnboardingShell` instance**: set the nested menu's `Step` and
swap `Content`. No raw duplication; editing the menu or shell updates every screen.

Window: 1100 × 720, radius 12, `border` stroke. Reuse the same shell pattern for any future
full-window flow; reuse page-02 library components (`Button`, `Input`, `Checkbox`, `Radio`,
`StatusTag`, …) for the repeatable controls _inside_ each `OBContent`.

Code parity note: every full-window setup surface (first-run chooser, onboarding, returning setup,
settings, loading, review/apply, conflict) mounts the same shared titlebar row, so native drag and
window controls are present before the user chooses a setup path.

> **Built in code (v1, issue 1-06, 2026-06-15).** The V1-Lean A+B flow below is implemented in
> `apps/desktop/src/renderer/features/onboarding/components/`: `OnboardingShell` (frameless titlebar
>
> - rail + content slot + step router) · `OnboardingMenu` (the 6-step rail) · `OBConnectUrl` (step 3, reuses the 1-03
>   `remote.preflight`/`connect` IPC) · `OBDiscover` (step 4) · `ListRow` (scan rows). The
>   tool-catalog discovery scan is the main-process `DiscoveryScanner`
>   (`apps/desktop/src/main/foundation/environments/discovery-scanner.ts`) exposed over the `discover:*` IPC
>   channels — **feature-detection grounded in a known-tools catalog, not a blind sweep** (ADR 0022).
>   Steps Welcome/CreateRepo/Commit/AutoSync/Done render inline in `OnboardingShell`. **C1/C2 and the
>   gh-CLI enrichment remain v1.1** (designs only — see below). The Auto-sync step is a **wired opt-in
>   slot**; the engine is issue 1-12.

## V1-Lean flow (canonical for v1 — ADR 0020)

> dotden **creates no Remote and holds no token** in v1. First-run is _"connect your repo"_: the user
> makes an empty private repo on their Provider, pastes the URL, dotden `git ls-remote` preflights
> credentials, then `chezmoi init <url>` clones+initializes. See [Onboarding & discovery](../../scope-v1.md) + [ADR 0020](../../adr/0020-provider-agnostic-pure-git-floor-v1-lean-auth.md).

**V1-Lean flow (7 screens, page `04 · Onboarding · Screens`):** Welcome → **Create your repo** →
**Connect** (paste URL + preflight) → Discover configs → First commit → Auto-sync (automation ladder)
→ Done. Same 6-step rail + `Step=Done` variant as before; only **steps 2–3 changed meaning** (from
_Connect GitHub_ / _Create your Den_ to _Create your repo_ / _Connect_), so the
`OnboardingMenu`/`OnboardingShell` architecture is unchanged — two `OBContent` swaps.

- **Step 2 — `OBContent/CreateRepo`** _(prep / educational, provider-neutral)_. Explains that dotden
  syncs through a **private git repo the user owns**, and walks them through creating an **empty private
  repo** on any git Provider (GitHub, GitLab, Bitbucket, self-hosted, bare SSH). **No provider deep
  links** — generic steps only (decision: provider-agnostic; "GitHub is the v1 flavor, not a UI
  dependency"). Strongly **recommends private** (the secrets pitch depends on it; we cannot _enforce_
  it — the repo lives on the user's Provider). A collapsible **"▸ How do I create a repo?"** help block
  carries the step-by-step. Reuses `Button` (primary "I've created it → ") + body copy; no new controls.
- **Step 3 — `OBContent/ConnectURL`** _(paste + preflight; the load-bearing new screen)_. A repo-URL
  `Input` + **Connect** primary. On submit dotden runs `git ls-remote` and surfaces one of four
  **states** (documented below). On success it `chezmoi init <url>` clones, then **inspects the cloned
  contents to branch** (greenfield vs returning vs foreign — see _Post-clone branching_). This same
  component is **reused by the returning flow** ([returning environment](./returning-environment.md)) —
  the paste+preflight seam is identical for first and second environments.
- Steps 4–7 (`Discover`, `Commit`, `AutoSync`, `Done`) are **unchanged**.

### `OBContent/ConnectURL` states (spec)

The screen is one component with a `State` variant; the preflight result drives it:

| State                | Trigger                          | Surface                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| -------------------- | -------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Idle**             | default                          | URL `Input` (placeholder `https://… or git@…`) + disabled-until-nonempty **Connect**                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Checking**         | submit → `git ls-remote` running | spinner + "Checking access to `<host>`…", input locked, **+ a `Cancel` button** (the preflight has a timeout and must be user-cancellable — it may block on a GUI credential prompt; ADR 0020 says prevent hangs with timeout/cancel, never by suppressing prompts).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **Reachable**        | `ls-remote` ok                   | brief ✓ "Connected to `<host>`" → auto-advances to clone/branch                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                    |
| **Credential error** | `ls-remote` auth/host failure    | **`Banner` Error tone** (reuse Batch-C/E `Banner`): provider-agnostic headline _"dotden couldn't reach `<host>` with your git credentials."_ Then **enumerate likely causes, never assert one** (the error is genuinely ambiguous — e.g. GitHub returns `Repository not found` for both wrong-URL and no-access): a short bulleted list — _the URL is wrong · the repo doesn't exist · your active credentials don't have access._ Recovery: _"Set up an SSH key or token for `<host>`, then retry."_ Plus a **static** GitHub-CLI hint (v1 — no detection): _"Using the GitHub CLI? Check `gh auth status` and switch with `gh auth switch`."_ Controls: **Retry** + **Cancel/back** + a **"▸ Details"** disclosure exposing the sanitized non-secret diagnostics — **host, URL scheme, exit code, sanitized stderr** (read-only mono block). dotden **does not** try to fix auth itself, holds no token, and never auto-runs `gh auth switch` (V1-Lean). _(The dynamic "authenticating as account `X`" enrichment is **v1.1** — now built as the **`State=CredentialErrorGhCli`** variant of `OBContent/ConnectURL` (`717:1474`); see \_v1.1 onboarding-gate surfaces_ below.)\_ |

### Post-clone branching (auto-detect — no upfront new/returning question)

> **Scope (per ADR 0022, decided 2026-06-15):** **v1 ships only the _empty_ (greenfield) and _already-has-a-Den_ (returning) routes** below. The **benign-adopt (C1, user picks which files to track)** and **foreign-chezmoi hard-refuse (C2)** routes are the **feature-detection gate scheduled for v1.1**. C1/C2 **Figma designs are now built** (2026-06-15) — see _v1.1 onboarding-gate surfaces_ below. C1 is **locked** as a per-file pick (the auto-`.chezmoiignore` shortcut in the greenfield bullet below is **not** the C1 treatment); the picker's **default selection (unchecked vs checked) + grouping are still being grilled** and the built screen is a clean first draft (unchecked-by-default + Select-all), flagged on-canvas.

After a successful clone dotden inspects the source dir and routes:

- **Empty / benign-only** _(README\*, LICENSE\*, CHANGELOG\*, and dot-prefixed entries like `.gitignore`
  / `.github/` which **chezmoi already auto-ignores**)_ → **greenfield**: continue to Discover. dotden
  adds the non-dot benign files (`README*`/`LICENSE*`) to the **generated `.chezmoiignore`** so chezmoi
  never tries to write `~/README.md`. _(Verified: chezmoi treats non-dot source files as managed
  targets unless ignored; the canonical fix is a `.chezmoiignore` entry — chezmoi docs, June 2026.)_
- **Already has a Den** _(`.dotden/` + chezmoi source present)_ → this is really a **returning**
  environment → hand off to the [returning flow](./returning-environment.md) (Find your Den → Choose
  Workspaces → Review & Apply). The first/second-environment split is decided **here, by content**, not
  by an upfront question.
- **Foreign chezmoi content** \_(`dot\__`sources,`.chezmoiroot`, `run\__`scripts,`_.tmpl`,
  age-encrypted, `.chezmoiexternal`)\* → **blocked**: a `Banner`/dialog _"This repo already has a chezmoi
  setup. Adopting an existing chezmoi repo is coming in a later version — connect an empty repo for
  now."_ This is the v1↔v2 boundary (CONTEXT "greenfield-only"); only _who creates the empty repo_ moved.

### v1.1 onboarding-gate surfaces (built 2026-06-15)

> Built per the v1.1 handoff (ADR 0022). All three are **additive** — v1's A+B screens were not
> touched. They live in a dedicated **`v1.1 · Onboarding gate`** section (`703:1333`) on page
> `04 · Screens — Onboarding`, below the v1 sections; new/edited components live in the **Onboarding**
> section of page `02 · Components`. Each screen reuses `OnboardingShell` with the nested menu swapped to
> **`OnboardingMenu/V1`** at the relevant step.

- **C2 — foreign-chezmoi hard-refuse.** Screen `703:1334` (Connect step, menu `Step=3`): the
  `ConnectURL` backdrop dimmed under a **`Scrim`** (black @0.45) + a **`Dialog`** (`Tone=Default` — a
  _boundary_, not destructive-red) `704:1395`. Title _"This repo already has a chezmoi setup"_; body
  _"dotden doesn't manage those features yet — full adoption is coming in a later version. Connect an
  empty repo, or keep managing this one with the chezmoi CLI for now."_ **One** primary action **Connect
  a different repo** (back to ConnectURL); the Dialog's second (Cancel) button is hidden — **no
  proceed-anyway** (hard refuse). Reuses `Dialog`; no new component.
- **C1 — benign-adopt per-file picker.** New component **`OBContent/AdoptExisting`** (`706:1582`),
  forked from `OBContent/Discover` (detach→edit→promote, so all token bindings survive). Screen
  `713:1414` (menu `Step=4`, the Discover-equivalent slot). Lists the repo's existing **benign** files as
  `ListRow` instances with `HasCheckbox` (`DOTFILES` + `REPO FILES` groups), **all unchecked by default**
  - a **Select all** affordance; ember **Track selected** advance. _Default-selection + grouping are
    still being grilled_ — flagged in an on-canvas draft note (`708:9436`). No `Warn`/secret rows (C1 is
    benign-only by definition; anything foreign → C2).
- **gh-CLI account enrichment on CredentialError.** New variant **`State=CredentialErrorGhCli`**
  (`717:1474`) appended to the `OBContent/ConnectURL` set (`607:1309`) — a variant/addition, not a new
  screen. Screen `717:9517` (menu `Step=3`). This variant **replaces the inline `Banner` with a single
  unified error box** (`Error` frame `725:1485`) so the reasons read as one error, not a banner + a
  separate callout: a headline row (red `TriangleAlert` + _"Can't reach the repository"_ in `dd/ink/100`)
  on top, then a **bulleted reasons list**:
  - _"Set up an SSH key or token for `<host>`, then retry."_ (the recovery line)
  - _"git is authenticating to `<host>` via the GitHub CLI as **`<account>`** — if the repo belongs to a
    different account, run `gh auth switch` and retry."_ — the v1.1 enrichment, **one lead among the
    causes, never a verdict**. **Read-only**: `gh auth switch` is mono text only; dotden never auto-runs
    it. Account + command emphasized in `dd/ink/100` + `Geist Mono`; everything else muted-foreground.
    Layout is provider-generic (no GitHub branding) so a future `glab` fits the same slot.

  The box is the **same deep error surface as the v1 Banner** (`dd/red/950` `18:18` fill + faint
  `destructive` `22:16` @30% border, muted-foreground body) — readable on the dark-red surface. Do
  **not** use the bright `destructive` red as a fill (it's a stroke/icon/text token — it blew out
  readability in an early pass). The `▸ git credentials help` disclosure stays below the box. _(The v1
  `CredentialError` variant keeps the plain `Banner`; only this gh variant uses the unified box.)_ `gh auth switch` is shown as **mono text only**;
  dotden never auto-runs it. Body text is neutral muted-foreground; only the account + command are
  emphasized in `dd/ink/100` + `Geist Mono` (no GitHub branding in layout) so a future `glab` etc. fits
  the same slot.

**Screen-level reusable components built for this flow:**

- `ListRow` _(was `DiscoverRow` pre-M4 — folded in 2026-06-14; `HasCheckbox` lead, `Title`=FileName,
  `Path2`=Path, `Meta`=Size)_ — the scan-result row. **`Warn`** state = secret detected (**Batch-E
  soft-warn**, reconciled from the old hard
  `Blocked`): a **real unchecked `Checkbox`** so the file is _selectable_ + an **amber**
  `alert-triangle` + "Secret · review at commit" — **flagged, not excluded**. The user can still track
  it; the secret is handled by the commit-time [secret flow](./secret-and-errors.md) (Convert to a
  Secret reference / Commit anyway). Discover subtitle reworded to "secrets are flagged so you store
  them safely, never synced raw." The Discover list is composed entirely from these instances, grouped
  by category. _(Was: red `alert-triangle` + "Secret · excluded", no checkbox — the hard block, per the
  [Soft-block detected secrets (v1.5)](../../roadmap.md) warn-not-block refinement.)_
- `OBContent/{Welcome,CreateRepo,ConnectURL,Discover,Commit,AutoSync,Done}` — one per screen.
- ConnectURL reuses `Input` + `Button` + `Banner` (Error tone); CreateRepo reuses `Button`; Commit
  reuses `StatusTag=Added`; AutoSync reuses `Radio`; Discover reuses `Checkbox`; forms reuse `Input`.

## Retained: the deferred convenience-layer screens (`Connect GitHub` / `Create your Den`)

The previously-built **`OBContent/Connect`** (GitHub device-flow code) and **`OBContent/CreateDen`**
(name + repo + Private/Public radios, one-click create) are **kept, not deleted** — they are the
visual reference for the **post-v1 per-Provider convenience layer** (OAuth/device-flow sign-in +
one-click Remote creation; ADR 0020 "Future enhancements"). They are **not** part of the v1 flow.
_(Original built order, for the record: Welcome → Connect GitHub (device-flow) → Create your Den →
Discover → First commit → Auto-sync → Done.)_
