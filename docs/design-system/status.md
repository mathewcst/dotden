# Design status — v1.1 onboarding gate

> Live status for the **v1.1 onboarding-gate** work (ADR 0022). Built 2026-06-15 per the v1.1 handoff.
> Spec: [screens/onboarding.md → _v1.1 onboarding-gate surfaces_](./screens/onboarding.md). Node-ID map:
> [inventory.md](./inventory.md). This file flags what is **locked + built** vs **still being grilled**
> so the parallel design grill can finalize the open points without re-discovering state.

## Built (Figma)

All three surfaces are **additive** — no v1 (A/B) screen was touched. New screens live in the
**`v1.1 · Onboarding gate`** section (`703:1333`) on page `04 · Screens — Onboarding`; new/edited
components live in the **Onboarding** section of page `02 · Components`. Audits clean (0 white-fill,
0 unbound product paints on the new nodes).

| Surface                                          | Status                 | Component(s)                                                           | Screen     |
| ------------------------------------------------ | ---------------------- | ---------------------------------------------------------------------- | ---------- |
| **C2** foreign-chezmoi hard-refuse               | ✅ built               | reuses `Dialog` `Tone=Default` (`266:732`)                             | `703:1334` |
| **C1** benign-adopt per-file picker              | ✅ built (first draft) | `OBContent/AdoptExisting` `706:1582`                                   | `713:1414` |
| **gh-CLI** account enrichment on CredentialError | ✅ built               | `OBContent/ConnectURL` variant `State=CredentialErrorGhCli` `717:1474` | `717:9517` |

## Locked decisions honored

- **C2 is a hard refuse** — single primary _Connect a different repo_; the Dialog's second button is
  hidden, **no proceed-anyway**. `Tone=Default` (a boundary, neutral/ember — not destructive-red).
- **C1 is a per-file pick** — `ListRow` + `HasCheckbox`, **not** auto-track-all and **not** the
  auto-`.chezmoiignore` shortcut the old greenfield spec drafted. No `Warn`/secret rows (C1 is
  benign-only by definition).
