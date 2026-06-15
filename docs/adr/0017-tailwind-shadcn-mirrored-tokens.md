# Tokens mirror shadcn/Tailwind locally with `dd/*` brand values, not the stock libraries

**Status:** accepted · 2026-06-14

This is a single-dev project on shadcn/ui + Tailwind v4, so tokens optimize for **frictionless
design↔code**: the Figma file mirrors the app's CSS `@theme` block 1:1. Two **local** layers — `dd/*`
brand **primitives** (`dd/ink`, `dd/ember`, `dd/green|amber|red|blue`, holding our warm values) aliased
by a **semantic** layer that reuses the **bare shadcn names** (`background`, `primary`, `destructive`,
`border`, `ring`, `sidebar-*`, `chart-*`). Export = copy both collections into `@theme`; shadcn
components consume the semantic names unchanged, so the warm brand survives with **zero component
edits** (customizing shadcn _is_ setting these variables — a misconception we explicitly reject).

**The rule:** bind a bare Tailwind/shadcn token only when its value is identical to stock; otherwise use
`dd/*`. Our palette is warm-tuned (green/500 `#5CA878` sage vs Tailwind `#22c55e`; warm ink vs cool
zinc; ember absent from Tailwind), so in practice the whole palette is `dd/*` and the bare tokens are
only the semantic aliases we own.

## Considered and rejected

- **Bind to the enabled Nova / `tailwind colors` libraries.** Rejected: their variables carry stock
  values (cool zinc neutrals, vivid Tailwind hues) that would overwrite the warm "lit dwelling" scheme,
  _and_ couple the file to those libraries staying published. Nova is kept as a **component-structure
  reference only**, never a color source. (Ad-hoc library-picking was the drift source we're fixing.)
- **Keep the bespoke semantic layer** (`status/*`, `success/warning/info`, `accent-ember`,
  `primary-hover|active`). Rejected as sprawl: ~30 tokens that merely re-aliased Tailwind hues, none
  shadcn-standard. Bind the primitive directly (`dd/green/500` for an added file). The cost — losing
  retune-a-status-in-one-place — is accepted in favor of token minimalism and a clean code port. Git
  status becomes documented _intent_ (component name / comment), not a token. `destructive` stays (it's
  shadcn core).

## Consequences

Supersedes the original rich-`status/*` token model documented in
[`color-tokens.md`](../design-system/color-tokens.md). The rename (`ember/*|ink/*` → `dd/*`), the
semantic-layer teardown + rebind of every instance, and giving the functional primitives real picker
scopes were the **M7** rename pass — a large blast radius
across all screens, executed with before/after screenshots. Radius/spacing/shadow already mirror
Tailwind naming and are unaffected.
