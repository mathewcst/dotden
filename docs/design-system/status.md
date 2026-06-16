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

| Screen spec                                                | Status   | Component(s)                                                                                                                                                                                                       |
| ---------------------------------------------------------- | -------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| [conflict-resolver](./screens/conflict-resolver.md) (1-11) | ✅ built | `ConflictResolver.tsx` — ConflictFiles list · `@pierre/diffs` `UnresolvedFile` merge view (read-only) · Keep mine / Take theirs / Open both · `n/m` resolve progress · Apply resolution (ember when ready) · Abort |

Functional-color discipline honored: amber = mine/Current, blue = theirs/Incoming, red = Conflict,
green = resolved, ember = the primary **Apply resolution** action only. The merge view is **read-only**
(`mergeConflictActionsType: 'none'`); every resolution routes through `ConflictModel.resolve(choice)`
(ADR 0008 invariant #1), never `@pierre/diffs`' own `resolveConflict()`.
