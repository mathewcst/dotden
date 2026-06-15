# Inheritance model (shadcn / Nova → dotden)

> How our Figma file and code inherit from shadcn/Nova without ever editing the upstream
> library — local tokens + local components hold _our_ values. Part of the
> [design system](./README.md); token values live in [color-tokens.md](./color-tokens.md).

The Figma file subscribes to the **shadcn/ui kit for Figma — Nova Basic** library. We do **not** edit
that library. Instead:

1. **Local token collections** mirror shadcn's CSS-variable names (`background`, `primary`, `border`,
   `sidebar-*`, `chart-*`, …) but hold _our_ warm-dark/ember values.
2. **Local components** mirror shadcn/Nova anatomy and bind to _our_ tokens.

In code this maps 1:1 to the real shadcn workflow:

```
npx shadcn add button        # vendors the component source into the repo
# override the CSS variables in globals.css (:root / .dark) with our token values (see color-tokens.md)
# thin wrapper only where we diverge
```

So upgrading shadcn (or its BaseUI primitives) never clobbers our brand — the component source is
ours, the look comes from our tokens.

Every Figma variable carries `WEB` code syntax of the form `var(--token-name)`.
