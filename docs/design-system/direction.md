# Direction

> The locked aesthetic for the dotden app — dark-only, ember accent, disciplined functional
> color, Geist type. Part of the [design system](./README.md).

- **Aesthetic:** modern, clean, shadcn-like. Warm-tinted near-black canvas, compact density,
  small radius, high contrast, three-pane desktop shells.
- **Theme:** **dark only.** We will never ship light. Tokens use a single `Dark` mode (no light mode
  to maintain).
- **Accent:** **ember** (warm orange) is the _only_ brand hue — primary actions, focus ring, active
  states, brand moments. Never used to encode status.
- **Functional color is disciplined, not rainbow.** A meaning-bearing color appears _only_ where it
  has meaning:
  | Hue | Meaning |
  |---|---|
  | green | added / success / applied-ok |
  | amber | modified / warning |
  | red | deleted / destructive / **conflict** (+ `!` glyph) / error |
  | blue | incoming / sync / renamed / info |
  | neutral grey | untracked / ignored / disabled |
- **Type:** **Geist** (UI) + **Geist Mono** (code, paths, diffs, status letters, eyebrows). No other
  families. Compact ramp, 13px body.
