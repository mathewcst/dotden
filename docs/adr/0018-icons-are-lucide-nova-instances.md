# Icons are live Lucide instances from the Nova library — the one library-component dependency

**Status:** accepted · 2026-06-14

Every repeatable element in this file is a _local_ component (the no-duplication rule), **except icons**:
we drop `Lucide Icon / <PascalName>` instances straight from the subscribed _shadcn/ui kit (Nova)_
library rather than hand-building or copying a local `Icon/*` set. Names map 1:1 to `lucide-react`
(`Lucide Icon / Pen` → `<Pen/>`), giving exact design↔code parity for free, the full icon set, and zero
maintenance. Recolor is local: override the instance `strokes` to a `dd` token per the 3-case
icon-color convention.

This is the deliberate inverse of [ADR-0017](0017-tailwind-shadcn-mirrored-tokens.md), which forbids
depending on Nova for _color values_. The asymmetry is the whole point: **icons carry no brand value**
(geometry only, recolored locally), so a Nova _component_ dependency is low-risk/high-reward — whereas a
Nova _color_ dependency would hijack the warm scheme. Recorded so a future reader doesn't "fix" the
seeming inconsistency.

## Considered and rejected

- **Local `Icon/*` set copied from Lucide** (today's setup). Rejected: hand-maintenance, drift from real
  Lucide geometry, no automatic parity with `lucide-react`.
- **Thin local wrapper + `INSTANCE_SWAP` Lucide slot.** Rejected as overkill for a single-dev file —
  adds a layer and still couples to Nova.

## Consequences

If Nova is ever unpublished, icon instances could detach — accepted (stable community kit; detach-to-
local is always available as a fallback). The legacy local `Icon/*` set (22 components) is retired and
every usage rebinds to a Nova Lucide instance (the **M8** rebind pass).
