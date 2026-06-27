# 0039 — state persistence tiers and the unfinished-work rule

> Status: accepted. Generalizes the per-journey persistence calls into one cross-cutting policy.
> Consistent with [ADR 0008](./0008-invariant-ownership.md) (`ConflictModel` owns resolution; never
> lose data silently) and the **never-fail-silently** ground rule (`AGENTS.md`). The cross-env
> conflict checkpoint it codifies was first decided in
> [`user-flow/journeys/04-conflicts.md`](../user-flow/journeys/04-conflicts.md); the adopt re-derive
> in [`journeys/03-second-environment-adopt.md`](../user-flow/journeys/03-second-environment-adopt.md).

**Decision:** dotden classifies everything it might remember across launches into **three tiers**,
and resolves every "the user didn't finish this" case with **one decision rule** — not ad-hoc per
screen. The two principles under it: **a snapshot is never a second source of truth** (only a
restore-or-discard backup), and **dropping work is always visible** (never silent).

This is grounded in prevailing desktop practice (VS Code "Hot Exit" as the lossless-backup gold
standard; Discord's vanishing drafts as the anti-pattern; browser session-restore restoring the
cheap unambiguous layer and treating fine-grained in-page work as best-effort).

---

## The three tiers

| Tier | What it is | Stakes | Mechanism |
|---|---|---|---|
| **1 · View / chrome state** | window bounds + maximized/display; last-selected environment; sidebar width; expanded tree nodes; last route/view | low — a stale restore is mild annoyance | `electron-window-state` (+ display-bounds clamp); renderer **zustand `persist`** (view state); **electron-store** (app-level "what was open") |
| **2 · Preferences** | user settings | low | **electron-store** — with `migrations` + JSON-schema from day one |
| **3 · In-progress work** | a half-finished *action*: a resolving conflict, a half-typed Commit message, a partly-filled setup flow | **high — a wrong restore is worse than no restore** | see the unfinished-work rule below |

Tier 1 and Tier 2 persist **freely** — they're cheap and low-stakes. The hard category is Tier 3.

## The unfinished-work rule (Tier 3)

Three allowed strategies, picked **top-down** — first match wins:

- **① git-checkpoint.** The work already mutates a **system-of-record** (git / disk / a registry).
  Commit *completed units* into it (`git add` the resolved File); **re-derive** the rest on relaunch;
  the in-flight sub-unit drops. **Never** build a parallel store beside the system-of-record — that's
  the drift / two-truths trap.
- **② backup-snapshot.** No natural system-of-record, but the work is **expensive to recreate** *and*
  **restorable byte-exact**. Keep a **non-destructive backup** (VS Code Hot-Exit model): restore it
  verbatim, or drop it with notice — but it is **never authoritative**, only an editable restore.
- **③ drop-with-notice.** The work is **cheap to redo**, *or* **can't be restored without staleness /
  ambiguity**. Discard it on abandon/relaunch and **surface that you did**. Never Discord-silent.

The decision rule, as a contributor reads it:

