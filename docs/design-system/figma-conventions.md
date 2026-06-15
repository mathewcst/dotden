# Figma conventions / gotchas

> Hard-won rules for editing the Figma file via the MCP plugin (and that shaped the
> components) — the single most-referenced doc when scripting. Part of the
> [design system](./README.md). One growing knowledge base; each rule has its own `###`
> heading so you can grep a symptom and land on it.

Hard-won rules for editing the Figma file (and that shaped the components):

## Structural standards (variants · sections · spacing)

The applied house style for how every component set, section, and gap is built. Audited + enforced
2026-06-14.

### Variant set (`COMPONENT_SET`) root = AutoLayout, **no fill**

The set root **must** be an auto-layout frame (`layoutMode` HORIZONTAL/VERTICAL — never `NONE`) so the
variants space themselves, and its `fills` **must be empty** (`[]`) — the variant frames carry their own
`card`/surface fill, the set wrapper is transparent. (A default white set fill is the recurring
white-fill gotcha below; it breaks the dark-only canvas.) Internal gap follows the spacing rule below.

### Section framing: no fill, dashed `scaffold/section-border`

Sections (the per-family containers on `02 · Components`) are **canvas furniture, not product UI**:
`fills = []` (no background), a **1px SOLID stroke bound to the `scaffold/section-border` variable**,
`dashPattern = [5, 5]`. Build flow: **(1)** create the section → **(2)** set the dashed `scaffold/section-border`
stroke → **(3)** create all elements inside → **(4)** size it to its contents. In the **UI** that step
is the section's _Resize to fit_ button; via the **plugin API** there's no `resizeToFit()` — size it
manually with `resizeWithoutConstraints(w, h)` after laying children out (see the SECTION gotcha below).
Scaffold tokens (`scaffold/section-border`, scope `STROKE_COLOR`) are **never exported to app CSS** —
they're excluded from the `dd/*` product-token rule ([ADR-0017](../adr/0017-tailwind-shadcn-mirrored-tokens.md)).

### Spacing: two-tier, **32 within / 64 between** (only)

Every gap is `32` **or** `64` — never an arbitrary value. **32px = within** a group (gaps between the
variants of one set, or related siblings); **64px = between** groups (distinct components, or section
sub-groups). Applies to auto-layout `itemSpacing` _and_ manual tile gaps inside a section. Both are on
the 4px scale ([radius-spacing-effects.md](./radius-spacing-effects.md)).

### Moving a `SECTION` (`.x`/`.y`) does NOT move its children — translate children too

A `SECTION`'s children store **absolute page coordinates** (unlike `FRAME`/auto-layout children, which
are relative). So setting `section.x`/`section.y` moves the **box only** — the children stay put and end
up **outside** the section. (Dragging a section in the _UI_ moves its children; the _plugin API_
positional setter does not.) Bit us during the M1 page reorg: we filled sections at one Y, then
re-stacked them by setting `.y` → every component drifted out of its section.

**To relocate a section + contents:** translate each child by the same delta **first**, then the section:

```js
const dx = targetX - s.x,
  dy = targetY - s.y
for (const k of s.children) {
  k.x += dx
  k.y += dy
} // children first
s.x += dx
s.y += dy // then the box
```

