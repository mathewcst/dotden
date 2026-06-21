# Journey — Daily use · Commit & push (02b)

> The user edited a tracked file on this environment; they record those edits into the Den (**Commit**)
> and share them (**push via Sync**). The send counterpart to [Receive & Apply (02a)](receive-and-apply.md).

Part of [Daily use](../02-daily-use.md). This is the **send** half (role A). The **receive** half is
[Receive & Apply (02a)](receive-and-apply.md); automation that can push for you is the
[Automation ladder (02c)](automation-ladder.md).

| | |
|---|---|
| **Preconditions** | A tracked File/Folder was edited on this environment (edit happens *outside* dotden, in the user's own editor) |
| **Outcome** | The chosen edits are Committed into the Den; on Sync they're pushed to the Remote and the environment is back in sync |
| **environment role** | A (send / Commit + push) |
| **v1 status** | ships v1 (Commit always manual; push manual under Manual, automatic under Auto-sync — [02c](automation-ladder.md)) |
| **Screens touched** | [home](../../screens/home.md), [operation surface](../../screens/operation-surface.md) (Commit variant), [titlebar & status bar](../../screens/titlebar-statusbar.md) |

## The flow

1. **Edit detected** — the user changed a tracked File in their editor. dotden recomputes local status
   (`chezmoi status`) on **app launch, window focus, after any user action, and a light interval while
   focused** — **no persistent file-watcher** (detection samples on natural attention boundaries; it never
   acts on a watched file — that grain comes from [02c](automation-ladder.md)). The changed rows light up in
   the [home](../../screens/home.md) tree (`● modified` / `● added`), and the header surfaces
   **`Commit changes`**. Nothing is recorded yet.
2. **Open Commit** — user clicks **`Commit changes`** → the
   [operation surface](../../screens/operation-surface.md) (**Commit** variant) slides up over the home body
   ([`operation-surface`](../../motion.md#operation-surface)): left rail = changed `ChangeList`
   (`● N modified · ● N added`), center = uncommitted `Diff`, right rail = **Commit composer**.
3. **Triage the set** — default is **commit everything**; each row can be **unchecked to defer it** (symmetric
   with Apply's `Skip`). Unchecked files stay `modified`/uncommitted in the tree for a later Commit. Selecting a
   row shows its `Uncommitted changes` diff (orange `● modified` dot; stacked/side-by-side toggle).
   **No hunk-level staging** — selection is per-File (chezmoi's path-level model).
4. **Compose & Commit** — the composer's `Message` is **prefilled from the template**
   (`[macos-sync-2026-06-14]`, [Settings → Commit](../../screens/settings/commit.md)); editable, with
   `Edit template`. Primary **`Commit changes`** records the included set into the Den
   (`api.den.commit(...)` → `chezmoi add`/`re-add` the paths + one `git commit`). The Commit is **local** —
   it has not left the environment yet.
5. **Back home — `Not synced`** — the surface dismisses; committed rows clear from the changed set; the
   [status bar](../../screens/titlebar-statusbar.md) shows **`Not synced · N changes`** (the mirror of
   `Synced · <time> ago`) — your edits are safely recorded locally but not yet shared.
6. **Push** — how step 5 resolves depends on the [automation level](automation-ladder.md):
   - **Manual** *(honest two-step)* — the user pushes with **`Sync now`** (status bar / tray). Sync is
     transport ([ADR 0006](../../../adr/0006-sync-model-transport-not-commit.md)) — it pushes the Commit and
     fetches incoming, nothing more. Status bar → `Syncing…` → `Synced · just now`.
   - **Auto-sync** *(the default)* — the Commit **event** triggers an automatic push ([02c](automation-ladder.md));
     `Not synced` is transient (shown only while the push is in flight), then `Synced · just now`. No `Sync now`
     click needed.

   Either way **Commit and push are independent**: push never re-opens or rolls back a Commit; it only
   transports what's already recorded.

## State transitions

| Step | route / mode | local status | sync state |
|---|---|---|---|
| 1 edit detected | `home` | N uncommitted | `Synced · <time> ago` |
| 2–4 compose | `operation:commit` (over home) | N uncommitted (pending) | unchanged |
| 4 commit | `home` | 0 uncommitted (committed) | `Not synced · N changes` |
| 6 push (Manual `Sync now` / Auto-sync auto) | `home` | 0 | `Syncing…` → `Synced · just now` |

Governed by [ADR 0026](../../../adr/0026-launch-routing-derives-entry-screen-from-registration-state.md)
(routing) and the scoped den-session store
([ADR 0027](../../../adr/0027-renderer-feature-folders-and-scoped-den-session-store.md)).

## Branches & edge cases

- **Nothing changed** — `Commit changes` isn't offered (the home affordance simply isn't shown); the Commit
  surface is unreachable with an empty set.
- **Deferred files** — unchecked rows aren't recorded; they stay `modified`/uncommitted and reappear in the
  next Commit set.
- **Offline** — Commit records locally fine (it's a local `git commit`); the **push** is what defers. State
  holds at `Not synced · N changes`; `Sync now` retries (or Auto-sync's push fires) on reconnect — see
  [journey 06](../06-errors-offline-diagnostics.md). Never-fail-silently: the unsynced state is visible, not
  swallowed.
- **Commit succeeds, push fails** — the Commit is **not lost** (they're independent); state stays
  `Not synced`, the failure + fix surface where the push was triggered, a Console row captures the redacted
  output, and `Retry` is offered ([titlebar-statusbar](../../screens/titlebar-statusbar.md#fallbacks-never-fail-silently)).
- **Secret detected at Commit** — the commit-time scanner flags an obvious secret and offers to convert it to
  a **Secret reference** before recording (see [scope-v1](../../../scope-v1.md) "Secrets" / journey 05). The
  value stays in the user's vault; only the reference is Committed.
- **Back / Cancel mid-compose** — discards the operation (confirm if a message was typed or the set edited);
  nothing is recorded, the tree is untouched.

## What's v1 vs later

- **v1:** this manual Commit flow (default-all, per-File defer) + manual or Auto-sync push.
- **Commit is always a deliberate human action** — there is **no auto-Commit** at any level (the file-watcher
  auto-Commit was YOLO, removed — [ADR 0037](../../../adr/0037-automation-ladder-transport-only.md)). Automation
  only ever **pushes** what you chose to Commit.
- **Hunk-level staging** (`git add -p` feel) is deferred — chezmoi's model is path-level; per-File covers the
  real "don't commit my half-done edit" need. → [roadmap](../../../roadmap.md) if ever.

## Related

- [Receive & Apply (02a)](receive-and-apply.md) — the receive counterpart on the same surface.
- [Automation ladder (02c)](automation-ladder.md) — what makes the push (step 6) automatic.
- [operation surface](../../screens/operation-surface.md) (Commit variant) — the screen this journey drives.
- Glossary: [`CONTEXT.md`](../../../../CONTEXT.md) (Commit / Sync / Auto-sync).