> 1. **Already written to a system-of-record?** → **①** git-checkpoint. Stage done units, re-derive
>    the rest, no parallel store.
> 2. **Else — losing it costs real effort *and* it restores byte-exact?** → **②** backup-snapshot
>    (non-destructive, lossless-or-drop-with-notice).
> 3. **Else** (cheap to redo, or can't restore cleanly) → **③** drop-with-notice.

**Two invariants over all three** (the parts that are not negotiable per-surface):

- **A snapshot is never a source of truth.** ② is a restore-or-discard backup; if the world moved on
  (the underlying selection changed, a step's inputs went stale), the authoritative state wins and the
  backup is offered as editable text or discarded — it never overrides reality.
- **A drop is always visible.** Whenever ① or ③ discards in-flight work, the UI says so. Silent loss
  is the failure mode we explicitly reject ([ADR 0008] invariant #2; never-fail-silently).

## Per-surface classification (the authoritative table)

Because dotden is **design-time-complete** (every behavior is journey-mapped before it's built), there
is **no "uncertain" within a mapped surface** — each is classified here, explicitly. "Uncertain" means
exactly one thing: **a surface not yet in this table** (a future feature / contribution shipped before
its persistence is designed). See the fallback below.

| Surface | Strategy | Notes |
|---|---|---|
| **Cross-env conflict resolution** (J04) | **①** git-checkpoint | completed Files `git add`-staged → survive Back/quit/crash; abandoning resets only the in-flight File's hunks; merge state re-derived from git on relaunch |
| **Apply-time uncommitted-edit guard** (J04) | **n/a (not persistence)** | the local edits already live on disk (git is the record); Apply blocks + warns (Commit-first / Discard), it doesn't persist a draft |
| **Adopt reconciliation** (J03) | **①** re-derive | recomputed from git/source state on relaunch; nothing to persist |
| **Commit composer — file selection** | **①** re-derive | the selection is a view over `git status`; recompute, don't persist a stale checkbox set |
| **Commit composer — message draft** | **②** backup-snapshot | genuinely authored, byte-exact restorable; persisted via renderer zustand `persist` (localStorage), `partialize`d to the message + `version`ed; restores as **editable** text, shown with a notice if the selection no longer matches |
| **Onboarding / pick-Workspaces partial selections** | **③** drop-with-notice (+ **①** for view-steps) | setup inputs are the most likely to be stale/invalid on relaunch (un-connected Remote, half-auth'd Provider, files changed on disk); restart the flow and say why. Any step that's a pure view over real state (the Den file scan, git status) is **re-derived**, never snapshotted — so "drop" only ever costs a few clicks |
| **View state** (last environment, tree expansion, sidebar, last route) | **Tier 1** | not unfinished-work; persist freely |
| **Secret migration mid-flight** (J05) | **①** re-derive | no parallel "conversion in progress" store; vault + disk + git are the record. The vault-first, value-preserving Convert order (write vault → confirm → rewrite File → commit; reuse an existing vault item) makes every crash point idempotently recoverable by re-running the scan/Convert at the next Commit — half-written item reused, templated-uncommitted File is a normal `git status` edit. Mapped in [`journeys/05-secrets.md`](../user-flow/journeys/05-secrets.md) |

## Fallback for un-tabled surfaces

A surface that ships **without** a row above defaults to **③ drop-with-notice**. Rationale: the
research is unambiguous that *half-working* persistence (Discord) frustrates users more than honest
non-persistence, and a fragile backup store is the higher-risk failure mode. ③ is the safe landing
until the surface is explicitly designed and tabled. **This is a forward-compatibility guard, not a
runtime hedge** — for any surface we've actually mapped, the table decides, not this fallback.

## Mechanism — and why no local database

Every persistence need resolves to either a system-of-record we already have, or small-enough JSON:

| Need | Mechanism |
|---|---|
| **①** git-checkpoint | git itself (`git add` staged units) + re-derive |
| **②** backup-snapshot (commit-msg draft) | renderer **zustand `persist`** → localStorage, `partialize`d + `version`ed |
| **Tier 1 · view state** | **zustand `persist`** (renderer) + **electron-store** (app-level "what was open") |
| **Tier 1 · window** | **`electron-window-state`** + a display-bounds clamp guard |
| **Tier 2 · preferences** | **electron-store** (migrations + JSON-schema from day one) |

**No local DB (sqlite et al.) in v1 — rejected.** Under this rule every need is either already in a
system-of-record (git/disk) or a few KB of JSON, for which `electron-store` / `zustand persist` is the
boring-correct tool. A DB would only earn a place if dotden grew **large, queryable, relational** local
state — which the rule actively prevents from accreting (no parallel truth; snapshots are tiny
backups). **If that need ever appears, it reopens as its own ADR** — it is not an open question now.

## Consequences

- Every new surface that can be left unfinished **must add a row** to the classification table (or
  inherit the ③ fallback knowingly). "Where does this fit in ADR 0039?" is a valid review question.
- **No parallel persistence store** may shadow a system-of-record (git/disk/registry). Reviewers
  reject a store that duplicates state git already holds.
- A backup-snapshot (②) PR must show the snapshot is **non-authoritative** (restore-or-discard, loses
  to reality) and that a **drop surfaces a notice**. A silent drop is a blocking defect.
- **Boot-critical** persisted files (Tier 1/2) parse defensively: parse-fail → reset-with-notice,
  never a wedged launch. Disposable view state stays in a **different** store from anything resembling
  user work, so "clear state to fix" never risks real data.

## Pitfalls this guards against (from prevailing practice)

- **Off-screen window restore** — saved bounds on a now-disconnected display → clamp to a live one.
- **Stale restored state** — version every persisted schema (electron-store `migrations`, zustand
  `version` + `migrate`); shallow-merge rehydration silently dropping new nested defaults is the
  common variant.
- **Corrupt state file wedging launch** — try/parse/reset-with-notice around any boot-critical file.
- **"Clear state to fix" support burden** — keep boot-critical state minimal and separate from large/
  optional state; never co-locate recoverable user *work* with disposable view state.

[ADR 0008]: ./0008-invariant-ownership.md
