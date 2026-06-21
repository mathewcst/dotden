# 0037 — Automation ladder: transport-only (Manual / Auto-sync), Auto-sync default

> Status: accepted. Revises the automation-levels section of
> [ADR 0006](./0006-sync-model-transport-not-commit.md) and the ladder framing of
> [ADR 0008](./0008-invariant-ownership.md). Sync-as-transport (ADR 0006's core) is unchanged.

**Decision:** The risk-graded automation ladder collapses from four levels to **two**, and automation is
redefined as **transport-only**:

| Level                     | What becomes automatic                                                                 |
| ------------------------- | -------------------------------------------------------------------------------------- |
| **Manual**                | Nothing automatic. Background poller still **fetches to notify** ("N incoming").        |
| **Auto-sync** _(default)_ | Auto-**push** your Commits + auto-**fetch & notify** incoming. **Apply stays manual.**  |

**YOLO mode** and **Auto-apply** ("Apply automatically") are **removed**. The new invariant is one line:

> **Automation only ever moves data through git (push / fetch — reversible, touches no live file).
> Writing your working tree is always a deliberate human Apply.**

**Auto-sync is the default**, pre-selected at onboarding; the user may **downgrade to Manual** at onboarding
or in Settings. This reverses ADR 0006's "default is fully manual" + "riskier levels never enabled by
default" — those rules existed *because* the ladder held dangerous rungs. With the dangerous rungs gone, the
safe transport-only rung is the sensible default.

## Why (cutting YOLO + Auto-apply)

- **"Clean" means *no git conflict*, not *safe*.** A change can merge cleanly and still break a live shell or
  editor. Auto-sync only moves data through git (reversible); Auto-apply mutated the **live working tree** at a
  poll-interval moment the user didn't choose — the exact "config sync isn't cloud-drive sync" hazard
  [ADR 0006](./0006-sync-model-transport-not-commit.md) was written to avoid.
- **The exceptions were the tell.** Auto-apply already carved out conflicts, incoming deletions, *and* the
  uncommitted-edit guard — three "stop and ask the human" gates. When the safe version of a feature is mostly
  exceptions, the honest version is: applying should ask first.
- **YOLO was the one genuinely dangerous composition.** [ADR 0008](./0008-invariant-ownership.md) named the
  "YOLO auto-commit-before-merge path" as the runtime hazard its invariant types exist to tame. Dotfiles are
  written constantly by tools (editors/shells dumping state); a file-watcher auto-Commit would spew junk
  commits and risk capturing transient/secret-ish state — and it fights chezmoi's deliberately commit-gated
  grain ([ADR 0003](./0003-faithful-chezmoi-wrapper.md)). Removing YOLO **shrinks the invariant surface**.
- **Asymmetric risk, low marginal value.** Auto-pushing your own Commits is reversible and touches no live
  file; auto-committing junk pollutes the shared Den history for **every** environment. The convenience saved
  was one deliberate Apply click — the click where you pick the moment (apply may need a shell reload) and
  glance at what's landing. dotden is a desktop GUI with a human present; headless/fleet auto-apply is out of
  scope.

## Consequences

- **ADR 0008** stays valid: its four invariant types remain the owners. The "YOLO auto-commit-before-merge"
  event path no longer exists, so that dangerous composition is gone rather than guarded; `AutomationPolicy`
  now gates only Manual / Auto-sync.
- **Onboarding** gains an automation pre-select (Auto-sync default, swappable to Manual); **Settings** exposes
  the same toggle. Specs: onboarding in Journey 01, behavior in
  [`docs/user-flow/journeys/daily-use/automation-ladder.md`](../user-flow/journeys/daily-use/automation-ladder.md).
- **Apply is always the manual operation surface** (the 02a Review & Apply flow) — there is no automatic apply
  path to design, test, or guard.
