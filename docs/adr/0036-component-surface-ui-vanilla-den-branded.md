# 0036 — Component surface is two-tier: vanilla `ui/` vs branded `den/`

**Status:** accepted · 2026-06-21 · draws the edge of ADR 0012 (shadcn on Base UI) and refines
the "don't hand-author wrappers" rule into "**compose-over, never re-implement**."

The renderer was manually re-installed with the full shadcn set in `components/ui/` (55
primitives, `style: base-nova` = Base UI + Nova — fixing the base-misconfig a prior audit
flagged, `.scratch/AUDIT/shadcn-conformance.md`). Two questions remained: **(1)** how to brand
the primitives to the dotden design system without losing `shadcn add` upgradeability, and
**(2)** where the design-system pieces shadcn doesn't ship live — Badge, Pill, StatusTag,
StatusDot, Banner (Figma "02 · Components", node `37:2`). Re-skinning `ui/*` in place would
brand them but make every future `shadcn add` a merge conflict; and an earlier rule ("never
hand-author wrappers, even thin ones") read as forbidding any branded layer at all.

## Decision

**A two-tier component surface.**

```
components/
  ui/    vanilla shadcn — CLI-owned, never branded; only den/ (+ app/providers) imports it
  den/   the dotden-branded surface — the layer app/features RENDER through
```

- **`components/ui/` — vanilla shadcn, CLI-owned.** Never edited for brand, never re-skinned;
  stays `shadcn add`-upgradeable. App and feature code never import it directly.
- **`components/den/` — the dotden-branded surface.** Two kinds: **(a)** thin wrappers that
  _compose over_ a `ui/` primitive and add dotden variants/sizes/defaults (`den/button`
  imports `ui/button`); **(b)** fully bespoke where shadcn has no behavioral equivalent —
  Badge, Pill, StatusTag, StatusDot, Banner, IconButton. Toast is **`sonner`**, re-skinned.

**The governing rule — compose-over, never re-implement.** A `den/` wrapper _delegates_
behavior to the tested shadcn primitive; it never re-implements it. That is the precise edge
of "don't hand-author primitives": re-implementing `button` over Base UI (the old `ui/button`
we deleted) is the worst-of-both-worlds the team rejected — _"not tested, badly copied"_; a
`den/button` that styles `ui/button` is **composition**, with no behavior to badly-copy. For
purely-presentational pieces (Badge/Pill/StatusTag/StatusDot) there is no behavior at all, so
custom is simply correct. The discriminator: **does the wrapper _delegate_ to shadcn (→ `den/`)
or _replace_ it (forbidden)?**

**Branding via tokens vs wrappers.** Color/radius branding is already done by the `index.css`
semantic-token layer (`--primary → --dd-ember-500`), so `ui/button` already renders ember.
`den/` earns its place for **variants/defaults/bespoke structure, not color alone** — but it is
adopted as a _blanket_ surface anyway, so app code has one import root and `ui/` stays a
swappable vendor detail. Enforced: `eslint-plugin-boundaries` lets **`den/` and `app/providers/`
import `ui/`** — nothing else (ADR 0035). `den/` is built **lazily** — only primitives actually
used get a wrapper; no passthrough files for unused primitives. The Figma `37:2` sheet is the
canonical build-list.

**Exception — root providers are plumbing, not rendered surface.** The default context providers
a library mounts once at the application root — `TooltipProvider`, sonner's `<Toaster/>`, a theme
provider — are **not** branded UI. They render nothing the user perceives as a dotden component;
they only wire React context. Forcing a `den/` pass-through for them is exactly the
busywork the compose-over rule exists to kill (there is no behavior to compose and no surface to
brand). So the `app/providers/` directory MAY import `ui/` directly and needs no `den/` wrapper.
The exception is deliberately narrow — it is the _providers_ directory, not `app/` at large:
`shell/`, `launch/`, and every feature still render through `den/`. The discriminator is
**provider vs rendered surface** — a context provider mounted at the root is plumbing (vanilla
`ui/` is fine); a toast's visual box, an input, a button — anything the user sees — is `den/`.
When a toast needs branding, that is a `den/` toast component (or sonner `toastOptions`); the
`<Toaster/>` provider itself stays the default. This keeps the "no re-skinning `ui/`" guarantee
intact while not inventing wrappers for zero-surface plumbing.

## Alternatives considered

- **Re-skin `ui/*` in place** (shadcn's "you own the code" path). Rejected — destroys
  `shadcn add` upgradeability; every update becomes a manual merge against brand edits.
- **One tier: brand everything as bespoke `components/*`, no `ui/`.** Rejected — throws away
  shadcn's tested behavior (focus, ARIA, keyboard) for primitives that have it; the
  re-implement trap.
- **Token-only branding, no `den/`, import `ui/*` directly.** Viable for color, but no home
  for variants/defaults/the bespoke family, and no single branded surface — app code would
  import a mix of `ui/` and one-off custom components.

## Consequences

- New component → `shadcn add` into `ui/` (if a base exists), then a `den/` wrapper when it
  needs dotden treatment beyond tokens; or a bespoke `den/` component when shadcn has no base.
- The bespoke family (Badge/Pill/StatusTag/StatusDot/Banner) lives in `den/`, not `ui/`.
  shadcn's vanilla `ui/badge` is **dropped** (no internal `ui/` dependents) — the dotden Badge
  is a `den/` component.
- **StatusTag is reconciled** from its code form (4 den states: `tracked`/`committed-local`/
  `pushed`/`incoming`) to the Figma's 7 git-diff states (`added`/`modified`/`deleted`/
  `renamed`/`untracked`/`incoming`/`conflict`) when rebuilt as `den/status-tag` — a conscious
  expansion, not a silent drop.
- **Root providers are exempt** — `app/providers/` mounts the default `TooltipProvider` / sonner
  `<Toaster/>` straight from `ui/` with no `den/` wrapper; the boundaries gate allows
  `app/providers → ui` alongside `den → ui` (ADR 0035). Branding a toast's _box_ is still a `den/`
  job; the _provider_ is not.
- ADR 0012 stands (Base UI base); this ADR adds the `ui/`-vs-`den/` split and the compose-over
  rule on top.
