# Journey — Daily use (hub)

> The everyday loop on an established environment: record your own changes, take in others', and let
> automation carry as much of it as you trust.

Daily use is large, so it's split into focused pieces. This hub orients; each piece is its own doc so none
grows unwieldy. All pieces share the [home](../screens/home.md) workbench and the
[operation surface](../screens/operation-surface.md).

| | |
|---|---|
| **Preconditions** | An environment is registered & ready; the Den has content ([Journey 01](01-first-install-and-first-den.md)) |
| **Outcome** | Local edits recorded & pushed; incoming changes reviewed & applied; automation tuned to taste |
| **environment role** | both — **send** (Commit/push) and **receive** (pull/Apply) on one unified surface |
| **v1 status** | ships v1 |
| **Screens touched** | [home](../screens/home.md), [operation surface](../screens/operation-surface.md), [titlebar & status bar](../screens/titlebar-statusbar.md), [conflict resolver](../screens/conflict-resolver.md) |

## The pieces

| # | Piece | Covers | Status |
|---|---|---|---|
| 02a | [Receive & Apply](daily-use/receive-and-apply.md) | incoming detected → `Review & Apply` → resolve conflicts (gated) → Apply → home | **decided & documented** |
| 02b | [Commit & push](daily-use/commit-and-push.md) *(send)* | edit detected → `Commit changes` (default-all, per-File defer) → `Not synced` → push (Manual `Sync now` / Auto-sync auto) | **decided & documented** |
| 02c | [Automation ladder](daily-use/automation-ladder.md) | **Manual ←→ Auto-sync** (transport-only; Auto-sync default) — triggers, what's automatic, what stays manual | **decided & documented** |

> As each piece is grilled and settled, add its doc under [`daily-use/`](daily-use/) and flip its status here.

## Related

- [Journey 01 — first install & first Den](01-first-install-and-first-den.md) (how the user arrives here).
- [Journey 03 — second environment](03-second-environment-adopt.md), [04 — conflicts](04-conflicts.md).
- Glossary: [`CONTEXT.md`](../../../CONTEXT.md) (Commit / Apply / Sync / Auto-sync).
