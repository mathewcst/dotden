# Returning environment (second-environment) flow

> The "second environment" journey — a setup wizard (reuses the onboarding shell) that hands
> off to the app's Apply surface (reuses `AppShell` + panes). Part of the
> [design system](../README.md).

The "second environment" journey from [scope-v1](../../scope-v1.md) (**Onboarding & discovery**; the auth/repo floor is in [ADR 0020](../../adr/0020-provider-agnostic-pure-git-floor-v1-lean-auth.md)): **connect the repo
(paste the same Remote URL → `git ls-remote` preflight → clone) → detect the existing Den → pick which
Workspaces this environment subscribes to → review & Apply the incoming Files**. The initial
materialization is always a _reviewed_ Apply; a File that already exists locally routes through the
built **Conflict/Resolve** flow ([conflict resolver](./conflict-resolver.md)).

> **V1-Lean update (ADR 0020):** the old **device-flow "Sign in" / "Welcome back"** step is replaced by
> the same provider-agnostic **Connect** (paste URL + preflight) screen the [onboarding flow](./onboarding.md)
> uses — dotden holds no token and signs in to nothing. First and second environment now **share the
> identical paste+preflight seam**; the flows are distinguished _after clone_ by repo content
> (empty → first-run Discover; has-Den → this returning flow). The detected-Den **claim** choice
> (new vs returning _identity_) is unchanged and still asked on `OBContent/FoundDen`. The original
> `OBContent/SignIn` is **kept** as the deferred-convenience-layer reference, not deleted.

It is a **hybrid**: a setup **wizard** (reuses the onboarding shell pattern and global titlebar) hands off to the real app's
**Apply surface** (reuses `AppShell` + panes). Pages, per the
[per-flow pair rule](../architecture.md):
`06 · Components — Returning` · `07 · Screens — Returning`.

**Wizard (Part A — built).** Three setup screens in a `Second environment` SECTION on page 07, using
the same `WindowTitleBar` chrome and left-rail/content-shell pattern as onboarding:

- **`ReturningMenu`** SET — `Step=1|2|3` rail (**Connect** · Find your Den · Choose Workspaces ·
  Review & Apply). _(Rail step 1 relabeled Sign in → Connect for V1-Lean.)_ The 4th rail item (Review &
  Apply) stays _upcoming_ in every variant — it is the handoff to the app (that step has no shell). Same
  done/current/upcoming recipe as `OnboardingMenu`.
- **`OBContent/ConnectURL`** _(V1-Lean — reused from [onboarding](./onboarding.md); "Welcome back" copy
  variant, paste same Remote URL + preflight, same 4 states)_ · **`OBContent/FoundDen`** (detected-repo
  card + _new/returning_ **claim** choice via `Radio` + name-this-environment `Input`) ·
  **`OBContent/PickWorkspaces`** (Workspace-subscription checklist, default all → Review & Apply).
  _(`OBContent/SignIn` — the original device-flow "Welcome back" — is retained for the convenience
  layer, not deleted.)_
- **`SelectRow`** _(was `WorkspaceRow` pre-M4 — folded in 2026-06-14)_ — the workspace checklist row:
  `Lead` swapped to a `Checkbox` (Checked/Unchecked per instance) + `Title`/`Subtitle` (= Name/Meta),
  neutral border (selection conveyed by the checkbox, not ember).

Each screen = one returning-shell instance: swap `Content#85:0` to the `OBContent`, and
**`swapComponent` the nested `Menu` instance to the matching `ReturningMenu` variant**. The shell
bakes the rail/content layout; swapping the nested instance per-screen overrides it and keeps the slot's
360×680 FILL — **no duplicated titlebar built**. (Confirms
[figma-conventions.md](../figma-conventions.md): a nested instance's main is swappable
without exposing it, and the override persists.)

**Apply (Part B — built).** Two `AppShell` instances in a `Returning · Review & Apply` SECTION on
`05 · Screens — App` (backdrop = dd/ink/850, matching the home/conflict screens):

- **Review & Apply** — Left swapped to `AppPane/ConflictFiles` (apply list, grouped CONFLICTS /
  APPLIES CLEANLY), Center `AppPane/Diff`, Right `AppPane/Inspector`. Instance-text overrides reframe
  it as the first materialization — "73 incoming · from you/dotden · first sync"; the **Diff is
  relabeled commit→apply** (StatusTag→Incoming, "Apply"/"Skip", "Incoming changes"); a conflict
  (`~/.gitconfig`) routes to the built Resolve flow ([conflict resolver](./conflict-resolver.md)).
- **Applied · in sync** — default home AppShell with the inspector callout **flipped to a success
  state** (arrow-down `swapComponent`→check + green stroke, "Up to date · 73 files applied ·
  Auto-sync on · Sync now"), Diff → "Just applied" (StatusTag green, "Up to date" ghost), titlebar
  "Synced just now".

Both done with **instance overrides + nested `swapComponent`/`setProperties`** — no new app
components.

**Polish pass (post-build):**

- **Section placement fix.** The `Returning · Review & Apply` SECTION rendered empty: its two
  backdrop frames had drifted to a section-relative `y≈2240` (≈2240px below the box). Re-anchored to
  the `(48, 88)` / `(1560, 88)` convention the Conflict-resolver section uses, and tidied the section
  to `x=-48`, `3072×1072` so all three App-page sections line up.
- **Pristine in-sync tree.** Screen 5's left tree carried living-app decorations (M/A/`↓`/`!` git +
  remote glyphs, plus Personal "12" / Work "8" change-counts) that contradict "in sync". Hidden via
  **instance-level `visible=false` overrides** on the nested glyph/count text nodes — affects screen
  5 only; the home/conflict screens keep their living state. Kept the `.zshrc` selection (matches the
  center diff) and the `this-mac ●` synced footer.
- **Explicit applied confirmation.** A `Toast` (`Tone=Success`, [components](../components.md)) overlays the bottom-center of the
  window — "Applied 73 files · Auto-sync is on · this-mac up to date", dismiss-only. Added as an
  **`ABSOLUTE`-positioned child** of the (VERTICAL auto-layout) backdrop frame so it floats over the
  diff instead of joining the layout flow.

**Conventions reinforced / lessons:**

- **Controls are library instances** (`Button`/`Input`/`Checkbox`/`Radio`), _not_ raw frames. The
  first-run `OBContent/*` predate componentization enforcement and still use raw button frames; the
  returning content does it the enforced way ([components](../components.md) /
  [architecture](../architecture.md)). This was the explicit correction for this flow.
- **Typography matched the onboarding's raw settings** for side-by-side consistency: title Geist
  SemiBold 28/34, intro body Geist Regular **14/22** (not in the [type ramp](../typography.md)), eyebrow Geist Mono Medium
  11 +0.8 (literal-uppercase, case ORIGINAL), tagline 12/18. The 14 text styles exist but onboarding
  never applied them (`textStyleId` null) — so raw matches the neighbours.
- **Menu variants built fresh-per-variant then `combineAsVariants`** (not `clone()`), sidestepping
  the clone-detach black-fallback bug ([figma-conventions.md](../figma-conventions.md) /
  [architecture](../architecture.md)).
- **Section fill matches onboarding's** raw `{0.163,0.146,0.121}`; sections don't auto-fit → sized +
  positioned manually before appending children ([architecture](../architecture.md)).
- White-fill + unresolved-binding audits pass clean on pages 06 + 07 and the new App-page section.
