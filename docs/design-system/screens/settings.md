# Settings (Phase 5 — Batch F)

> The app's configuration surface — 7 tabs in a nav-rail window. Built from `SettingsShell` +
> `SettingsContent/*`. Part of the [design system](../README.md); components in
> [components.md](../components.md), grounding in [`CONTEXT.md`](../../../CONTEXT.md).

Settings is the second window shell in the app (after `AppShell`). It reuses the shared **`Titlebar`**
and follows the **OnboardingShell pattern** — a left nav rail + a swappable content slot — so all 7
tabs share one titlebar and one nav, edited once. Screens live in a **`Settings` SECTION** (`542:6203`)
on **`03 · Screens — App`** (`54:2`), a 4+3 grid below `Secret & errors`.

## Structure

- **`SettingsShell`** (`540:1205`): `Titlebar` (top) · **248px nav rail** (`sidebar` bg, 1px right
  `border`, a `SETTINGS` eyebrow + 7 `SidebarItem` tabs) · **FILL content area** (`background`) holding
  the `Content` INSTANCE_SWAP slot.
- Each screen = one `SettingsShell` instance: the active tab's `SidebarItem` set to `State=Active`, and
  `Content` swapped to the matching `SettingsContent/*` component. Nav-tab icons (`swapComponent`-ed
  onto each `SidebarItem`): Automation `ArrowDownUp` · Commit `GitCommitHorizontal` · Sync `Cloud` ·
  Repository `GitBranch` · Privacy `Shield` · Environments `Monitor` · About `Info`.

## The 7 tabs

1. **Automation** (`542:6204`) — the headline. A **risk-graded ladder** of 4 `SelectRow`s, one per
   automation level from `CONTEXT.md` §101–106: **Manual** (default, Selected — ember radio + "Default"
   pill), **Auto-sync** (auto-push + fetch, Apply stays manual), **Auto-apply** (Amber **"Warned"**
   pill), **YOLO mode** (Red **"Strongly warned"** pill). Warned/strongly-warned use functional
   _status_ tones on the trailing `Pill` only — never an interactive control, preserving ember as the
   sole interactive hue. A `Shield` note restates the never-relax invariants (conflicts never
   auto-resolve; incoming deletions always confirm).
2. **Commit** (`542:6537`) — the commit-message template (`[$os-sync-$year-$month-$day]`, mono field +
   "Reset to default"), a live preview (`[macos-sync-2026-06-14]`), and insertable variable `Kbd` chips
   (`$os $arch $hostname $environment $year …`). Maps to chezmoi `git.commitMessageTemplate`
   (`CONTEXT.md` §143).
3. **Sync & polling** (`542:6712`) — a card of `Switch` rows (background tray poller, start at login) +
   a poll-cadence row (2–5 min active · 15–30 min idle, `CONTEXT.md` §145) + a "what Sync now does"
   note (push + fetch + review, never auto-applies — §107).
4. **Repository** (`542:6866`, `SettingsContent/Repository` `534:1160`) — the connected git remote and
   the secret password-manager choice. **V1-Lean (ADR 0020): no provider login, no token, no keychain.**
   Two cards:
   - **Remote** — a `GitBranch` row showing the remote **URL in mono** (`git@github.com:dotden/den.git`,
     read-only) + `Private · github.com` + a green **"Reachable"** `Pill` (mirrors `OBContent/ConnectURL`
     `State=Reachable`); and a `Shield` row — _"Uses your git credentials · No password or token stored —
     pushes use your SSH key or git credential helper."_ No token field, no "Connected as…", no Disconnect.
   - **Secrets** — the password-manager choice (1Password, green "CLI detected" `Pill`) — unchanged (local
     CLI detection, unrelated to provider login).
   - **Future work (deferred):** the URL is **read-only** in v1 — an in-app **"Change remote URL…"** flow
     (re-run `git ls-remote` preflight, re-point/re-clone) is deferred because changing the remote mid-life
     has data-migration implications. Pairs with the post-v1 provider sign-in + one-click create
     convenience layer (ADR 0020).
5. **Privacy & telemetry** (`542:7068`) — three opt-in `Switch` rows, **all off by default** (analytics
   / crash reports / diagnostic logs), + a `Shield` note: telemetry is Wide-events only — paths,
   contents, secrets, repo URLs can't be represented by construction (`CONTEXT.md` §83/§149).
6. **Environments** (`542:7228`) — the environment registry (this-mac / work-laptop / home-pc: OS ·
   subscribed Workspaces · sync state + a status `Pill` + an `⋯` menu). Reassign/retire live in each
   row's menu (`CONTEXT.md` §140).
7. **About** (`542:7429`) — version + "Check for updates", update channel + auto-update `Switch`,
   resource links, and the chezmoi/git attribution ("dotden is the GUI; your Den stays a plain chezmoi
   repo").

## Notes

- All controls are library instances (`SelectRow`/`Switch`/`Button`/`Pill`/`Kbd`/`SidebarItem`/
  `Avatar`) — 0 raw controls. White-fill + token-binding audits clean.
- **Card rows are `SettingsRow` instances** (`676:1324`, 2026-06-15) — every Sync/Repository/Privacy/
  Environments/About card row migrated from a raw frame to one instance, structurally locking row height
  (~64) and killing the [trailing-frame height-drift class](../figma-conventions.md). The trailing type
  is a `Trail` variant (`None/Switch/Pill/Value/Select/Link/PillButton/PillMenu`); shared
  `HasLead/Lead/Title/HasSub/Sub` props. Only Repository's **mono Remote-URL** row stays bespoke (mono
  ≠ the standardized Geist-Medium `Title`). See [components.md](../components.md).
- Lucide icons imported from the _shadcn/ui kit (Nova)_ library to keep nav-icon style consistent (same
  source as every other icon): `Shield`, `Info` (Batch F), and `GitBranch` (V1-Lean Repository tab — nav
  icon + the Remote-card row icon; replaced the old `User` account icon). `User` is no longer used here.
- The **`Titlebar` componentization** shipped as part of this batch — see
  [components.md](../components.md) and [figma-conventions.md](../figma-conventions.md).
