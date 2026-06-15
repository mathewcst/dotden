# UI: shadcn + Base UI primitives, generated in-app, Tailwind v4

The desktop renderer uses **shadcn/ui generated against Base UI primitives** (`shadcn init --base base`, `@base-ui/react@1.5`), **Tailwind v4** (CSS-first — `@tailwindcss/vite`, `@import "tailwindcss"`, no `tailwind.config.js`), **dark-only**. shadcn components are generated **directly into `apps/desktop`**, not into `@dotden/ui`.

Two deliberate deviations from the obvious path:

- **Base UI over Radix**, even though Radix is shadcn's fullest-coverage, most-exercised default. Base UI is GA (1.x, ~6 months mature) and React 19 / Tailwind v4 compatible, but its **React-Compiler compatibility is unverified by MUI** (`mui/base-ui#809`) and a few primitives differ (Hover Card → Preview Card; no `asChild`/Slot — use the render prop). shadcn keeps an **identical component API across both bases**, so **Radix is a low-cost fallback** (`--base radix` + re-add the affected components) if Base UI conflicts with the compiler.
- **In-app, no shared UI package.** shadcn's official monorepo topology (primitives in `packages/ui`, a `components.json` per workspace, cross-package Tailwind `@source` scanning) only earns its complexity with **2+ React consumers**. There is only one React surface — the desktop renderer; the other app, `apps/web`, is a greenfield Astro marketing site with **its own CSS** that won't consume React components. So shadcn components live directly in `apps/desktop`, and the create-turbo `@repo/ui` package is **removed** (there is no `@dotden/ui`). A shared React package can be introduced later if a second React app ever appears.

## Consequences

- The dark-only ember design system lives in the app's `index.css` (`@theme inline` tokens + `@custom-variant dark`); the scaffolded light `:root` block is dropped.
- Selecting the Base UI base sets `components.json` `style` to a base-\* variant; the shadcn CLI fetches the correct pre-built registry variant on `add` (it does not transform Radix→Base UI at runtime).
