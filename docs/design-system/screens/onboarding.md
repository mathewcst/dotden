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
- **`OnboardingShell`** — the window chrome: titlebar (traffic lights) + body. The body composes an
  `OnboardingMenu` instance (left, fixed 360, `Step` set per screen) + a **content slot**
  (`INSTANCE_SWAP` property `Content`, default `OBContent/Welcome`).
- **`OBContent/<Step>`** — one component per step holding that step's content + footer
  (`OBContent/Welcome`, `OBContent/Connect`, …). Sized to the content region; stretches via `FILL`
  in the slot.

So each onboarding screen is **one `OnboardingShell` instance**: set the nested menu's `Step` and
swap `Content`. No raw duplication; editing the menu or shell updates every screen.

Window: 1100 × 720, radius 12, `border` stroke. Reuse the same shell pattern for any future
full-window flow; reuse page-02 library components (`Button`, `Input`, `Checkbox`, `Radio`,
`StatusTag`, …) for the repeatable controls _inside_ each `OBContent`.

## V1-Lean flow (canonical for v1 — ADR 0020)

> dotden **creates no Remote and holds no token** in v1. First-run is _"connect your repo"_: the user
> makes an empty private repo on their Provider, pastes the URL, dotden `git ls-remote` preflights
> credentials, then `chezmoi init <url>` clones+initializes. See `CONTEXT.md` (Onboarding) + ADR 0020.

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

| State                | Trigger                          | Surface                                                                                                                                                                                                                                                                                           |
| -------------------- | -------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Idle**             | default                          | URL `Input` (placeholder `https://… or git@…`) + disabled-until-nonempty **Connect**                                                                                                                                                                                                              |
| **Checking**         | submit → `git ls-remote` running | spinner + "Checking access to `<host>`…", input locked                                                                                                                                                                                                                                            |
| **Reachable**        | `ls-remote` ok                   | brief ✓ "Connected to `<host>`" → auto-advances to clone/branch                                                                                                                                                                                                                                   |
| **Credential error** | `ls-remote` auth/host failure    | **`Banner` Error tone** (reuse Batch-C/E `Banner`): provider-agnostic _"dotden couldn't reach `<host>` with your git credentials. Set up an SSH key or token for `<host>`, then retry."_ + **Retry** + a "▸ git credentials help" expander. dotden **does not** try to fix auth itself (V1-Lean). |

### Post-clone branching (auto-detect — no upfront new/returning question)

After a successful clone dotden inspects the source dir and routes:

- **Empty / benign-only** _(README\*, LICENSE\*, CHANGELOG\*, and dot-prefixed entries like `.gitignore`
  / `.github/` which **chezmoi already auto-ignores**)_ → **greenfield**: continue to Discover. dotden
  adds the non-dot benign files (`README*`/`LICENSE*`) to the **generated `.chezmoiignore`** so chezmoi
  never tries to write `~/README.md`. _(Verified: chezmoi treats non-dot source files as managed
  targets unless ignored; the canonical fix is a `.chezmoiignore` entry — chezmoi docs, June 2026.)_
- **Already has a Den** _(`.myenv/` + chezmoi source present)_ → this is really a **returning**
  environment → hand off to the [returning flow](./returning-environment.md) (Find your Den → Choose
  Workspaces → Review & Apply). The first/second-environment split is decided **here, by content**, not
  by an upfront question.
- **Foreign chezmoi content** \_(`dot\__`sources,`.chezmoiroot`, `run\__`scripts,`_.tmpl`,
  age-encrypted, `.chezmoiexternal`)\* → **blocked**: a `Banner`/dialog _"This repo already has a chezmoi
  setup. Adopting an existing chezmoi repo is coming in a later version — connect an empty repo for
  now."_ This is the v1↔v2 boundary (CONTEXT "greenfield-only"); only _who creates the empty repo_ moved.

**Screen-level reusable components built for this flow:**

- `ListRow` _(was `DiscoverRow` pre-M4 — folded in 2026-06-14; `HasCheckbox` lead, `Title`=FileName,
  `Path2`=Path, `Meta`=Size)_ — the scan-result row. **`Warn`** state = secret detected (**Batch-E
  soft-warn**, reconciled from the old hard
  `Blocked`): a **real unchecked `Checkbox`** so the file is _selectable_ + an **amber**
  `alert-triangle` + "Secret · review at commit" — **flagged, not excluded**. The user can still track
  it; the secret is handled by the commit-time [secret flow](./secret-and-errors.md) (Convert to a
  Secret reference / Commit anyway). Discover subtitle reworded to "secrets are flagged so you store
  them safely, never synced raw." The Discover list is composed entirely from these instances, grouped
  by category. _(Was: red `alert-triangle` + "Secret · excluded", no checkbox — the hard block, per
  `CONTEXT.md` L203's warn-not-block refinement.)_
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
