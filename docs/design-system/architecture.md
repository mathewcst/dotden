# Architecture & page organization

> The standing no-duplication rule (every repeatable element is a reusable component) and
> the Figma page taxonomy that mirrors a React repo's `components/` vs `screens/` split.
> Part of the [design system](./README.md).

## The no-duplication rule

**Standing rule (applies to every flow):** any repeatable element is a **reusable component** with
proper state/variants and slots — never a duplicated raw frame that is hand-edited. This mirrors how
the app is built in React (components with props/variants/children) and keeps Figma 1:1 with code.

**The one exception is icons** — consumed as live `Lucide Icon / *` instances from the Nova library, not
built locally (geometry has no brand value; recolored locally). See
[ADR-0018](../adr/0018-icons-are-lucide-nova-instances.md).

We learned this the hard way: the first onboarding screens were built by `clone()`-ing the whole
window and re-styling each copy. That (a) duplicated dozens of raw nodes per screen, and (b) tripped
the clone-detach bug (completed step dots rendered black — see
[figma-conventions.md](./figma-conventions.md)). Refactoring to components fixed both.

The onboarding flow is the canonical application of this rule — its three-component assembly
(`OnboardingMenu` / `OnboardingShell` / `OBContent/*`) and built screens live in
[screens/onboarding.md](./screens/onboarding.md).

## File & page organization (components vs screens)

Components and screens live on **separate pages**, mirroring a React repo's `components/` vs
`screens/` split. Definitions are never mixed into a screen canvas.

### Standards posture (decided 2026-06-14)

This is a **single-app "master design file"** (one app, one dev + one designer), not a multi-product
library — so we adopt Figma's official library _thinking_ (atomic build order, Foundations-before-
Components, separator pages, native slots) but **not** its full pure-library page model. Figma's
`figma-generate-library` standard has no concept of "Screens"; ours is a **hybrid file** holding both
the component library and the product screens. Keeping screens in the same file — separate from
components, never mixed onto a component canvas — is a deliberate, documented deviation justified by
single-file convenience at our scale. **Rule of thumb: follow the Figma library standard by default;
deviate only with a reason recorded here.** (Not an ADR — page/file org is reversible: moving a
`COMPONENT`/`COMPONENT_SET` between pages doesn't break instances.)

**Page taxonomy (decided 2026-06-14; ✅ live as of 2026-06-14 — see [inventory.md](./inventory.md) for IDs):**

`---` rows are **divider pages** (empty pages named `---` render as separators in Figma's page list).

```
00 · Cover            file front-door — purpose + link to docs/design-system/ (Figma-standard)
01 · Foundations      tokens · type · effects · specimen
---
02 · Components       ONE page, sectioned by family: Primitives · Rows & Cells · Diff ·
                      Overlays · App Scaffold (AppShell + panes) · Onboarding · Returning
---
03 · Screens — App
04 · Screens — Onboarding
05 · Screens — Returning
```

Rules going forward:

- **All components live on `02 · Components`**, grouped by **Section** per family — never on a screen
  page, never split per-flow. (Single-app scale → one sectioned page beats page-per-component; Figma's
  dynamic page-loading keeps it light.)
- **Each screen flow gets its own `Screens — <Flow>` page** — the per-flow split is kept for the
  dynamic-page-load perf win (only the active page materializes in memory).
- We **skip** Figma's "Getting Started" page (redundant with [README.md](./README.md); the Cover page
  links there instead).

> **Migrated 2026-06-14 (M1).** The old 7-page layout (`02/03/06 Components — App/Onboarding/Returning`
>
> - scattered screen numbering) was merged into the taxonomy above: the `Components — App` page was
>   reused as the single `02 · Components` (7 family Sections added), the 17 Onboarding/Returning sets
>   moved in, the two emptied pages deleted, and Screens renumbered. The home screen was verified
>   visually unbroken after the moves (instances are ID-referenced).

**Sections** (`figma.createSection()`, creatable via MCP) group nodes _within_ a page — distinct
from divider pages. Use one **Section per sub-flow** on a Screens page so a single page can hold a
whole flow yet stay scannable (e.g. `Screens — Onboarding` has a **First environment** section
around its 7 screens; `Screens — App` will get one section per Phase-5 flow). **Two section gotchas**
(both in [figma-conventions.md](./figma-conventions.md)): (1) a section does **not** auto-resize to
appended children and keeps their absolute coords — fit it manually (`resizeWithoutConstraints(w,h)`;
no `resizeToFit()`); (2) **moving a section (`.x`/`.y`) does NOT move its children** — translate every
child by the same delta first, then the box, or they fall outside. Both bit the M1 reorg.

**Why this layout (researched, not guessed):**

- _Separate components from screens_ — universal best practice; keeps screen pages instance-only.
- _Split screens per-flow rather than one mega-page_ — Figma uses **dynamic page loading**: only the
  active page materializes in memory (Figma measured ~70% fewer in-memory nodes, ~33% faster slow
  loads). A single "all screens" page is the heavy thing to avoid; the overview you'd want from it is
  better served by a Flow Map. Refs: Figma "Speeding up file load times", thedesignsystem.guide
  "What performs best".
- _Group components by flow, not one-component-per-page_ — one-per-page is for large multi-product
  **library** files; at single-app scale it's page-explosion. Sectioned per-flow pages are the
  pragmatic middle.

Moving a `COMPONENT`/`COMPONENT_SET` to another page **does not break its instances** — instances
reference the main component by ID regardless of page. That is what made this reorg safe.
