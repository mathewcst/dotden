# Journey — Conflicts

> An incoming change from another environment collides with this machine's version of the same
> File. dotden surfaces it (notification or in-app), the user resolves each colliding hunk in the
> center pane (Keep / Take / Both), and Apply writes the resolved set — recording the resolution so
> every other environment converges without re-conflicting.

|                      |                                                                                                                                                                                                                                                                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Preconditions**    | At least two environments share a Den (so there's a peer to collide with). Auto-sync (or a manual Sync) has fetched an incoming commit. This is the steady-state collision case — distinct from the first-materialization Conflicts of [adopt](03-second-environment-adopt.md).                                                                              |
| **Outcome**          | Every colliding hunk is resolved by an explicit user choice; the resolved set is applied to disk; a **merge commit** records the resolution and (under Auto-sync) pushes — peers fetch it and converge with no re-conflict.                                                                                                                                  |
| **Figma**            | Surfaced via `OSNotification` **Conflict** (`560:1300`) + in-app conflict banner/card on [home](../screens/home.md) (`54:3`). Resolved on the [operation surface](../screens/operation-surface.md) (Apply variant `228:1154`, section `231:1682`): left rail `CONFLICTS · N`, in-center [conflict resolver](../screens/conflict-resolver.md) (`126:1094`, unresolved `126:648` → resolved `129:831`) built from `MergeHunk` (`118:387`). Success: Applied · in-sync `230:1393`.                                                                                                                                   |
| **environment role** | the **receiving** environment — it fetched a peer's change that overlaps its own. Symmetric: any environment can be on either side of a collision.                                                                                                                                                                                                          |
| **v1 status**        | Ships v1 — cross-env Conflict resolver + the apply-time local-edit guard ([scope-v1] "Conflict resolution"; [ADR 0008] / [ADR 0038]).                                                                                                                                                                                                                       |
| **Screens touched**  | [tray / OS notification](../screens/tray-and-notifications.md) → [home](../screens/home.md) (incoming card) → [operation surface](../screens/operation-surface.md) (Apply variant) → [conflict resolver](../screens/conflict-resolver.md) (in-center) → [home](../screens/home.md) (in sync)                                                                  |

> [!NOTE]
> **Source of truth = design + the decisions recorded below.** Where the shipped code differs,
> the code is the bug — see [Enforcement flags](#enforcement-flags) at the end.

## The frame for this whole journey

dotden has **two collision axes**, and this journey covers both — but they are **different
machines** ([ADR 0038]):

1. **Cross-environment Conflict** _(the spine)_ — two environments **Committed** the same File in a
   way git can't auto-merge. This is a **git merge conflict in the source-state repo** (`<<<<<<<`
   markers on the overlapping hunks); non-overlapping edits auto-merge silently and never reach the
   user ([CONTEXT]). Resolved at **pure git, not `chezmoi merge`** — by dotden's **own** in-center
   resolver (Keep / Take / Both), because `chezmoi merge` is an interactive vimdiff tool we can't
   wrap headlessly ([ADR 0038]).
2. **Apply-time local-edit guard** _(the branch)_ — Apply would write an incoming File onto a target
   that has **uncommitted local edits**. dotden does **not** merge or clobber; it **blocks that one
   File with a warning** ([scope-v1]; invariant #2, [ADR 0008]) and offers honest outs. This guard
   is the **reserved socket** where a future **3-way drift merge** ("Resolve…") lands ([roadmap]) —
   the dotden equivalent of `chezmoi merge`, deliberately **not built in v1**.

Both resolution paths flow through one **axis-agnostic owner** — `ConflictModel`, whose
resolved-bytes are unconstructable without an explicit user choice ([ADR 0008]). The merge state
itself **lives in git** (the in-progress merge in the source-state repo), never a parallel dotden
store — so an unresolved conflict is **re-derived from git** on relaunch, and **completed files are
checkpointed by git staging**, not by a side database.

## The flow

### 0. Detection — Auto-sync fetches a colliding change

Auto-sync is **transport-only** ([ADR 0037]): it **pushes** your commits and **fetches + notifies**
about incoming ones, but **never writes** your working tree. When a fetched commit overlaps your own
commit on the same File, the **git merge in the source-state repo conflicts** — Auto-sync can't
resolve it, so it **surfaces** it. This is the reference example of dotden's two notification
surfaces ([states/banners], [tray-and-notifications]):

- **Window closed / unfocused** → the tray poller fires an **OS-level notification**,
  `OSNotification` **Conflict** (`560:1300`): _"work-laptop changed files that conflict with
  yours."_ The poller is v1 and independent of Auto-sync ([scope-v1]); clicking the notification
  focuses the window and routes into Review & Apply.
- **Window open** → no OS notification (you're already looking); instead an in-app **conflict
  banner** ([states/banners]) + the [home](../screens/home.md) inspector incoming card, whose
  subline already specs `from <env> · N files, N conflict`.

The unresolved merge is **git's own state** in the local source-state repo — nothing dotden-side is
persisted. Relaunch re-presents it; the incoming card still reads `N conflict`.

### 1. Enter Review & Apply — the conflict is presented, not hidden

`Review & Apply` opens the [operation surface](../screens/operation-surface.md) (Apply variant) over
the home body. The left rail (`ChangeList`) splits the incoming set so the user **sees what's at
stake before acting**:

- **`CONFLICTS · N`** — rows flagged `⚠` (`ListRow` `State=Conflict`, `439:1103`).
- **`APPLIES CLEANLY · N`** — the non-colliding incoming Files (default-checked).

**Apply is disabled** while any Conflict is unresolved (standard git — you can't complete a merge
with open conflicts), and once resolved it writes the **full set at once** (no partial clean-apply).
This is the same gate as [home](../screens/home.md) / [receive-and-apply](daily-use/receive-and-apply.md).

### 2. Resolve in-center — per-hunk Keep / Take / Both

Selecting a conflict File turns the center `Diff` into the **[conflict resolver](../screens/conflict-resolver.md)**
(`126:1094`, unresolved `126:648`). Only the **overlapping hunks** carry markers — the rest of the
File auto-merged. Each colliding hunk (`MergeHunk` `118:387`, `Conflict` → `Resolved`) gets three
choices:

- **Keep** _(mine)_ — this environment's version of the hunk.
- **Take** _(theirs)_ — the incoming version.
- **Both** — mine then theirs, written in sequence into the resolved buffer.

Resolution is **per-hunk, completion is per-file**: the File flips to **resolved** (`129:831`) only
when **every** colliding hunk is decided; the surface's count of unresolved Files drives the Apply
gate. A File with no remaining markers is **staged** (`git add`) — see the checkpoint rule below.

> **What "Both" produces, and the editor.** "Both" writes _mine-then-theirs_ deterministically —
> right for additive collisions (two new aliases), not for cases where the correct result is a
> hand-woven blend. Free-form **hand-editing of the resolved buffer** in-center (scope-v1's
> "Open-both", fully realized) is **deferred** ([roadmap]); v1 ships Keep / Take / Both, which
> covers the common collisions. The `ConflictModel` already owns the resolved bytes, so the editor
> is additive when it lands.

> **Abandoning mid-resolution — git is the checkpoint.** Resolution choices are **in-memory over
> git's merge state**; dotden persists **no** parallel resolution store (that would be a second
> truth that can drift from git — the [ADR 0008] / [ADR 0038] anti-pattern). But completing a File
> **stages it** in the source-state repo, and git remembers staged files across app close, crash,
> or `Back/Cancel`. So abandoning loses **only the hunks of the single File you were mid-way
> through** — every **finished** File survives and re-presents already-resolved. `Back/Cancel` with
> any resolution made → confirm Dialog (_"Discard your conflict resolutions?"_). Sub-file, per-hunk
> resume → [roadmap], only if real merges prove big enough to hurt. Home meanwhile surfaces the
> unfinished merge (the incoming card still shows `N conflict`).

### 3. The other axis — Apply hits a File with uncommitted local edits

Distinct from the cross-env Conflict above: you have **uncommitted local edits** on a File the
incoming set also touches. dotden **never** silently merges or clobbers ([ADR 0008] invariant #2);
it **blocks that one File** with a warning and two honest, git-style outs — the rest of the incoming
set still flows:

- **Commit my edits first** — records the local edits into the Den. The File then becomes a normal
  **cross-env Conflict** and routes into the resolver of Step 2. _(Elegant: it upgrades the messy
  disk-drift case into the path we already built, instead of needing new merge UI.)_
- **Discard my edits** — throw away the uncommitted local changes; Apply then writes the incoming
  version cleanly. **Destructive → confirmed.**

This block is the **reserved socket** for a future third option — an in-place **3-way drift merge**
("Resolve…", [roadmap]) — which v1 deliberately omits ([ADR 0038]).

### 4. Apply + converge — record the resolution, push, peers catch up

`Apply` (enabled once every Conflict is resolved) does two bundled things, then transport carries
the result:

1. **Finalize the merge** — the resolution is committed in the source-state repo as a **merge commit
   with an auto-generated message** (e.g. _"Merge work-laptop into macbook — resolved ~/.zshrc"_).
   **No user-authored message** is required — it's a merge, not a Commit — but it is **recorded in
   File history** so the resolution is auditable (never-fail-silently). An **optional note** on that
   entry is [roadmap].
2. **Write to disk** — `chezmoi apply` writes the resolved Files onto this environment.

Then transport:

- **Auto-sync on** → the merge commit **auto-pushes**; peers fetch it and **converge with no
  re-conflict** (the resolution is in history). This is the whole point — the merge commit carries
  the decision forward.
- **Manual** → it sits as `Not synced · N changes` until `Sync now`.

The surface returns to [home](../screens/home.md) in sync (Applied · in-sync `230:1393`) with a
success `Toast`.

## State transitions

| From                  | Event                                            | To                                                            |
| --------------------- | ------------------------------------------------ | ------------------------------------------------------------ |
| (window closed)       | Auto-sync fetch finds a colliding commit         | `OSNotification` Conflict fires → (click) Review & Apply     |
| (window open)         | same                                             | in-app conflict banner + incoming card `N conflict`          |
| home incoming card    | `Review & Apply`                                 | operation surface (Apply variant), `CONFLICTS · N`           |
| operation surface     | select a conflict File                           | center → conflict resolver (unresolved)                      |
| conflict resolver     | resolve every hunk of a File                     | File `resolved` + **staged** (git add); Apply count −1       |
| conflict resolver     | `Back/Cancel` with resolutions made              | confirm Dialog → discard in-flight File's hunks (staged stay) |
| operation surface     | unresolved Conflicts remain                      | Apply disabled (stay)                                        |
| operation surface     | Apply would hit a File with uncommitted edits    | that File **blocked-with-warning** → Commit-first / Discard  |
| operation surface     | all Conflicts resolved → **Apply**               | merge commit (auto-message) + `chezmoi apply` → applying     |
| applying              | Auto-sync on                                     | merge commit auto-pushes → peers converge → home, in sync    |
| applying              | Manual                                           | `Not synced · N changes` → home (push on `Sync now`)         |
| applying              | Apply fails                                      | failure + fix surfaced, retryable ([journey 06])             |

## Branches & edge cases

- **Only some hunks collide** — the non-overlapping hunks **auto-merge** and never surface; the
  resolver shows only the colliding ones ([CONTEXT]: non-overlapping edits are not Conflicts).
- **Multiple Files conflict** — each is its own row under `CONFLICTS`; Apply is gated until **all**
  are resolved; finished Files are checkpointed by staging as you go (Step 2).
- **Conflict + clean Files in one incoming set** — the clean Files wait (no partial apply); resolving
  the conflicts releases the **whole** set at once.
- **Apply-time uncommitted-edit guard** — the second axis (Step 3): block-with-warning, Commit-first
  (→ resolver) / Discard (confirmed). Not a merge UI in v1.
- **A peer commits again mid-resolution** — a new fetch may change the incoming side; the merge
  re-derives from git on the next status pass. In-flight (unstaged) hunk choices for an affected File
  reset to fresh markers; already-staged Files are unaffected.
- **Quit / crash mid-resolution** — git's in-progress merge + staged resolutions persist; relaunch
  re-presents the unfinished merge from git state ([ADR 0026]-style derive-don't-restore), incoming
  card still `N conflict`.
- **Apply fails after resolving** — failure + fix surfaced + redacted Console row; the merge commit
  is not pushed until Apply succeeds; retry ([journey 06]).
- **Offline at Apply** — Apply (local write + local merge commit) can proceed; the **push** queues
  and flushes on reconnect ([journey 06]); peers converge once it lands.
- **Secret inside a conflicting File** — routes through the [secrets journey](05-secrets.md) before
  that File applies.
- **Incoming deletion that conflicts** — deletions are first-class and **never applied without
  explicit confirmation** ([ADR 0008] invariant #4); surfaced, not silent.

## What's v1 vs later

- **v1:** cross-env Conflict resolver (per-hunk Keep / Take / Both, per-file completion, Apply gate);
  git-staging checkpoint of completed Files; the apply-time **local-edit guard** (block-with-warning
  → Commit-first / Discard); merge commit with auto-generated message recorded in File history;
  Auto-sync push → peer convergence; OS-notification + in-app banner surfacing.
- **Later / deferred** ([roadmap]): free-form **hand-edit of the merged buffer**; **3-way drift
  merge** ("Resolve…") on the apply-time guard (the `chezmoi merge` axis, [ADR 0038]); **sub-file /
  per-hunk resume** across an abandon; **optional note** on a resolution history entry.

## Enforcement flags

> What the design or code must change to match this spec. These are bugs/gaps, not open questions.

1. **Two collision axes, two distinct surfaces.** The cross-env **Conflict** (resolver) and the
   apply-time **uncommitted-local-edit guard** are different responses and must look different. The
   guard's **block-with-warning + Commit-first / Discard** state likely has **no design home** yet —
   add it to the operation surface (Apply variant). Do **not** route it into the merge resolver.
2. **Axis-agnostic `ConflictModel`.** Both resolution paths must flow through one owner whose
   resolved-bytes are unconstructable without a user choice ([ADR 0008]), built so a future **3-way**
   (destination · source · target) input is **additive** ([ADR 0038] / [roadmap]) — not a second
   engine bolted on later. Code concern; verify the type is merge-source-agnostic from day one.
3. **git-staging as the resolution checkpoint.** Completing a File must `git add` it so progress
   survives `Back/Cancel` / quit / crash; abandoning resets **only** the single in-flight File's
   hunks. No parallel dotden resolution store (it would drift from git). Code concern.
4. **Merge commit = auto-message, recorded in history.** Resolving + Apply must create a **merge
   commit with an auto-generated message** (no required user message) that appears in **File
   history**. Verify the history surface renders merge/resolution entries.
5. **OS notification wiring.** `OSNotification` **Conflict** (`560:1300`) must fire from the tray
   poller when the window is **closed/unfocused** and **route to Review & Apply** on click; when the
   window is **open**, suppress the OS notification in favor of the in-app conflict banner + incoming
   card. This journey is the reference for the OS-notification-vs-banner rule ([states/banners],
   [tray-and-notifications]).
6. **No `chezmoi merge`.** No code path may shell out to `chezmoi merge` (interactive vimdiff) for
   either axis ([ADR 0038]); cross-env merge is pure git + `ConflictModel`, the drift axis is the
   deferred in-app 3-way. Review-discipline flag.

## Related

- The surface this happens on: [operation surface](../screens/operation-surface.md) (Apply variant) ·
  the in-center [conflict resolver](../screens/conflict-resolver.md) · entry from
  [home](../screens/home.md).
- First-materialization Conflicts (adopt's bucket 1): [second environment](03-second-environment-adopt.md).
- Steady-state receive that this branches off: [receive & apply](daily-use/receive-and-apply.md).
- Notification surfaces: [tray & notifications](../screens/tray-and-notifications.md), [banners](../states/banners.md).
- Deferred work: [roadmap] (manual merge editor, 3-way drift merge, per-hunk resume, resolution note).
- Decisions: [ADR 0008] (conflict invariant / `ConflictModel` ownership), [ADR 0038] (chezmoi a
  tool, not a wrapper — own merge, no `chezmoi merge`), [ADR 0006] + [ADR 0037] (transport / Auto-sync),
  [scope-v1] (conflict-resolution scope).

<!-- Link reference definitions -->

[ADR 0006]: ../../adr/0006-sync-model-transport-not-commit.md
[ADR 0008]: ../../adr/0008-invariant-ownership.md
[ADR 0026]: ../../adr/0026-launch-routing-derives-entry-screen-from-registration-state.md
[ADR 0037]: ../../adr/0037-automation-ladder-transport-only.md
[ADR 0038]: ../../adr/0038-chezmoi-as-a-tool-not-a-faithful-wrapper.md
[CONTEXT]: ../../../CONTEXT.md
[scope-v1]: ../../scope-v1.md
[roadmap]: ../../roadmap.md
[states/banners]: ../states/banners.md
[tray-and-notifications]: ../screens/tray-and-notifications.md
[journey 06]: 06-errors-offline-diagnostics.md