- **gh enrichment enumerates, never asserts** — the variant replaces the inline Banner with **one
  unified error box** (`Error` `725:1485`): _"Can't reach the repository"_ headline + a bulleted reasons
  list, the gh line being one lead among them (reads as the error's reasons, not a verdict or new info).
  **Read-only**: `gh auth switch` shown as mono text; dotden never auto-runs it. Layout is
  provider-generic (no GitHub branding) so a future `glab` fits the same slot.

## Still being grilled (open — left as clean first drafts)

1. **C1 default selection** — built **unchecked-by-default + Select all**. Whether default should be
   _all-checked_ (and grouping/what-counts-as-benign surfaces) is still open. Flagged on-canvas via the
   draft note `708:9436` next to the component.
2. **C1 grouping** — built as two simple groups (`DOTFILES`, `REPO FILES`). Final grouping TBD.
3. **C2 copy** — current copy is the locked _intent_; wording may still be refined.
4. **gh enrichment — multiple accounts** — current line shows a single authenticated account
   (`octocat`). Whether to enumerate multiple logged-in `gh` accounts is undecided.

## Out of scope (unchanged)

v1 ConnectURL work (Checking cancel, base enumerate/Details CredentialError); v2 "preserve foreign
chezmoi read-only / managed via chezmoi CLI" adoption; any backend/auth logic.

## v1 specced screens — implemented in code

Built directly in the renderer (real chezmoi/git ↔ IPC ↔ UI), not regenerated in Figma:

| Screen spec                                                        | Status    | Component(s)                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| ------------------------------------------------------------------ | --------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| [conflict-resolver](./screens/conflict-resolver.md) (1-11)         | ✅ built  | `ConflictResolver.tsx` — ConflictFiles list · `@pierre/diffs` `UnresolvedFile` merge view (read-only) · Keep mine / Take theirs / Open both · `n/m` resolve progress · Apply resolution (ember when ready) · Abort                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| [returning-environment](./screens/returning-environment.md) (1-13) | ✅ built  | **Wizard (Part A)**: `ReturningShell.tsx` + `ReturningMenu.tsx` rail (Connect · Find your Den · Choose Workspaces · Review & Apply — the 4th always-`upcoming` handoff) reusing the onboarding shell recipe; **Connect** reuses onboarding `OBConnectUrl.tsx` unchanged (same paste+preflight+`chezmoi init`); `OBFoundDen.tsx` (detected-Den card + new/returning identity `Radio` claim via `env.suggestClaims`, never auto-merges); `OBPickWorkspaces.tsx` (`SelectRow`-style Checkbox subscription checklist, default ALL, empty-selection warned). **App handoff (Part B)** reuses the built app Review & Apply surface (`ReviewApply.tsx`, role b) — the deliberate first materialization; a locally-existing File routes the built Conflict flow. App gains a `LandingChooser` (new Den vs connect existing). The subscription is realized in the main process via a templated `.chezmoiignore` (`subscription-ignore.ts`), not Figma.                                                                                                                                                                                                                                                       |
| [sync-states](./screens/sync-states.md) (1-12)                     | ◻ partial | Functional Sync-now polish only: the **Sync now** + **Commit changes** tooltips make the transport-not-apply / never-auto-Commit distinction transparent, and the "Last commit" callout reflects Auto-sync-pushed vs local. The full six-tone live `Banner` strip wired to live Sync state (Syncing/UpToDate/Incoming/Push/Offline/Error) is **issue 3-04**, not this slice; the `Tone=Incoming` strip already shipped in 1-09 (`IncomingBanner.tsx`).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| [signature-screen](./screens/signature-screen.md) (1-15)           | ◻ partial | OS Scope surface only: inspector **Scope chips** now show a File's effective OS set (Every OS / a narrowed set / out of this OS), and a new `ScopeEditor.tsx` toggles the OS chips (all-on = the universal Scope) → `den.setFileScope`, which CLAMPS the request under the inherited Folder/Workspace Scope (narrowable, never broadenable) and re-compiles the native `.chezmoiignore`; a scoped-out File renders **muted** via the 1-07 `ignored` mapping. The center-pane **Scope tab** stays a stub (the inspector editor is the v1 surface).                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| [secret-and-errors](./screens/secret-and-errors.md) (1-16, 2-03)   | ◻ partial | **Offline minimum + secret warn step (Step 1)**: `OfflineBanner.tsx` (the spec's `Banner Offline`, `cloud` glyph + muted tone — never destructive-red) renders the persistent "Offline — changes queued · Will sync when you reconnect" strip when this environment has a push **queued** offline (`den.pushPending`); already-fetched incoming still Applies (only push queues). **Secret `SecretWarning.tsx` (issue 2-03)**: the commit-time **warn step** — the renderer runs the PURE `secret-scanner` over the about-to-be-Committed set via `den.scanCommit` BEFORE Committing; on findings it shows the **amber** (never destructive-red) caution over the scrim-dimmed home, one detected card per finding (File mono + amber `SECRET` pill + kind·line + the **masked** value preview), with footer **Cancel** / **Commit anyway** — warn, never block (ADR 0001). The deliberate two-option Convert-vs-Commit choice + per-File "don't warn again" allowlist (Step 1 full) and the `SecretPicker` Step 2 PM picker are **issues 2-04/2-05**; the apply-error retry screen is **issue 3-08**; the full offline state-surface (titlebar glyph + inspector env row → "Offline") is **3-08**. |
| [settings](./screens/settings.md) (2-08)                           | ◻ partial | **Shell + Sync tab only**: `settings/SettingsShell.tsx` (shared Titlebar + 248px nav rail + content-swap, the OnboardingShell instance-swap pattern) driven by a one-list **extensible tab registry** `settings/tabs.tsx` (`SettingsTab` = id · label · lucide icon · `status` · `Content`); a later tab slice appends ONE entry, zero shell churn. All seven tabs declared to fix the rail SHAPE; only `live` ones are selectable — the other six render **inert/disabled placeholders** ("Soon" + honest empty state, never advertise unbuilt UI). **Sync tab** (`SyncTab.tsx`, first live tab): background-watching `Switch` · poll-cadence segmented control (Lively/Relaxed, shown only while polling on) · start-at-login `Switch` · "What Sync now does" ember note (push+fetch, never auto-apply — ADR 0006), all over the new env-local `sync-settings` store/`sync:*` IPC (ADR 0024, never synced). New `ui/switch.tsx` (base-ui, ember-on track). The other six tabs are issues 2-09/11/12/14/15/16.                                                                                                                                                                                     |

Functional-color discipline honored: amber = mine/Current, blue = theirs/Incoming, red = Conflict,
green = resolved, ember = the primary **Apply resolution** action only. The merge view is **read-only**
(`mergeConflictActionsType: 'none'`); every resolution routes through `ConflictModel.resolve(choice)`
(ADR 0008 invariant #1), never `@pierre/diffs`' own `resolveConflict()`.

The 1-12 automation slice itself (Auto-sync, the always-on `TrayPoller`, OS notification,
`AutomationPolicy`) is **behavior, not a specced screen**: its design rationale lives in
[ADR 0025](../adr/0025-tray-poller-detect-only-cheap-sha-compare.md) (TrayPoller detect-only +
cheap SHA-compare + adaptive cadence) and [ADR 0008](../adr/0008-invariant-ownership.md)
(`AutomationPolicy` gates levels by depending on the invariant owners). The native tray menu +
notification polish is issue 3-06/3-07.
