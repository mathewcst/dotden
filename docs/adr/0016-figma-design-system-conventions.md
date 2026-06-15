# Figma design-system conventions: native slots, variant-vs-variable, family naming, markdown-first docs

**Status:** accepted · 2026-06-14

The dotden Figma file is a single-app **hybrid** (component library + product screens in one file),
maintained by one dev + one designer. We follow Figma's official `figma-generate-library` standards by
default and deviate only where our scale or the AI-agent workflow justifies it (recorded each time).
Four cross-cutting component conventions govern how every future component is built — detail lives in
[`docs/design-system/`](../design-system/):

1. **Content holes are native slots; single icons stay `INSTANCE_SWAP`.** Figma shipped native slots in
   the editor, so AppShell `Left/Center/Right` and `OnboardingShell`/`ReturningMenu` content _should_ be
   slots; icon/avatar swaps (`Button` Lead/Trail, `Pill` Icon, …) stay `INSTANCE_SWAP` — that _is_ the
   right tool for picking one homogeneous sub-component.
   **⚠️ Correction (2026-06-14): native slots are NOT in the plugin API (v2.2.50)** — no `createSlot` /
   `'SLOT'` property type exists, so an agent can't script them; the shells stay `INSTANCE_SWAP` (which
   the policy notes was never wrong) and the slot conversion is an optional **manual UI** task. (See
   `figma-conventions.md` → Slots.)

2. **Variants for structure/state/semantic-tone; no color-variable property; modes reserved for theming
   we don't do.** Semantic tone (success/warning/error/…) is a `Tone` _variant_ axis binding different
   tokens — Figma can bind a variable only to a _variant_ property, so a raw color variable can't be
   exposed as a per-instance knob; and variable _modes_ are our (unused, dark-only) theming slot, not a
   tone mechanism. Cap variant sets at ~30; prefer booleans/slots over new axes. (See `components.md`.)

3. **Public components are PascalCase; `/` only groups genuine families into Assets-panel folders;
   different layouts are different components, never variants.** We keep `/` family folders — a
   first-class Figma _product_ feature — despite the library skill preferring flat names, because they
   aid picking panes/content when filling slots. `AppPane/*` (8) and `OBContent/*` (10) stay as
   _separate_ components in their folder, **not** collapsed into a `Pane=`/`Screen=` variant set
   (cramming unrelated layouts into one variant axis mis-uses variants). (See `components.md`.)

4. **Markdown (`docs/design-system/`) is the documentation source of truth.** It's written for agents:
   greppable, version-controlled, diff-able. We skip Figma per-component doc _frames_ (they'd duplicate
   and drift), keep a one-line `.description` per component set (Dev Mode + Assets tooltip), and skip
   `.documentationLinks` (the repo has no Figma-reachable public URL). Documentation is a
   Definition-of-Done gate, not an afterthought. (See `README.md`.)

## Consequences

The first wholesale application is the row consolidation (`SelectRow` + `ListRow`) and the page reorg,
applied in the 2026-06-14 conventions pass. Page/file organization
(the hybrid posture, the page taxonomy) is **not** in this ADR — it's reversible (moving a
component between pages doesn't break instances), so it lives in
[`docs/design-system/architecture.md`](../design-system/architecture.md) instead.
