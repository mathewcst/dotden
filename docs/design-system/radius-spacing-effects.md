# Radius, spacing, effects

> Reference: radius scale, the 4px spacing grid, density defaults, and the shadow/glow
> effect styles. Part of the [design system](./README.md).

- **Radius (small):** `sm 4` · `md 6` (default) · `lg 8` · `xl 10` · `2xl 14` · `full 9999`.
- **Spacing (4px grid):** 0, 2, 4, 6, 8, 10, 12, 14, 16, 20, 24, 28, 32, 40, 48, 64
  (Tailwind step naming; fractional steps are `spacing/0-5`, `1-5`, `2-5`, `3-5` — Figma var names
  can't contain `.`).
- **Inter-element gaps — two-tier `32` / `64` only:** between **elements** (component tiles in a section,
  variants in a set, screen elements) use **32px within** a related group and **64px between** distinct
  groups — never an arbitrary gap. (Component _internal_ padding/gaps still use the full scale above;
  this rule is the spacing _between_ sibling elements.) See
  [figma-conventions.md → Structural standards](./figma-conventions.md#spacing-two-tier-32-within--64-between-only).
- **Density:** controls `h-8 / 32px` default (sm 28, lg 36), tree rows 28px, inputs 32px.
- **Effects:** `Shadow/SM`, `Shadow/MD`, `Shadow/Popover`, `Shadow/LG` (subtle, dark), and one
  `Glow/Ember` for focus/brand — used sparingly.
