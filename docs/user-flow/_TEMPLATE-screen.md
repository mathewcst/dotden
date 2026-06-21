<!--
TEMPLATE — copy this file to author a new screen spec.
Delete this comment. Keep every heading; write "None" / "N/A" rather than omitting one,
so the shape stays grep-consistent. Quote UI copy verbatim in "double quotes".
-->

# Screen — <Name>

| | |
|---|---|
| **Figma** | node `00:0` (`design-system/inventory.md`), spec [`design-system/screens/<file>.md`](../../design-system/screens/<file>.md) |
| **Code** | `src/renderer/features/<feature>/components/<File>.tsx` |
| **Route / render condition** | e.g. `route === 'app'` + `reviewing === true`, or "rendered inside CenterPane when a File is selected" |
| **environment role** | A (Track/Commit/Sync) · B (Detect/Apply) · both · n/a |
| **Governing ADRs** | [ADR 00XX](../../adr/...) — one-line decision |
| **v1 status** | ships v1 / v1.1 / deferred (per `scope-v1.md`) |

## Purpose

One paragraph: what this surface is for, in the user's terms.

## When the user sees it

Entry conditions — what navigation, state flag, or event brings the user here, and from where.

## Layout

Regions and what lives in each (left / center / right, header / banner / footer). Reference the
panes or component instances. A small ASCII sketch is welcome.

## Elements & copy

Every visible element with its **verbatim** label, in reading order. Buttons, inputs, lists,
icons, badges, counts, status indicators, banners, toasts. Note which are primary vs secondary.

## States & variants

Each visual state this surface can be in and what condition triggers it (e.g. idle / loading /
populated / "N incoming" / error). Link [states/](../states/) for shared matrices.

## Actions → outcomes

Each action the user can take → what happens, including the IPC call (`api.den.commit(...)`),
the state change, and where focus/navigation goes next. Use a table.

| Action | Trigger | Result | IPC / state |
|---|---|---|---|

## Motion

Interaction animations on this screen. **Reference named patterns** from [`motion.md`](../motion.md)
(e.g. *"the incoming banner uses [`banner-slide-down`](../motion.md#banner-slide-down)"*); only
spell out values for motion unique to this screen. Note the reduced-motion behavior. Write "None"
if the screen is static.

## Fallbacks (never fail silently)

- **Empty:** what shows when there's nothing yet.
- **Loading:** what shows while data resolves.
- **Error:** what shows on failure + the offered fix.
- **Offline:** behavior with no network, if relevant.

## Exits

Where the user can go from here, and what each exit leads to (link the next screen/journey).

## Related

Journeys that pass through here, sibling screens, and any gotchas.
