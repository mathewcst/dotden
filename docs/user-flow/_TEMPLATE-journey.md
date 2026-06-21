<!--
TEMPLATE — copy this file to author a new journey.
Delete this comment. Keep every heading. Link into screen specs rather than re-describing them.
Quote UI copy verbatim in "double quotes".
-->

# Journey — <Name>

> One-sentence summary of the story this journey tells.

| | |
|---|---|
| **Preconditions** | What must be true before this journey starts |
| **Outcome** | The end state the user reaches |
| **environment role** | A / B / both |
| **v1 status** | ships v1 / partly v1.1 / deferred |
| **Screens touched** | [home](../screens/home.md), … (links) |

## The flow

Numbered steps. Each step states: **trigger → screen → user action → system/IPC → result →
next step**. Link the screen spec on first mention.

1. **<Step name>** — …
2. …

## State transitions

How app/session state moves through the journey (route, role, key store flags). A small table
or diagram. Reference [ADR 0026](../../adr/0026-launch-routing-derives-entry-screen-from-registration-state.md)
/ [ADR 0027](../../adr/0027-renderer-feature-folders-and-scoped-den-session-store.md) where state is governed.

## Branches & edge cases

The forks: error paths, offline, "already done", permission/credential failures, empty inputs.
Link the screen that handles each, and the relevant [states/](../states/) doc.

## What's v1 vs later

Call out steps or branches that are v1.1 / deferred per [`scope-v1.md`](../../scope-v1.md).

## Related

Adjacent journeys and the ADRs that govern this flow.
