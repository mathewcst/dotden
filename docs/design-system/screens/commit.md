# Commit flow (Pending → Committed)

> Phase 5 — Batch B. Recording an environment's edited Files into the Den, then pushing. Built on
> `AppShell` + the new `AppPane/Commit` ([components.md](../components.md)). Part of the
> [design system](../README.md). Domain rules: the **Commit** verb (see [CONTEXT.md](../../../CONTEXT.md)), commit is always
> manual / no silent auto-commit, push is manual ("Sync now") so a commit is local until pushed
> ([ADR 0006](../../adr/0006-sync-model-transport-not-commit.md)), customizable commit-message template
> ([scope-v1](../../scope-v1.md)).

Two screens in a **`Commit`** SECTION (`283:2644`) on `05 · Screens — App`, each an `AppShell`
instance reusing **Left/Workspaces** (the M/A/D tree) and **Center/Diff**, with the **Right** slot
swapped to an `AppPane/Commit` variant.

## The composer — `AppPane/Commit` (page `02 · Components — App`)

`AppPane/Commit` SET `282:742` — `State=Pending|Committed`. Full anatomy in
[components.md](../components.md). The deliberate distinction that matters:

- the **message field** shows the **resolved** message (`[macos-sync-2026-06-14]`) — what will actually
  be committed, editable;
- the **template hint** shows the **unresolved** template (`[$os-sync-$year-$month-$day]`) in a code
  block, so the user knows the _base_ their message came from, plus an **Edit template** link
  (→ Settings; commit-message template in [scope-v1](../../scope-v1.md)).

The primary action is **Commit changes** (the exact label; see the **Commit** verb in
[CONTEXT.md](../../../CONTEXT.md)). A helper line — "Commits locally —
push later with Sync now" — encodes the commit-is-local-until-pushed rule ([ADR 0006](../../adr/0006-sync-model-transport-not-commit.md)). After committing, the
composer flips to **Committed**: success callout, the new commit (amber SHA), a **TO PUSH · 1 commit
ahead** line, and a **Sync now** push button (Sync now = push pending + fetch; see [ADR 0006](../../adr/0006-sync-model-transport-not-commit.md)).

## The two screens

| Screen                                       | Right pane                       | Notes                                                                 |
| -------------------------------------------- | -------------------------------- | --------------------------------------------------------------------- |
| **Pending changes — Commit** (`283:2645`)    | `AppPane/Commit` State=Pending   | tree + diff show the live uncommitted state; composer ready.          |
| **Committed · 1 ahead to push** (`283:3059`) | `AppPane/Commit` State=Committed | titlebar shows the ahead count ("1 to push"); **Sync now** available. |

**Committed-screen consistency** (instance overrides, mirroring the returning "Applied · in sync"
polish): after commit the local tree is clean, so the three local **M/A status letters are hidden**
(`visible=false`); the **incoming `↓`** decorations stay (unrelated to commit). The center file
header drops its **"modified" tag** and the **Commit changes / Discard** buttons (nothing to
commit/discard), and its body header is relabeled **"Committed · macos-sync-2026-06-14"** — the diff
now reads as the committed change. This keeps titlebar + tree + center + right pane telling one story.

White-fill + binding audits clean.
