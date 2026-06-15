# Color tokens

> Reference: the dotden token architecture — a **local, shadcn/Tailwind-mirrored** model.
> Two layers: `dd/*` brand **primitives** (warm custom values) ← **semantic** tokens that reuse the
> **bare shadcn names**. Built for frictionless Figma→code porting. Part of the
> [design system](./README.md); bound by [components](./components.md) and every screen build.
> Decided 2026-06-14 — see [ADR-0017](../adr/0017-tailwind-shadcn-mirrored-tokens.md).

## Philosophy

Single-dev project; the priority is **frictionless design↔code**. The app is shadcn/ui on Tailwind v4,
whose theme is a CSS `@theme` block of semantic variables (`--background`, `--primary`, `--radius`, …).
We mirror that block 1:1 in Figma so **the design file _is_ the theme export.**

**The rule (testable):**

- A color whose **value matches stock Tailwind/shadcn** → bind the bare token. (Rare — almost nothing
  matches.)
- Otherwise → **brand primitive** under the `dd/*` namespace (`dd` = dotden).
- Our warm palette diverges from stock (green/500 `#5CA878` sage vs Tailwind `#22c55e`; warm ink vs cool
  zinc; ember isn't in Tailwind at all), so **in practice the whole palette is `dd/*`.** The only "bare
  shadcn" tokens are the **semantic aliases** (`background`, `primary`, …) — which we own and set to our
  values. **Customizing shadcn = setting these aliases; it never means editing components.**
- **Never bind to the Nova / `tailwind colors` _library_ variables.** They carry stock values (which
  would shift the scheme) and couple the file to that library staying published. The Nova kit is a
  **component-structure reference only** — never a color source. (Library-picking is the drift source
  behind the old `green/400`-for-resolved inconsistency.)

## Layer 1 — Primitives (`Primitives` collection · `dd/*` · 1 mode)

Warm brand values (unchanged scheme — only renamed with the `dd/` prefix).

**`dd/ink/*` — warm neutral ramp** (the spine of the UI):

| token        | hex       | typical role (via semantic alias)             |
| ------------ | --------- | --------------------------------------------- |
| `dd/ink/990` | `#1A1208` | on-ember text (`primary-foreground`)          |
| `dd/ink/950` | `#100E0B` | app canvas (`background`)                     |
| `dd/ink/900` | `#16130F` | `sidebar` / raised canvas                     |
| `dd/ink/850` | `#1C1814` | `card` / `muted` surface                      |
| `dd/ink/800` | `#221E19` | `popover` / `secondary` / `accent` / hover    |
| `dd/ink/750` | `#29241E` | `sidebar-border` / pressed                    |
| `dd/ink/700` | `#322C25` | `border` / `input`                            |
| `dd/ink/600` | `#423A31` | strong border / faint elements                |
| `dd/ink/500` | `#5A5046` | ignored / disabled text                       |
| `dd/ink/400` | `#82766A` | `muted-foreground` / secondary text (4.6:1 ✓) |
| `dd/ink/300` | `#A99C8D` | brighter secondary                            |
| `dd/ink/200` | `#C7BBAC` | `sidebar-foreground`                          |
| `dd/ink/100` | `#E7E0D5` | `foreground` — warm off-white (14:1 ✓)        |
| `dd/ink/50`  | `#F6F1E9` | highest-contrast / on-destructive text        |

**`dd/ember/*` — brand:** `300 #F4A06B` · `400 #EE8146` · **`500 #E76A33` (primary)** ·
`600 #D2541F` (hover) · `700 #AD4316` (active) · `900 #3A2015` · `950 #2A1710` (tinted surface).

**Functional ramps** (warm-tuned — **not** stock Tailwind values):
`dd/green/*` `400 #74BE90 / 500 #5CA878 / 950 #15241B` · `dd/amber/*` `400 #E7B65A / 500 #D9A441 /
950 #241D0F` · `dd/red/*` `400 #E27865 / 500 #D85C46 / 600 #C24A37 / 950 #2A1310` · `dd/blue/*`
`400 #7DB1E2 / 500 #5B9BD9 / 950 #112030`. **Overlays:** `dd/white`, `dd/black` (scrims only).

**Scopes:** ramps bound directly on screens — the functional hues + their `/950` bg steps — get real
scopes (`SHAPE_FILL`/`TEXT_FILL`/`STROKE_COLOR`; `FRAME_FILL` for `/950`) so they're pickable. `dd/ink/*`
and `dd/ember/*` stay **scoped-out** (`[]`) — they're consumed only through the semantic layer, so the
picker stays clean and you can't reach a neutral primitive by accident.

## Layer 2 — Semantic (`Theme` collection · bare shadcn names · 1 `Dark` mode → alias `dd/*`)

shadcn core: `background→dd/ink/950` · `foreground→dd/ink/100` · `card→dd/ink/850` ·
`card-foreground→dd/ink/100` · `popover→dd/ink/800` · `popover-foreground→dd/ink/100` ·
**`primary→dd/ember/500`** · `primary-foreground→dd/ink/990` · `secondary→dd/ink/800` ·
`secondary-foreground→dd/ink/100` · `muted→dd/ink/850` · `muted-foreground→dd/ink/400` ·
`accent→dd/ink/800` · `accent-foreground→dd/ink/100` · `destructive→dd/red/500` ·
`destructive-foreground→dd/ink/50` · `border→dd/ink/700` · `input→dd/ink/700` · `ring→dd/ember/500`.

sidebar: `sidebar→dd/ink/900` · `sidebar-foreground→dd/ink/200` · `sidebar-primary→dd/ember/500` ·
`sidebar-primary-foreground→dd/ink/990` · `sidebar-accent→dd/ink/800` ·
`sidebar-accent-foreground→dd/ink/100` · `sidebar-border→dd/ink/750` · `sidebar-ring→dd/ember/500`.

charts: `chart-1→dd/ember/500` · `chart-2→dd/blue/500` · `chart-3→dd/green/500` ·
`chart-4→dd/amber/500` · `chart-5→dd/red/500`.

**That is the entire semantic layer.** It's exactly shadcn's set + `chart-*`/`sidebar-*` — nothing
bespoke.

## Dropped — the old bespoke semantic sprawl

The previous `status/*` / `success` / `warning` / `info` / `accent-ember` / `primary-hover|active` layer
just re-aliased Tailwind hues → pure indirection, not shadcn-standard. **Removed.** Bind the primitive
directly:

| was                                               | now bind directly to                           |
| ------------------------------------------------- | ---------------------------------------------- |
| `status/added`, `success`                         | `dd/green/500` (bg `dd/green/950`)             |
| `status/modified`, `warning`                      | `dd/amber/500` (bg `dd/amber/950`)             |
| `status/deleted`, `status/conflict`               | `dd/red/500` (bg `dd/red/950`)                 |
| `status/renamed`, `status/incoming`, `info`       | `dd/blue/500` (bg `dd/blue/950`)               |
| `status/untracked`, `status/ignored`              | `dd/ink/400`, `dd/ink/500`                     |
| `accent-ember`, `primary-hover`, `primary-active` | `dd/ember/400`, `dd/ember/600`, `dd/ember/700` |
| "resolved" (was raw `green/400`)                  | `dd/green/400`                                 |

**Git status is documented intent, not a token:** a green file label binds `dd/green/500`; the component
name / a comment says "added". We accept losing retune-in-one-place — the project optimizes for token
minimalism + 1:1 code port over re-theme agility. `destructive` stays (it's shadcn core); a _deleted
file's_ hue still binds `dd/red/500` directly (status ≠ the destructive-action role).

## Code export (the payoff)

The two collections drop straight into the app's Tailwind v4 `@theme` block — `dd/*` primitives as
`--color-dd-*`, semantic names as `--color-*` aliasing them. shadcn components consume the semantic
names unchanged; the warm brand is fully preserved:

```css
@theme {
  /* primitives — brand values, dd/* namespace */
  --color-dd-ink-950: #100e0b;
  --color-dd-ember-500: #e76a33;
  --color-dd-green-500: #5ca878;
  --color-dd-red-500: #d85c46; /* …amber, blue, full ramps */

  /* semantic — bare shadcn names, point at primitives */
  --color-background: var(--color-dd-ink-950);
  --color-primary: var(--color-dd-ember-500);
  --color-destructive: var(--color-dd-red-500);
  /* radius/spacing/shadow already mirror Tailwind naming → see radius-spacing-effects.md */
}
```

**No palette masking.** We never override the stock Tailwind names (no `--color-green-500: <sage>`
making `bg-green-500` secretly warm). The brand ramp is its own namespace, so utilities are **explicit**
— `bg-dd-green-500`, `text-dd-ember-500` — and the stock `green`/`red`/… palettes stay untouched and
unused. Hue stays in the class (`dd-<hue>-<step>`) because `dd` spans five hues. shadcn semantic roles
keep their normal classes (`bg-primary`, `bg-background`) — also not masking, since those are shadcn
tokens, not Tailwind palette names.

> ✅ **Live as of 2026-06-14 (M7 executed).** Primitives renamed to `dd/*` (+ scopes), all 241 affected
> nodes rebound, the 26 bespoke semantic tokens deleted (Theme is now exactly the 32 shadcn-standard
> tokens), home screen verified visually intact. **Residual:** the `01 · Foundations` token specimen
> still documents the old token names (no bound nodes broke — its swatches weren't variable-bound) and
> needs a redesign to show `dd/*` + the semantic layer; tracked under M6 doc-sync.
