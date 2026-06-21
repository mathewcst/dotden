# Journey — Second environment (adopt)

> A user who already has a Den installs dotden on a **second machine**, connects the existing
> Remote, claims an identity, picks which Workspaces this machine subscribes to, and resolves
> every incoming File — applying the Den onto this OS — before they're allowed into the app.

| | |
|---|---|
| **Preconditions** | App installed; chezmoi + git bundled ([ADR 0001]). A Den already exists on the Remote (authored by environment #1 — or any prior environment). User has git credentials that can clone it. This machine may already carry its own dotfiles. |
| **Outcome** | This environment is registered into the Den's **synced registry**; the subscribed Workspaces are materialized onto this OS (clean Applies + resolved Conflicts); the registration is pushed; Auto-sync is on; the user is in the app. |
| **Figma** | Page `05 · Screens — Returning` (`210:4`), section **"Second environment"** (`221:331`). Wizard: `ReturningMenu/V1` (`619:1462`) + `OBContent/ConnectURL` (`607:1309`, "Welcome back" override) · `OBContent/FoundDen` · `OBContent/PickWorkspaces` (`371:980`). Apply handoff: section **"Returning · Review & Apply"** (`231:1682`) — Review & Apply `228:1153`, Applied · in-sync `230:1392`. Full visual spec: [returning-environment](../../design-system/screens/returning-environment.md). |
| **environment role** | the **adopting** environment (#2…N). It *receives* the whole Den for the first time; it never *sends* until after it's registered. |
| **v1 status** | Ships v1 (the has-Den fork of the shared connect seam, [ADR 0020] / [ADR 0022]). |
| **Screens touched** | boot → [connect](../screens/returning/connect.md) → [found Den](../screens/returning/found-den.md) (claim) → [pick Workspaces](../screens/returning/pick-workspaces.md) → [Review & Apply](../screens/operation-surface.md) (adopt variant) → [done / in sync](../screens/returning/done.md) → [home](../screens/home.md) |

> [!NOTE]
> **Source of truth = design + the decisions recorded below.** Where the shipped code differs,
> the code is the bug — see [Enforcement flags](#enforcement-flags) at the end.

## The frame for this whole journey

Adopting is **not** "clone and dump files on disk." It's a **forced reconciliation**: dotden
diffs the **existing Den** (its synced registry + managed file set) against **this environment**
(this OS + what's already on local disk), sorts every File into buckets, and **will not let the
user into the app until every File is decided**. The reconciliation is **derived in memory and
recomputed — never restored — on relaunch**; there is no bespoke "onboarding store." The single
locally-persisted truth is this environment's **own identity (random ID + label)** plus a
**registration-complete flag**, which is exactly what launch-routing keys on ([ADR 0026]): no
pushed registry entry ⇒ launch routes back into this wizard ⇒ the reconciliation recomputes.

Peers see **nothing** until registration completes — so a half-finished adopt leaves **no ghost**
in the shared registry.

## The flow

### 0. Boot, then the shared connect seam

Boot is identical to [journey 01](01-first-install-and-first-den.md#0-boot--preparing-dotden).
**Connect** is the *same* provider-agnostic paste-URL + `git ls-remote` preflight + clone screen
([ADR 0020]) — first and second environment share one seam. The flows fork **after clone, by repo
content**: an empty repo → first-run Discover; a repo that **already has a Den** → this journey.
The Connect screen carries the **"Welcome back"** copy override (`OBContent/ConnectURL` `607:1309`).

- **Fallbacks** — auth failure → credential-error state (retry); offline → `ls-remote` fails fast
  ([journey 06]); the empty-repo case is *not* this journey (it's [01]).

### 1. Found Den — claim an identity *(`OBContent/FoundDen`)*

After clone, dotden detects the existing Den and asks **who this machine is**. Two choices, with a
deliberate default:

- **Set up as a new environment** *(default)* — mint a fresh **stable random ID**, label prefilled
  from hostname (editable). Continues to **Pick Workspaces** (Step 2).
- **Reclaim an existing environment** *(secondary)* — for a reinstall / re-image of a machine
  already in the Den. Selecting it **reveals the registry list** (per row: label · OS · last
  synced). Reclaiming **inherits that entry's label + Workspace subscriptions**, so it **skips
  Step 2** and goes straight to Review & Apply.

**Reclaim safety (never-silent).** Each registry row shows **liveness** from its last-synced
timestamp:

- An entry that **synced recently** (inside the freshness window) is flagged
  **"⚠ Looks active — last synced 4m ago"**. It's still selectable, but confirming opens a Dialog:
  *"work-laptop synced 4 minutes ago and may still be running. Reclaiming its identity here can
  corrupt sync between the two machines. Reclaim anyway?"* — **Keep separate** (default; mints a new
  identity instead) / **Reclaim anyway**.
- An entry **quiet past the window** (the genuine dead-machine case) reclaims **without friction**.

We **never hard-block** a reclaim — the user may know the old machine is truly gone even if it
synced moments before it died. We surface the risk + the safe default and let them override.

### 2. Pick Workspaces — what this machine subscribes to *(`OBContent/PickWorkspaces`)*

The new environment chooses its **Workspace subscriptions**. An unsubscribed Workspace is not
hidden-but-present — it is **never materialized** on this machine ([CONTEXT]: an environment
"applies only Files and Folders inside" its subscribed Workspaces).

- **Default: all checked.** The common case is "I want my whole Den here"; opting *out* of `Work`
  on a personal laptop is the deliberate exception. Symmetric with how Apply/Commit default-all.
- **One Workspace only → skip this screen.** Never show a one-row checklist; auto-subscribe and go
  straight to Review & Apply.
- **Changeable later.** Subscriptions are editable post-adopt in **Settings → Environments**
  (this env's row). **Subscribe-later** (v1) materializes the newly-included Files via an Apply;
  **unsubscribe-later** (a confirmed, this-environment-scoped removal of local files) may **defer**
  to roadmap — but the at-adopt pick is always present.

Rows are `SelectRow` instances (checkbox `Lead` + Name/Meta). Continue → Review & Apply.

### 3. Review & Apply — the four-bucket reconciliation *(adopt variant of the [operation surface](../screens/operation-surface.md))*

This reuses the **same operation surface** as [receive-and-apply](daily-use/receive-and-apply.md) —
`ChangeList | Diff | OperationPanel` — relabeled for the first materialization
("73 incoming · first sync"). There is **no separate adopt/merge engine**; adopt is a (potentially
large) reviewed Apply with first-class conflict resolution.

Every in-Scope File for this OS lands in one of **four buckets**, decided by
*(Scope? · does a Placement resolve on this OS? · local file exists?)*:

1. **Conflicts** — in-Scope, Placement resolves here, **a local file already exists**. This is the
   *dominant* shape of adopt (a real second machine already has its own `~/.zshrc`,
   `~/.gitconfig`). Each routes to the in-center [conflict resolver](../screens/conflict-resolver.md)
   (Keep / Take / Both). **Apply is gated until every Conflict is resolved** — same invariant as
   home/receive ([ADR 0008]); Conflicts are never auto-resolved.
2. **Applies cleanly** — in-Scope, Placement resolves, no local file → **default-checked Apply**.
   You may still **Skip** an individual File to defer it.
3. **Needs a path** *(path-incompatible)* — in-Scope, **but** the File carries explicit per-OS
   **Placement** overrides and **none covers this OS**, so dotden genuinely doesn't know where to
   land it. Surfaced per-File (never silent), two actions:
   - **Set a path** → add this OS's Placement → the File drops into bucket 1 or 2. *(This is the
     "move my Ubuntu `.zshrc` to Windows" case: **same shared content, different per-OS path** —
     the content is what you want; you just tell it where it lands.)*
   - **Don't pull** → records a **Scope-exclude for this environment** so it's never re-nagged.
4. **Other systems only** — already Scope-excluded for this OS (e.g. a macOS-only Homebrew bundle on
   a Linux box) → a **quiet, collapsed, expandable** disclosure ("N Files apply only on macOS /
   Windows"). Never hidden (never-silent), never noisy actionable rows; not in the Apply set.

> **The bucket-3 trigger, precisely.** A File on the **default `$HOME`-relative Placement resolves
> on every OS** (`~/.zshrc` lands fine on Windows too — path differs, content is what you want), so
> it stays in bucket 1/2. Bucket 3 fires **only** when a File has explicit per-OS Placement
> overrides and this new OS isn't among them.

> **Scope vs Placement vs content.** Adopt resolves **Placement (path)** inline. **Scope** (whether
> a File applies on this OS) is set by "Don't pull". Per-OS **content** divergence (templating) is a
> **separate, deferred** concept ([roadmap]) — if a File genuinely needs *different contents* here,
> adopt does not solve that; you get the shared content.

**The completeness gate.** "Every File must be *set*" = **no File left undecided**: every
**Conflict** resolved and every **Needs-a-path** File dispositioned (set-path *or* ignore). Buckets
2 and 4 carry valid defaults, so they don't block. The surface shows a running **"N items still
need you"** counter, and **Apply is disabled until it hits zero** — you cannot slide into the app
with an ambiguous Den.

### 4. Done / in sync — registration completes *(Applied · in-sync `230:1392`)*

There are **two gates**, in order:

1. **All-dispositioned → Apply enabled.** Running Apply writes the clean Files + resolved Conflicts
   to disk (`chezmoi apply`).
2. **Apply + Sync succeeds → registration completes.** This is the moment this environment becomes
   **visible to peers**: the env entry (ID, label, OS, subscriptions) **plus all Placement-adds and
   Scope-excludes** are committed and **pushed in one Sync**; the **registration-complete flag**
   flips; the user enters the app.

**Auto-sync on by default.** Adopt ends like [journey 01] — Auto-sync is the **default-selected**
automation level ([ADR 0037]), not a silent force-on. The second environment is the whole *point*
of Auto-sync (now there are ≥2 machines to keep in sync). Droppable to Manual here or later in
Settings → Automation.

The success state ([returning-environment](../../design-system/screens/returning-environment.md))
reads **"Up to date · 73 files applied · Auto-sync on"**, a success `Toast` confirms
("Applied 73 files · Auto-sync is on · this-mac up to date"), and the user lands on
[home](../screens/home.md).

## State transitions

| From | Event | To |
|---|---|---|
| Connect (Welcome back) | clone → repo has a Den | Found Den (claim) |
| Found Den | "new environment" | Pick Workspaces |
| Found Den | "reclaim" → pick entry (inherits subs) | Review & Apply (skips Pick Workspaces) |
| Found Den | reclaim a *live*-looking entry | warn Dialog → Keep separate (new id) / Reclaim anyway |
| Pick Workspaces | continue (≥1 Workspace) | Review & Apply |
| Pick Workspaces | Den has exactly 1 Workspace | *(screen skipped)* → Review & Apply |
| Review & Apply | "N items still need you" > 0 | Apply disabled (stay) |
| Review & Apply | all dispositioned → **Apply** | applying → (gate 2) |
| applying | Apply + Sync succeed | registration pushed → Done / in sync → **home** |
| applying | Apply fails | stay in wizard, retryable ([journey 06]) |
| any wizard step | quit before gate 2 | no registry entry pushed; relaunch recomputes & resumes ([ADR 0026]) |

## Branches & edge cases

- **Machine already has its own dotfiles** → the *expected* case, surfaced as **Conflicts** (bucket
  1), resolved in-center. Not an error.
- **Adopting onto a brand-new OS** (Den's first Linux box, say) → Files with default Placement apply
  cleanly; Files with foreign-OS-only Placement overrides surface in **bucket 3** (set a path /
  don't pull).
- **Reclaim of a still-live entry** → warn + safe default (Keep separate), overridable. See Step 1.
- **New File appears in the Den mid-wizard** (a peer commits while you adopt) → the in-memory
  reconciliation **recomputes** on the next on-demand status pass (focus / action, per
  [02b](daily-use/commit-and-push.md)) and the new File joins the buckets; the completeness counter
  reflects it before Apply is allowed.
- **Quit mid-wizard** → nothing pushed; no ghost in the registry; next boot finds
  cloned-but-unregistered and **resumes the wizard** by recomputing the diff ([ADR 0026]).
- **Apply fails after dispositioning** → the surface shows the failure + the fix and a redacted
  Console row; the user stays in the wizard and retries ([journey 06]). Registration does **not**
  complete on a failed Apply.
- **Offline at Apply/Sync** → Apply (local write) can proceed; the registration **push** queues and
  flushes on reconnect ([journey 06]). The flag flips only once the push lands.
- **Secret detected** in an incoming File during adopt → routes through the
  [secrets journey](05-secrets.md) before that File applies.

## What's v1 vs later

- **v1:** the has-Den fork of the shared connect seam; claim (new / reclaim with liveness warning);
  Workspace subscription (default-all, skip-when-one, subscribe-later); the four-bucket reviewed
  Apply with in-center conflict resolution and the completeness gate; per-File **Placement** set at
  adopt; Auto-sync default on.
- **v1.1 / deferred:** **unsubscribe-later** (this-environment-scoped local deletion) may defer to
  [roadmap]; per-OS **content** divergence (templating) is a separate deferred concept; OAuth /
  one-click clone conveniences ([ADR 0020]).

## Enforcement flags

> What the design or code must change to match this spec. These are bugs/gaps, not open questions.

1. **Four-bucket Apply list.** The DS Review & Apply screen (`228:1153`) groups **CONFLICTS /
   APPLIES CLEANLY** only. It must also express **"Needs a path"** (bucket 3, with per-File **Set a
   path** / **Don't pull**) and a **collapsed "Other systems only"** disclosure (bucket 4). Today
   these buckets have no visual home.
2. **Completeness counter + gated Apply.** The surface must render a running **"N items still need
   you"** count and **disable Apply until zero**. Not currently in the design.
3. **Reclaim liveness flag.** `OBContent/FoundDen`'s reclaim list must show **per-row last-synced /
   "Looks active"** and the **Keep-separate-vs-Reclaim-anyway** warning Dialog. Confirm the design
   models the registry list at all (the spec adds it).
4. **Skip Pick-Workspaces when one Workspace** (and when reclaiming, which inherits subscriptions) —
   the wizard must branch, not always show `OBContent/PickWorkspaces`.
5. **Registration sequencing.** No registry entry may be **pushed** before a successful Apply + Sync;
   the **registration-complete flag** is the launch-routing key ([ADR 0026]). Verify the code does
   not write a shared registry entry at claim time.

## Related

- Mirror flow on machine 1: [first install → first Den](01-first-install-and-first-den.md).
- Reused surfaces: [operation surface](../screens/operation-surface.md) (adopt = Apply variant) ·
  [conflict resolver](../screens/conflict-resolver.md) · [home](../screens/home.md).
- Visual spec: [returning-environment](../../design-system/screens/returning-environment.md).
- Next once in the app: [daily use](02-daily-use.md).
- Decisions: [ADR 0026] (routing / registration gate), [ADR 0020] (shared connect seam),
  [ADR 0022] (has-Den fork), [ADR 0024] (synced registry / data boundary), [ADR 0006] +
  [ADR 0037] (transport + Auto-sync default), [ADR 0008] (conflict invariant).

<!-- Link reference definitions -->
[ADR 0001]: ../../adr/0001-pure-git-github-no-backend.md
[ADR 0006]: ../../adr/0006-sync-model-transport-not-commit.md
[ADR 0008]: ../../adr/0008-invariant-ownership.md
[ADR 0020]: ../../adr/0020-provider-agnostic-pure-git-floor-v1-lean-auth.md
[ADR 0022]: ../../adr/0022-onboarding-gate-is-feature-detection-not-emptiness.md
[ADR 0024]: ../../adr/0024-synced-vs-local-data-architecture.md
[ADR 0026]: ../../adr/0026-launch-routing-derives-entry-screen-from-registration-state.md
[ADR 0037]: ../../adr/0037-automation-ladder-transport-only.md
[CONTEXT]: ../../../CONTEXT.md
[roadmap]: ../../roadmap.md
[journey 01]: 01-first-install-and-first-den.md
[journey 06]: 06-errors-offline-diagnostics.md
[never fail silently]: ../../adr/0008-invariant-ownership.md
