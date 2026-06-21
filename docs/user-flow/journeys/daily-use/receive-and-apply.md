# Journey — Daily use · Receive & Apply (02a)

> Incoming changes from another environment arrive; the user reviews them, resolves any Conflicts, and
> applies the set onto this environment.

Part of [Daily use](../02-daily-use.md). This is the **receive** half (role B). The **send** half is
[Commit & push (02b)](commit-and-push.md); automation that can do this for you is the
[Automation ladder (02c)](../02-daily-use.md).

| | |
|---|---|
| **Preconditions** | A peer environment Committed & pushed; this environment Synced and fetched the incoming changes |
| **Outcome** | The incoming set (conflicts resolved) is written onto this environment; it's in sync |
| **environment role** | B (receive / Apply) |
| **v1 status** | ships v1 (manual review; auto variants = [02c](../02-daily-use.md)) |
| **Screens touched** | [home](../../screens/home.md), [operation surface](../../screens/operation-surface.md) (Apply variant), [conflict resolver](../../screens/conflict-resolver.md), [titlebar & status bar](../../screens/titlebar-statusbar.md) |

## The flow

1. **Incoming detected** — Sync (transport, [ADR 0006](../../../adr/0006-sync-model-transport-not-commit.md))
   fetches a peer's pushed Commits. The [status bar](../../screens/titlebar-statusbar.md) sync state flips to
   `N incoming`, and [home](../../screens/home.md)'s inspector shows the **incoming card**:
   `↓ N incoming changes` · `from <env> · N files, N conflict` · **`Review & Apply`**. Nothing is written yet —
   Sync is transport, not Apply.
2. **Open review** — user clicks **`Review & Apply`** → the
   [operation surface](../../screens/operation-surface.md) (**Apply** variant) slides up over the home body
   ([`operation-surface`](../../motion.md#operation-surface)): left rail = incoming `ChangeList`, center =
   incoming `Diff`, right rail = **Apply panel**.
3. **Triage** — the left rail presents the split: `CONFLICTS · N` (rows flagged `⚠`) and
   `APPLIES CLEANLY · N`. Selecting a file shows its `Incoming changes` diff (blue `● incoming` dot;
   stacked/side-by-side toggle). The right Apply panel summarizes `from <env>` + `● N conflicts · ● N clean`.
4. **Resolve Conflicts** *(only if any)* — selecting a Conflict file turns the center into the
   [resolver](../../screens/conflict-resolver.md): `Keep` (local) / `Take` (incoming) / `Both`. `Apply` stays
   **disabled** until every Conflict is resolved — standard git; you can't complete a merge with unresolved
   conflicts. A Conflict is never auto-resolved ([ADR 0008](../../../adr/0008-invariant-ownership.md)).
5. **Apply** — once all conflicts resolve (or there were none), `Apply` enables → writes the **full set** onto
   this environment (`api.den.apply(...)` → `chezmoi apply`). Completion shows applied & in sync + a
   [`Toast · Applied`](../../motion.md#toast-in).
6. **Return home** — surface dismisses; changed tree rows re-render
   ([`row-enter`](../../motion.md#row-enter--list-reorder)); status bar returns to `Synced <time> ago`;
   incoming count → 0.

## State transitions

| Step | route / mode | sync state | incoming |
|---|---|---|---|
| 1 detected | `home` | `N incoming` | N |
| 2–5 review | `operation:apply` (over home) | `N incoming` | N (pending) |
| 5 apply | applying | `Syncing…`/applying | N → 0 |
| 6 done | `home` | `Synced <time> ago` | 0 |

Governed by [ADR 0026](../../../adr/0026-launch-routing-derives-entry-screen-from-registration-state.md)
(routing) and the scoped den-session store
([ADR 0027](../../../adr/0027-renderer-feature-folders-and-scoped-den-session-store.md)).

## Branches & edge cases

- **No conflicts** — step 4 is skipped; `Apply` is enabled on arrival.
- **Skip a file** — `Skip` excludes that file from this Apply; it stays incoming for later.
- **Back / Cancel** — discards the operation (nothing applied), returns to [home](../../screens/home.md).
- **Incoming deletion** — a peer's delete is surfaced and **always confirmed** before it removes local files
  (invariant, [ADR 0008](../../../adr/0008-invariant-ownership.md)); never silent.
- **Offline** — already-fetched incoming can still be reviewed & applied; new fetches resume on reconnect
  (journey [06](../06-errors-offline-diagnostics.md)).
- **Apply fails** — the Apply panel surfaces the failure + the fix; a Console row captures the redacted output;
  `Retry` offered ([titlebar-statusbar](../../screens/titlebar-statusbar.md#fallbacks-never-fail-silently)).

## What's v1 vs later

- **v1:** this manual review-and-apply flow — and it stays manual at **every** automation level.
- **Automation never replaces it.** The ladder is transport-only ([Automation ladder, 02c](automation-ladder.md)):
  Auto-sync may *fetch* incoming for you, but Apply is always this deliberate human flow. There is no
  auto-apply path ([ADR 0037](../../../adr/0037-automation-ladder-transport-only.md)); Conflicts and incoming
  deletions are always resolved/confirmed here ([ADR 0008](../../../adr/0008-invariant-ownership.md)).

## Related

- [Commit & push (02b)](commit-and-push.md) — the send counterpart on the same surface.
- [Journey 04 — conflicts](../04-conflicts.md) — the resolver in depth.
- [operation surface](../../screens/operation-surface.md) — the screen this journey drives.