**To re-stack / lay out:** position the section, then position each child relative to the section's
_current_ `x`/`y`, then size the section to its children (it also **doesn't auto-resize** to appended
children — `resizeWithoutConstraints(w,h)`; there's no `resizeToFit()`). Always re-verify containment
(`child within [s.x, s.x+s.width]×[s.y, s.y+s.height]`) before trusting the result.

### Variable names can't contain `.` (fractional spacing uses `-`)

Figma variable names **cannot contain `.`** → fractional spacing uses `-` (`spacing/0-5`).

### `vectorPaths` accepts only `M L C Q Z` (no arcs)

`vectorPaths` accepts **only `M L C Q Z`** — no arcs (`A`), no `H/V/h/v/s` shorthand. Build circles
from `createEllipse`, not bezier paths.

### `resize()` on an auto-layout node forces that axis to FIXED

`resize()` on an auto-layout node **forces that axis to FIXED** — set `primaryAxisSizingMode='AUTO'`
(or `layoutSizing*='FILL'`) _after_ resize to restore hug/fill.

### White-fill audit (`createAutoLayout` / `createFrame` add a default opaque white fill)

⚠️ **`figma.createAutoLayout()` and `figma.createFrame()` add a default OPAQUE WHITE fill.** Every
layout container you create starts white. If a frame is meant to be transparent (rows, headers,
groups, action bars that sit on a parent's background) you **must** set `fills=[]` explicitly — it
is silent and easy to miss because tight-hugging children can hide the white until you look at the
padded gaps. This has bitten us more than once. **Mandatory audit before promoting/finishing any
built UI** — walk the subtree and clear any unintended white:

```js
root
  .findAll(
    (n) =>
      'fills' in n &&
      Array.isArray(n.fills) &&
      n.fills.some(
        (p) =>
          p.type === 'SOLID' &&
          p.visible !== false &&
          p.color.r > 0.9 &&
          p.color.g > 0.9 &&
          p.color.b > 0.9,
      ),
  )
  .forEach((n) => {
    n.fills = []
  }) // only on MAIN nodes; instances inherit
```

(Spacer frames are safe **only because** we set `fills=[]` on them — that's the same fix, applied
at creation. Make it a habit: the moment you create a layout frame that isn't a colored surface,
set `fills=[]` in the same breath.)

### Setting `layoutMode` resets sizing to HUG

Setting `layoutMode` resets sizing to HUG — for a fixed square (badges/icons), set sizing FIXED
_then_ `resize`.

### Spacers: `layoutGrow=1` + height `1` (never `resize()` after FILL)

**Spacers:** use a frame with `layoutGrow=1` and height `1` (never `resize()` after FILL, which
re-fixes the axis).

### `createInstance()` fails on a `COMPONENT_SET` (instance a variant child)

`createInstance()` fails on a `COMPONENT_SET` — instance a **variant child** component, then
`setProperties`.

### Component-property keys carry a `#id` suffix (only variant props are bare)

TEXT/BOOL/SWAP component-property keys carry a `#id` suffix — look them up in
`componentPropertyDefinitions`; only variant props use the bare name.

### Icons come from Nova (live `Lucide Icon / *` instances), not local components

Icons are the **one exception** to the build-it-local rule ([ADR-0018](../adr/0018-icons-are-lucide-nova-instances.md)):
drop `Lucide Icon / <PascalName>` instances from the _shadcn/ui kit (Nova)_ library (`Lucide Icon / Pen`
→ `<Pen/>` in `lucide-react`). 16px default. Nova is consumed for icon **geometry only** — never for
color (that would break the warm scheme — see [ADR-0017](../adr/0017-tailwind-shadcn-mirrored-tokens.md)).

### Recolor an icon instance via `strokes`/`fills` on its vector children

Recolor an icon instance by overriding `strokes`/`fills` on its vector/ellipse children — bind to a
`dd` token per the icon-color convention below. (For Nova Lucide instances this works the same: override
the instance's `strokes`.)

### Icon-color convention (three cases — match the source-of-truth home screen)

**Icon-color convention (consistency rule — match the source-of-truth home screen).** Three cases,
do not invent a fourth:

1. **Leading list/metadata icons** (file · monitor · git-commit · folder before a row label) stay
   **muted** `text/muted 22:13`, even when the row text is bright. They are decoration, not signal.
2. **Button icons match the button's label color** — e.g. the _Review & Apply_ download icon is
   light `22:3` like its label; on an **ember** button the icon is the dark on-ember ink `17:2`
   like the label. Never leave a button icon muted-gray while the label is bright/dark — that
   gray-icon/colored-text split was the exact defect in the first conflict build.
3. **Semantic status icons take the semantic color** — success check = **green** (`dd/green/500 18:10`),
   conflict `alert-triangle` = **red** `18:15`, etc., matching the adjacent status text. A
   lucide-style `alert-triangle` is **stroke-only**: set its vector **stroke** to the semantic
   color and **clear its fill** (`fills=[]`) — a colored _fill_ turns it into a solid blob with a
   mismatched outline (another defect we hit).

### App-pane background tokens (`surface/base 22:2` vs `surface/raised 23:2`)

**App-pane background tokens (don't guess — match the original three-pane).** Window/center surface
= `surface/base 22:2` ({0.063,0.055,0.043}); the **side panes** (left workspaces, right inspector,
and any left/right flow pane) = `surface/raised 23:2` ({0.086,0.075,0.059}). The center diff/merge
pane = `22:2` (same as the window, reads flush). **`dd/ink/990 17:2` is NOT a pane background** — it is
warmer/orange-tinted and reads as "colors way off" against the neutral panes (the conflict-flow
panes were wrongly built on it and had to be rebound).

### `clone()` of a token-bound frame drops variable resolution → black fallback

**`clone()` of a raw, token-bound frame silently drops variable resolution** — the cloned node
keeps the `boundVariables` alias but renders the paint's _fallback literal_ (which was `{0,0,0}` =
black). This is the single biggest reason we stopped duplicating frames (see
[architecture](./architecture.md)). Two defenses:
(1) build repeatable UI as **components/instances** (instances keep bindings); (2) when you must
set a bound paint, also pass the **real literal color**, not `{0,0,0}` — belt-and-suspenders.

### A variable-bound paint's `opacity` must be set in the assigned object (a later spread drops it)

For a **tinted** fill (e.g. the `ListRow` **Error** destructive-bg at ~9%), set `opacity` **in the
paint object you build/bind**, not by spreading the returned paint afterward —
`node.fills = [{ ...boundPaint, opacity: 0.09 }]` once rendered at **full strength** (the spread lost
the opacity). Correct pattern:

```js
let p = { type: 'SOLID', color: { r: 0.9, g: 0.3, b: 0.25 }, opacity: 0.09 }
p = figma.variables.setBoundVariableForPaint(p, 'color', destructiveVar) // keeps opacity + adds binding
node.fills = [p]
```

### Match the existing onboarding "Option" radio pattern (full ember border, not a left rail)

Selectable radio cards (now all **`SelectRow`** `State=Selected` — was `RadioRow`/`PMOption`/the
returning "Option" rows pre-M4) signal selection with a **full ember border** (`strokeWeight 1.5`, bound to
`primary 22:8`, all four sides) + an ember-checked `Radio` on a `card` fill — **not** a left rail
(that was an early `CommitRow`-style divergence, since reconciled). Reuse this for any single-choice
group (Batch F's Sync-&-automation ladder).

### Multi-variant sets: build one master, clone-per-variant, then `combineAsVariants`

**Multi-variant sets — build one master, clone-per-variant, then `combineAsVariants`.** Construct a
single master variant component with _all_ its component properties (`addComponentProperty`) and
child `componentPropertyReferences` wired, then `master.clone()` once per variant and rebind only the
token-specific colors (and set any nested instance's variant via `setProperties`), then combine. The
clone copies the property keys, so the set exposes **one** unified property set (verified on
`Pill`/`DiffLine`/`DiffLineSplit`/`ListRow` — each shows a single `Label`/`Kind`/… not N copies).
This sidesteps the "same-named property added per-variant doesn't merge" trap. Pairs with the clone
caveat above: rebind each clone's tone colors with real literals so it never renders the black
fallback.

### Exposed (non-variant) props can be added straight to a live `COMPONENT_SET`

**Exposed (non-variant) props CAN be added straight to an existing `COMPONENT_SET`.** Despite the
"add props before combining" guidance, `set.addComponentProperty('HasLead','BOOLEAN',false)` on an
already-combined set returns **one shared key** that every variant's child node can reference — this
is how `Button` got `HasLead`/`Lead`/`HasTrail`/`Trail` across all 18 variants in one shot (each
variant's own lead/trail instance just refs the shared key). Confirmed the file's pre-existing
`Label#39:0` works the same way (all variants share that one key).

### Adding a variant axis to a live set (default-map the existing variants)

**Adding a variant axis to a _live_ set is safe if you default-map the existing variants.** To add
`Layout` to `MergeHunk` (`State=Conflict|Resolved` → `State × Layout`), rename the existing children
to the new default (`State=Conflict` → `State=Conflict, Layout=Inline`) **then** clone the new-value
variants. Existing on-screen instances migrate to the (unchanged) default variant automatically — the
two conflict screens stayed pixel-identical on `Layout=Inline`. Verify by re-screenshotting the
screens after.

### `instance.swapComponent()` re-points main; re-apply overrides after

**`instance.swapComponent(comp)` re-points an instance's main; re-apply overrides after.** Used to
retarget a row's leading icon per state (file→alert-triangle→check→arrow-down). The swap drops
prior child overrides, so recolor the new icon's strokes (and clear any fill for stroke-only glyphs)
_after_ swapping, then `resize` back to the slot size.

**Swap carry-over rules (learned mass-swapping rows in M4):**

- **Overrides map by property `key` (`Name#id`) — _including the name_.** If the target component
  renamed a prop but kept the id (e.g. `Path#173:0`→`Title#173:0`), the source instance's `Path#173:0`
  value does **not** carry → re-set it explicitly after the swap. (Same-id, same-name props _do_ carry.)
- **Instance-level overrides don't follow a component-definition swap.** If a screen pinned a nested
  instance (a per-screen variant/text override), swapping that instance _inside its main component_
  leaves the pinned reflection on the old component. Find these by scanning each screen page directly
  (`findAllWithCriteria` after `setCurrentPageAsync`) and swap them in place.
- **`component.instances` misses instances on unloaded pages** — never trust a 0-count for "safe to
  delete" without a per-page scan first (`loadAllPagesAsync` is unavailable in `use_figma`).
- **Component SETS with auto-layout ignore manual variant `x`/`y`** — to restack variants, set the set's
  `layoutMode` (e.g. `'VERTICAL'` + `itemSpacing`), don't move the children.
- **A SECTION's children use section-relative coordinates** (not absolute) — `child.x=480` on a section
  at abs `15` lands at abs `495`; place via relative coords within `0..section.width/height`.

### `✓` (U+2713) isn't in Geist — draw checks as a `createVector`

**`✓` (U+2713) is not in the Geist family** → renders as nothing. Draw checks as a small
`createVector` (`M 0 4 L 3.5 7.5 L 9 1`, round cap/join) and **do not `resize()` it** (resize
scales the path bbox and distorts it) — let it auto-size and center in an auto-layout parent.

### `createComponentFromNode()` promotes a frame to a `COMPONENT` in place

`figma.createComponentFromNode(node)` converts a built frame into a `COMPONENT` in place — the
fast way to promote a finished layout to a component without rebuilding it.

### Slots: native slots are **UI-only** — NOT in the plugin API (v2.2.50); keep `INSTANCE_SWAP`

**⚠️ Correction (2026-06-14): the plugin API cannot create or script native slots.** The entire
`plugin-api-standalone.d.ts` (v2.2.50) has **no** `createSlot` / `SlotNode` / `'SLOT'` property type —
`ComponentPropertyType` is only `BOOLEAN | TEXT | INSTANCE_SWAP | VARIANT`, and `addComponentProperty`
supports only those four. Native slots exist in the **Figma editor UI** but are unreachable from
`use_figma`. So an agent **cannot** convert content holes to slots — that's a manual UI task.
(Supersedes the earlier, incorrect claim that slots were plugin-scriptable; see
[ADR-0016](../adr/0016-figma-design-system-conventions.md).)

**Policy — what an agent builds:**

- Content holes that pick **one component** (`AppShell` `Left/Center/Right` panes, `OnboardingShell` /
  `ReturningMenu` content) stay **`INSTANCE_SWAP`** — it works, it's pickable, and the ADR notes swap
  "wasn't wrong" here. Converting them to native slots is an **optional manual UI** refinement, not an
  agent task.
- `Dialog` / `Banner` / `Toast` bodies are **`TEXT` props** (+ baked per-tone icons) — investigated
  2026-06-14, they are **not** content holes, so they need no slot. Leave as-is.
- **`INSTANCE_SWAP` only** for picking one homogeneous sub-component: icon glyphs (`Button` Lead/Trail,
  `Pill` Icon, `IconButton`, `SearchField` leading) and avatars. These STAY swap.

### `INSTANCE_SWAP` is for **homogeneous-sized** content only — heterogeneous trailing needs VARIANTS (learned building `SettingsRow`, 2026-06-15)

A swap slot **keeps its baked size across the swap** — swapping does NOT resize the instance to the new
component's natural size. And you **cannot `resize()` an instance's sub-children** (the call is silently
ignored; instance descendants are locked to the main). So a single `INSTANCE_SWAP` trailing that has to
host a 16px icon _and_ a 33px button _and_ a pill will clip/squash whichever doesn't match the slot it
was born at (a 16px-icon slot swapped to a button renders the button at 16px → "Chan" not "Change").
**The fix is a variant axis** — bake each trailing shape into its own variant (`SettingsRow`'s
`Trail = None|Switch|Pill|Value|Select|Link|PillButton|PillMenu`) and override only text/state/tone via
**nested-instance** overrides (those DO work: `nested.setProperties({...})`, or set `characters` on a
nested TEXT). Reserve `INSTANCE_SWAP` for genuinely same-size content (icon glyphs, avatars — the policy
above). Width-only hug of a swapped control via `primaryAxisSizingMode='AUTO'` works; height does not.

### A cloned Lucide icon can drop out of auto-layout flow → build trailing icons with `mainComponent.createInstance()` (not `clone()`)

When assembling a trailing cluster, `someIconInstance.clone()` sometimes yields a child that the parent
auto-layout **doesn't lay out** — it sits absolute-ish (e.g. centered at x8,y7) so the frame never hugs
it and defaults to **100×100**, or two children **overlap at x=0** (chevron hidden behind the value).
Symptom: a trail frame reporting `layoutMode='HORIZONTAL'` yet `width` = just one child, or a row that
inexplicably renders 128px tall. **Fix:** create the icon from its main component
(`iconInstance.mainComponent.createInstance()`), append, then `resize(16,16)` + recolor — fresh instances
flow correctly. (Bit us on `SettingsRow`'s Link + Select variants; rebuilding the trail with
`createInstance` fixed both.)

### An empty (or flow-less) auto-layout frame defaults to **100×100**

`figma.createAutoLayout()` with **no flow children** — or one whose only child fell out of flow (see
above) — sizes to Figma's **100×100** default instead of hugging to 0/content. A `None`-trailing row
left with an empty `trail` frame becomes 128px tall (100 + 14/14 pad). Either **don't add** the empty
frame, or ensure it has a real flow child. Also: `comp.resize(w, comp.height)` **freezes** the height at
whatever it is _right then_ (resize forces the axis FIXED) — if the frame is still mis-sized at 100, you
pin the bug in; resize width only, or re-assert `counterAxisSizingMode='AUTO'` after.

### A nested instance's variant prop is settable without exposing it

A **nested instance's variant prop is settable without exposing it** — reach into the parent
instance (`findOne` by name), then `nestedInstance.setProperties({ Variant: 'x' })`.

### `createComponentFromNode` collapses a `FILL`-width pane to 1px

**`createComponentFromNode` collapses a `FILL`-width pane to width 1.** Promoting a frame whose
width was `layoutSizingHorizontal='FILL'` (it filled an auto-layout parent) makes it standalone, so
FILL has nothing to fill → it (and its FILL children) collapse to 1px. Fix: after promotion,
`resize()` the component back to its intended fixed width (its FILL children re-expand). Seen when
extracting the center `AppPane/Diff` (716→1). Fixed-width and HUG panes promote fine.

### Don't set page `backgrounds` (leave Figma's theme-adaptive default)

**Do NOT set page `backgrounds`.** Leave Figma's default — it renders theme-adaptively (warm-dark in
a dark-themed editor, the "brown" canvas). Setting an explicit `SOLID` background overrides that for
everyone and fights the dark-only design. The default value is `{0.898,0.898,0.898}`; restore it if
overridden. (Dark UI looking wrong on canvas is almost always a stray white **fill** on a frame —
see the white-fill audit above — not the page background.)

### `detachInstance()` PRESERVES variable bindings (unlike `clone()`) — use it to fork a pane

`clone()` drops variable resolution → black (see above). **`detachInstance()` does NOT** — it returns
a plain frame with every fill/stroke binding intact, and **nested instances stay instances** (only the
top instance detaches). This is the cheap way to **fork an existing pane into a variant** without
rebinding everything: instantiate the source pane → `detachInstance()` → surgically edit (toggle a
nested `Tab`'s variant, remove/relabel controls, restack children) → `createComponentFromNode()`.
Used to build **`AppPane/History`** from `AppPane/Diff` (reused all its borders/cards/diff-line
bindings for free). Pair with the nested-variant-prop and `swapComponent` gotchas above.

### Extracting an inline frame into a reusable component, then migrating its uses (learned building `Titlebar`, Batch F)

When a chunk of chrome (the app titlebar) has been copy-pasted/detached across many screens, promote it
to a component **after the fact** and back-fill the instances:

1. **Extract with bindings intact via detach, not clone.** The titlebar lived as a frame _inside_ the
   `AppShell` component. To get a binding-intact copy: instantiate `AppShell` → `detachInstance()` →
   pull the titlebar frame out to the page → `createComponentFromNode()`. (`clone()` would drop the
   variable bindings; detach preserves them — same rule as the pane-fork recipe below.)
2. **Expose the per-screen variation as props** so future overrides are clean: the titlebar got a
   `SyncStatus` TEXT prop + a `SyncIcon` INSTANCE_SWAP (ArrowDownUp→Cloud for offline), replacing
   deep edits of the nested sync-status text/icon.
3. **Point the host component at an instance** (`AppShell`'s inline frame → a `Titlebar` instance at
   index 0, `FILL` width). **This orphans any instance-level overrides that targeted the old frame's
   descendants** — every `AppShell` instance that had relabeled its sync-status text reverts to the new
   default. **Re-apply them via the new prop** (`titlebarInstance.setProperties({ "SyncStatus#…": "1 to
push" })`) — only the non-default ones need touching.
4. **Loose/detached copies don't auto-update — migrate each by hand.** Screens built by detaching the
   host (sync-states, offline, apply-failed) hold their _own_ titlebar frames; `component.instances`
   won't find them. Scan each screen page, replace the frame with a fresh `Titlebar` instance at the
   same index/`FILL`, and re-set its `SyncStatus`/`SyncIcon`. (Bonus: those detached copies still
   carried the pre-M8 local `Icon/*` glyphs — swapping to instances fixed that drift for free.)

### Resizable list/detail (master-detail) pane recipe

The **History** pane's layout is the reusable master-detail pattern (Settings/Batch F should reuse it):
a VERTICAL `content` (pad/gap **0** so zones go edge-to-edge) with three children —

1. **`list-region`** — `layoutGrow=1` + `clipsContent=true` ⇒ a scrollable column; give it enough
   items to actually overflow (don't fake a scrollbar over content that fits) + a faint absolute
   scrollbar thumb (rounded rect, muted @ ~0.5, `layoutPositioning='ABSOLUTE'`).
2. **`resize-handle`** — a thin (~16px) HORIZONTAL frame, both axes centered, `card` fill + a 1px
   `strokeTopWeight` border + a centered grip pill (rounded rect ~36×5, muted @ ~0.6). This is the
   **shadcn `ResizablePanelGroup` handle** stand-in; signals the split is draggable.
3. **`preview-panel`** — fixed height, on a **raised `card` surface** (distinct from the list's base
   `background`), footer pinned via a `layoutGrow=1` spacer above it.

Affordance baseline this enforces (the "legible to non-devs too" rule — see
[components.md](./components.md) `CommitRow`): **actions are filled** (never text-styled), **selection
is loud** (ember rail + tint), **two distinct surfaces** signal scroll-vs-fixed, **disclosure
chevrons** mark interactive rows, and a plain-language **reassurance** line de-risks scary actions.

### SF Pro renders at width 0 → use Inter as the macOS system-font stand-in

`SF Pro` (and `SF Pro Rounded`) **appear in `figma.listAvailableFontsAsync()`** and
`loadFontAsync({family:'SF Pro', style:'Regular'})` **succeeds without error** — but every glyph then
measures **width 0** (text invisible; height from line-height is correct, width collapses to 0). The
font is listed but not actually usable in this environment. Confirmed by measuring the same string:
`SF Pro` → `w:0`, `Inter` → `w:60`, `Geist` → `w:58`. **Use `Inter`** wherever native macOS chrome
calls for the system font (Batch G's `TrayMenu`/`OSNotification`) — Inter was designed as an SF
alternative and is visually near-identical at UI sizes. (Note `Inter`'s semibold style is `"Semi Bold"`
**with a space**, unlike `SF Pro`'s `"Semibold"`.) Symptom to grep for: text nodes with non-empty
`characters`, a loaded font, `textAutoResize='WIDTH_AND_HEIGHT'`, yet `width === 0` even after a
re-measure — switch the family to Inter.

### Native OS-chrome is the one documented exception to the dd/\* token rule

Batch G's `TrayMenu` + `OSNotification` (`CONTEXT.md` §109 tray poller) are **faithful macOS mocks**,
not dotden-themed UI — the user chose native-per-OS chrome over a branded popover. They therefore bind
**no `dd/*` variables**; they use **literal macOS system colors** (menu `#1F1F22`, text `#F6F6F7`,
secondary `#9E9EA6`, system blue `#0A84FF`, green `#30D158`, etc.). This is the **single allowed
exception** to "bind every visual property to a `dd/*` token" — justified because the surface
replicates the _host OS_, not the design system. Consequences for QA:

- The **token-binding audit must exclude** the `Platform chrome — macOS` section (`571:1299`, page 02)
  and the `Tray & notification (macOS)` screen section (`563:7125`, page 03) — unbound paints there are
  correct, not defects.
- The **white-fill audit still passes**: dark-mode native chrome is mostly dark, and the only
  near-white SOLID fills are intentional _glyphs_ (the menubar tray dot, the notification app-icon dot)
  — `type==='ELLIPSE'`, never an opaque-white _container/frame_ fill. Each set's `.description` states
  the exception so it's discoverable in Dev Mode.
