# Sync states (Syncing · Up to date · Incoming · Not synced)

> Phase 5 — Batch C. The main-window states for dotden's **Sync** transport, surfaced via the new
> `Banner` primitive ([components.md](../components.md)) + titlebar/inspector overrides on `AppShell`.
>
> ⚠ **Copy retone (vocabulary rule):** the committed-but-unpushed state now reads **`Not synced · N changes`**
> (the mirror of `Synced · <time> ago`) — git's **"ahead" / "to push"** is banished from user-facing copy
> (see [brand-and-vocabulary.md](../../brand-and-vocabulary.md) → "Not synced"). The Banner variant is still
> **named** `Tone=Push` (a stable Figma identifier), but its **copy** is the `Not synced` string below.
> **Reconciled (Figma copy pass):** node `301:3980` (renamed `Sync · Not synced`) and the `Tone=Push` default
> copy now read `Not synced · N changes`; the `Tone=Syncing` copy drops git's "Pushing" for "Sending".
> Part of the [design system](../README.md). Domain rules: the **Sync** glossary term
> (see [CONTEXT.md](../../../CONTEXT.md)) and the **Sync model: transport not commit** decision
> (see [ADR 0006](../../adr/0006-sync-model-transport-not-commit.md)) — **Sync = transport**
> (moves already-Committed changes + checks for incoming; never auto-Commits/Applies by default), push
> is manual via **"Sync now"**, **"Sync now" = push pending + fetch + present incoming for review**,
> incoming → notify → review/Apply, **Offline → commit locally + queue, retry on reconnect**
> (all per [ADR 0006](../../adr/0006-sync-model-transport-not-commit.md)).

Four screens in a **`Sync states`** SECTION (`297:3139`) on `05 · Screens — App`, laid out 2×2. Each is
a clone of the home backdrop whose `AppShell` instance is **detached** so a full-width `Banner` can be
**inserted between the titlebar and the body** (the body's `FILL` height auto-shrinks — nothing is
covered). Detaching also makes the deep tree/inspector edits below free (no instance-override limits).

## The `Banner` primitive (page `02 · Components — App`)

`Banner` SET `292:751` — `Tone=Syncing|UpToDate|Incoming|Push|Offline|Error`. Full anatomy in
[components.md](../components.md). The key design call: a `Banner` is a **persistent inline status
strip**, the opposite of the transient, dismissable `Toast`. dotden's sync states are a small fixed
semantic set, so **`Tone` carries everything** — icon, color, and default copy are baked per variant
(content is overridden per-instance on screens, not via shared props that would collapse to one
default). Tone → state map:

| Tone       | Color / icon            | Default copy                                                    | Action             |
| ---------- | ----------------------- | --------------------------------------------------------------- | ------------------ |
| `Syncing`  | info/blue · `sync`      | "Syncing… · Sending 1 change · checking for incoming"           | —                  |
| `UpToDate` | success/green · `check` | "Up to date · Last synced just now"                             | —                  |
| `Incoming` | blue · `arrow-down`     | "3 incoming changes · from work-laptop"                         | **Review & Apply** |
| `Push`     | amber · `git-commit`    | "Not synced · 1 change" (was "1 commit ahead · not yet pushed") | **Sync now**       |
| `Offline`  | neutral · `cloud`       | "Offline — changes queued · Will sync when you reconnect"       | —                  |
| `Error`    | red · `alert-triangle`  | "Sync failed · Couldn't reach the remote"                       | **Retry**          |

`Offline` + `Error` exist now but are screened later (Batch E). Blue = incoming/sync, amber =
not-synced/attention, green = synced, red = failure — the locked functional-color discipline; **ember stays
the action color** (the trailing CTA), never a status.

## The four screens

| Screen                      | Banner                               | State-consistency overrides                                                                                                                                                                                                                                                                                                                                                                                            |
| --------------------------- | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **3 incoming** (`297:3140`) | `Tone=Incoming` + **Review & Apply** | titlebar → "3 incoming"; inspector incoming-card + work-laptop "3 changes incoming" (blue) **kept** — banner = global alert, card = contextual detail (2 files, 1 conflict).                                                                                                                                                                                                                                           |
| **Up to date** (`298:4100`) | `Tone=UpToDate`                      | titlebar → "Up to date"; inspector incoming-card **hidden**; tree incoming `↓` + conflict `!` decorations **hidden** (they'd contradict "up to date"); env rows this-mac + work-laptop → "Synced just now" (green dots); home-pc stays offline (connectivity is per-environment, independent of _your_ sync).                                                                                                          |
| **Syncing…** (`298:3429`)   | `Tone=Syncing`                       | titlebar → "Syncing…"; this-mac env → "Syncing…" (blue dot). Incoming card + tree decorations **kept** — we're mid-fetch of the known incoming. The lightest screen.                                                                                                                                                                                                                                                   |
| **Not synced** (`301:3980`) | `Tone=Push` + **Sync now**           | committed-but-unpushed, so neutralized to a clean/committed view (mirrors the Batch-B committed screen): titlebar → "Not synced · 1 change"; tree M/A letters + decorations **hidden**; diff header → "Committed · macos-sync-2026-06-14"; the "modified" `StatusTag` + Commit/Discard `Button`s **hidden**; "Last commit" → "just now"; env this-mac → "Not synced" (amber), work-laptop → "Synced just now" (green). |

**Why detach + insert (not overlay).** `AppShell` is a vertical auto-layout (titlebar HUG · body FILL).
Overlaying a banner absolutely at the titlebar's bottom edge would cover the pane headers (WORKSPACES /
file header / inspector card). Detaching the shell and `insertChild(1, banner)` puts the strip in the
real layout slot; the `FILL` body shrinks to fit. This is the faithful product layout (a banner pushes
content down) and the reason these screens are detached compositions, not live `AppShell` instances.

**Env-row dots** are plain `ELLIPSE`s (not `StatusDot`), so recoloring a row's status means matching the
nearest ellipse by vertical position and rebinding its fill to the tone variable.

White-fill + binding audits on `Banner` clean (0 flags).

## Relationship to the rest of Phase 5

The `Incoming` banner's **Review & Apply** routes to the existing
[returning · Review & Apply](./returning-environment.md) Apply-diff surface (per
[ADR 0006](../../adr/0006-sync-model-transport-not-commit.md)). The `Push`/not-synced
state is also shown — from the _commit_ angle — by the [commit flow](./commit.md)'s "Committed · Not synced"
screen; here it's shown from the _sync_ angle (a banner reminder to **Sync now**).
