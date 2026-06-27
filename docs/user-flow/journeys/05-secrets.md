# Journey — Secrets

> A secret (an API key, token, private key) is about to enter the Den. dotden catches it **at the
> door** — at Commit, before it ever leaves the environment that owns the raw value — and offers a
> non-destructive remedy: convert it into a **Secret reference** that lives in the user's password
> manager, so only an `op://…`-style pointer syncs. Every other environment then **resolves that
> reference from its own vault** at Apply. The raw secret is never committed unless the user
> explicitly chooses to.

|                      |                                                                                                                                                                                                                                                                                                                                                                                                                          |
| -------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **Preconditions**    | A tracked File about to be Committed contains content the scanner flags as a likely secret. For the apply-side act, at least one peer environment subscribes to the Workspace holding a File that carries a Secret reference.                                                                                                                                                                                               |
| **Outcome**          | The raw secret never enters the Den unless the user **explicitly** Commits it anyway. On Convert, the value lands in the user's vault and only an `op://…` **Secret reference** syncs; every subscribing environment materializes the real File by resolving that reference from its own vault at Apply, or is **guided to fix** a missing/locked vault — never handed a placeholder file, never failed silently.            |
| **Figma**            | `Secret & errors` SECTION (`343:5185`) on `05 · Screens — App`. Step 1 `SecretWarning` (`341:1184`) on screen `343:5243`; step 2 `SecretPicker` (`353:1207`) on screen `354:6937`; both over scrim-dimmed [home](../screens/home.md) (`54:3`). Apply-side resolution failure reuses the **Apply failed — retry** surface (`360:6720`) with `ListRow` Error rows (`439:1103`). See [secret detection & references](../../design-system/screens/secret-and-errors.md).                                                                                |
| **environment role** | Two roles across the transport seam — the **authoring** environment (owns the raw value; detects + converts at Commit) and every **receiving** environment (resolves the reference from its own vault at Apply). Symmetric: any environment can be on either side.                                                                                                                                                          |
| **v1 status**        | Ships v1 — commit-time scan, **soft-warn** (not block), Convert-to-Secret-reference via a full multi-manager picker (1Password / Bitwarden / `pass`), per-file synced allowlist, apply-side resolution + guided fix. ([scope-v1] "Secrets"; [ADR 0038] PM bridge is chezmoi's; [ADR 0024] allowlist is synced metadata; [ADR 0039] mid-flight = ① re-derive.)                                                                |
| **Screens touched**  | [home](../screens/home.md) (Commit) → [secret detection](../../design-system/screens/secret-and-errors.md) step 1 `SecretWarning` → step 2 `SecretPicker` (Convert path) → [home](../screens/home.md) (committed, in sync). Apply side: [operation surface](../screens/operation-surface.md) (Apply variant) → guided-fix / [apply-failure](06-errors-offline-diagnostics.md) on a missing/locked vault.                                       |

> [!NOTE]
> **Source of truth = design + the decisions recorded below.** Where the shipped code differs,
> the code is the bug — see [Enforcement flags](#enforcement-flags) at the end.

## The frame for this whole journey

Secrets split across dotden's **transport seam** the same way Commit and Apply do — so this journey
has **two acts**, and the seam is its spine:

1. **Act 1 — catch it at the door** _(commit-side, the authoring environment)._ The scan runs **at
   Commit** — the egress gate, the one moment the raw value is present and Convert is even possible.
   It **warns, never blocks** ([scope-v1]): the user either **Converts** (raw value → vault, only the
   reference enters the Den) or **Commits anyway** (an explicit, recorded choice). The raw secret
   **never leaves the environment** except by that deliberate act.
2. **Act 2 — resolve on arrival** _(apply-side, every receiving environment)._ The synced `op://…`
   reference is inert text until an environment **resolves it from its own vault** at Apply. dotden
   holds no credentials (V1-Lean, [ADR 0020]) — the password-manager **CLI** owns auth — so a
   receiving environment that lacks the CLI or has a locked vault is **guided to fix it**, never
   handed a File containing the literal placeholder.

A **Secret reference** is a chezmoi template resolving an `op://vault/item/field`-style pointer at
Apply ([CONTEXT], [ADR 0038]). This is the **one narrow, guided slice of chezmoi templating** v1
exposes; general templating stays hidden ([scope-v1]). The PM bridge and resolution are **chezmoi's**
— dotden owns the *detection*, the *two-step decision UX*, and the *guided-fix* on the receiving side
([ADR 0038]).

## Act 1 — catch it at the door (commit-side)

### 0. Detection — the scan is the Commit gate

The scanner runs **at Commit only** — the single authoritative gate, because Commit is the egress
point and the only place the raw value still exists to be converted. **Not** at Track-time (nothing
is committed yet) and **not** re-run at Apply (Act 2 has nothing to convert — the value already left
its owning environment). The detector favors **high-precision patterns** (AWS keys, `BEGIN … PRIVATE
KEY` blocks, common token shapes) tuned for a **low false-positive rate**, with the per-file
allowlist (below) as the escape hatch.

When a staged File trips the scanner, Commit **pauses** and surfaces step 1 over the scrim-dimmed
home — the secret is caught **before** it enters the Den, so the home inspector's "Secrets" readout
stays honest.

### 1. Step 1 — `SecretWarning`: decide (warn, never block)

`SecretWarning` (`341:1184`) is **warn-amber, not destructive-red** — catching a secret is a caution
and the remedy is non-destructive ([secret-and-errors] functional-color discipline). It shows the
file path, the **kind + line** ("AWS Access Key ID · line 3"), and a **masked value**
(`AKIA••••••••••••N7QX`) so the user confirms *what* was flagged without re-exposing it. One
mutually-exclusive choice:

- **Convert to a Secret reference** _(default)_ → step 2.
- **Commit the secret anyway** → with a **"Don't warn me about this file again"** checkbox: the
  per-environment **"sync anyway" allowlist** decision — **file-scoped**, synced metadata
  ([ADR 0024]), **not** a global kill-switch for the scanner.

Continue → step 2 (Convert) or the commit (Commit-anyway). Cancel aborts the Commit; nothing is
mutated.

### 2. Step 2 — `SecretPicker`: pick where (Convert path only)

`SecretPicker` (`353:1207`) is **only** the password-manager chooser (split from step 1 because one
modal carrying both *choice* and *picker* was too convoluted — [secret-and-errors]). It lists the
managers with **detected CLI** state — **1Password** (`op`), **Bitwarden** (`bw`), **`pass`** — each
tagged detected / **not found** ("Install `pass` to use this option", disabled). A **"Remember my
choice"** checkbox. Confirm runs the conversion.

### 3. The conversion — vault-first, value-preserving

Convert is **not atomic** — it touches two systems (vault + repo) in a deliberate, recoverable order
([ADR 0039]):

1. **Write** the real value into the vault (`op item create` / `bw create` …) → yields the
   `op://vault/item/field` reference. If an item with that name **already exists**, dotden
   **references the existing item** rather than duplicating it.
2. **Rewrite** the working File: raw value → a chezmoi template referencing that reference. _Only after
   the vault write is confirmed_ — the raw value is **never removed from disk until it is safely in the
   vault**. If the vault write fails, the File is untouched and the user is back at step 1 with the
   secret intact (never-fail-silently).
3. **Commit** the templated File. The **reference**, not the value, enters the Den.

**Mid-flight crash = ① re-derive, no parallel store** ([ADR 0039]). The vault, disk, and git are the
systems of record; the value-preserving + reuse-existing order makes **every** interruption point
idempotently recoverable by re-running the scan/Convert on the next Commit — a half-written vault item
is reused, a templated-but-uncommitted File is just a normal uncommitted edit in `git status`. dotden
persists **no** "conversion in progress" state. The only thing that can drop is an in-flight CLI call,
which is cheap and **re-surfaces at the next Commit** (drop-is-visible by construction).

### 4. Commit completes

The Commit proceeds with the secret either **converted** (reference in the Den, value in the vault) or
**raw** (the user's explicit Commit-anyway choice). Transport carries it as any Commit — Auto-sync
pushes, or it waits for `Sync now` ([ADR 0037]). Home returns to in-sync.

A **raw** secret that got through is **never silent**: it stays passively visible in the File's
**history** and the home inspector's **"Secrets"** readout — discoverable, just not a blocking modal.

## Act 2 — resolve on arrival (apply-side)

### 5. The reference materializes from the receiving vault

On every subscribing environment, the synced `op://…` reference is inert text until **Apply**
resolves it from **that environment's own vault** (the PM CLI executes the template). When the CLI is
present and the vault is unlocked, the File materializes with the real value and Apply is invisible —
secrets "just work" across environments.

### 6. Missing CLI / locked vault — pre-flight + per-file backstop

dotden holds no credentials ([ADR 0020]); the CLI owns auth. A receiving environment that **lacks the
required CLI** or has a **locked / signed-out vault** can't resolve the reference. dotden handles this
**two ways**, never writing the literal `op://…` placeholder to disk:

- **Pre-flight (preferred).** When an incoming set contains Secret-reference Files, dotden checks the
  required CLI is present and the vault reachable **before** applying. If not, it **blocks only those
  Files** with a **guided fix** — *Install the 1Password CLI* / *Sign in* / *Unlock vault* + **Retry**
  — while the rest of the set **applies cleanly** (per-file independence, [ADR 0008] / chezmoi's
  per-path model).
- **Apply-time backstop.** If it slips through, the File lands as a `ListRow` **Error** row
  (`439:1103`) with the OS/CLI reason ("1Password CLI not found", "Not signed in to 1Password") on the
  existing [apply-failure surface](06-errors-offline-diagnostics.md) (`360:6720`) — same **Retry**.

Either way the **whole** Apply is never blocked by one unresolvable reference; the clean Files apply,
the secret File is left **unwritten** with an honest reason and a retry, and **no placeholder is ever
written to disk**.

## State transitions

| From                       | Event                                              | To                                                                |
| -------------------------- | -------------------------------------------------- | ----------------------------------------------------------------- |
| home (Commit)              | scanner flags a likely secret in a staged File     | Commit pauses → `SecretWarning` (step 1) over scrim                |
| `SecretWarning`            | choose **Convert** → Continue                      | `SecretPicker` (step 2)                                            |
| `SecretWarning`            | choose **Commit anyway** (± don't-warn) → Continue | Commit proceeds with **raw** value; allowlist row synced          |
| `SecretWarning`            | Cancel                                             | Commit aborted; nothing mutated                                   |
| `SecretPicker`             | pick manager (CLI detected) → Convert              | vault write → File templated → Commit with the **reference**      |
| `SecretPicker`             | required CLI **not found**                         | option disabled ("Install … to use this option"); pick another / Back |
| conversion                 | vault write fails                                  | File untouched, raw value intact → back at step 1 (never silent)  |
| conversion                 | crash mid-flight                                   | **① re-derive** on relaunch; scan re-fires next Commit; reuse vault item |
| Commit (converted)         | transport                                          | home in sync; only the `op://…` reference in the Den              |
| Commit (raw, anyway)       | transport                                          | raw secret in Den; **passively visible** in history + inspector   |
| peer Apply (ref present)   | CLI present + vault unlocked                       | File materializes from vault; Apply invisible                     |
| peer Apply (ref present)   | CLI missing / vault locked — **pre-flight**        | those Files **blocked-with-guided-fix** (install/sign-in/unlock + Retry); rest applies |
| peer Apply (ref present)   | CLI missing / vault locked — **slips to apply**    | `ListRow` Error + reason on apply-failure surface → Retry         |

## Branches & edge cases

- **False positive.** A flagged File that isn't actually a secret → **Commit anyway** + "Don't warn me
  about this file again". File-scoped, synced ([ADR 0024]); not a global scanner kill-switch.
- **Secret already in the vault.** Convert **references the existing item** (no duplicate) — the Q3
  reuse-on-dup rule.
- **Vault write fails mid-Convert.** File untouched, raw value intact, user returned to step 1 — the
  value is never destroyed before it's safely in the vault.
- **Quit / crash mid-Convert.** ① re-derive ([ADR 0039]): no parallel store; relaunch re-scans at the
  next Commit; a half-written vault item is reused, a templated-uncommitted File is a normal edit.
- **Receiving environment lacks the CLI / vault locked.** Pre-flight guided fix (install / sign-in /
  unlock) + per-file apply-time backstop; the rest of the set applies; no placeholder written (Act 2).
- **Secret inside a conflicting File.** The [conflict](04-conflicts.md) resolves first (Keep / Take /
  Both); the resolved File then passes through this Commit-time gate before it's recorded — a secret in
  a merged hunk is caught like any other.
- **Raw secret arrives from a peer who Committed-anyway.** **No** apply-time re-warn — it was the
  peer's explicit, synced decision; re-nagging every receiver is noise about a fait accompli. It stays
  passively visible (history + inspector), never silent.
- **`pass` / unix managers.** Supported (CLI-detected like the rest); chezmoi already bridges them, so
  others are cheap to add ([scope-v1]).

## What's v1 vs later

- **v1:** commit-time scan (high-precision, low-false-positive); **soft-warn**, never block; two-step
  `SecretWarning` → `SecretPicker`; **Convert** to a Secret reference via the **full multi-manager
  picker** (1Password / Bitwarden / `pass`, CLI-detected); **Commit-anyway** with a file-scoped synced
  allowlist; mid-flight = ① re-derive; apply-side resolution + **pre-flight guided fix** + per-file
  apply-time backstop; raw-committed secrets passively visible in history + inspector.
- **Later / deferred** ([roadmap]): **age encryption** for users who want secrets in-repo without a
  password manager (out-of-band key distribution per environment); richer in-flow migration ergonomics
  and additional managers beyond the v1 set.

## Enforcement flags

> What the design or code must change to match this spec. These are bugs/gaps, not open questions.

1. **Commit-time is the sole scan gate.** The scanner runs at **Commit**, not at Track or Apply. No
   apply-side re-scan / re-warn of incoming raw secrets (the synced allowlist carries the decision).
   Code concern — wire the scan into the Commit path only.
2. **Convert is vault-first and value-preserving.** Order is **vault write → confirm → file rewrite →
   commit**; the raw value is **never removed from disk before the vault write is confirmed**; an
   existing vault item is **reused**, not duplicated. Code concern — verify the ordering + dup-handling.
3. **Mid-flight = ① re-derive, no parallel store** ([ADR 0039]). No "conversion in progress" store may
   shadow vault/disk/git. Relaunch re-derives from the scan + `git status` + vault. This **clears the
   deferred ADR 0039 row** — add the classification row there.
4. **Apply-side guided fix likely has no design home yet** — NET-NEW. The **pre-flight block** for a
   receiving environment with a missing CLI / locked vault (*Install … / Sign in / Unlock* + Retry,
   blocking **only** the affected Files) needs a Figma home; the apply-time backstop reuses the
   existing `ListRow` Error surface (`360:6720`). Add the pre-flight guided-fix state.
5. **Never write the placeholder.** No code path may write a File containing the literal `op://…`
   reference to disk when resolution fails — fail the File with a reason + Retry, apply the rest.
   Review-discipline flag (per-file independence, [ADR 0008]).
6. **Raw-committed secrets stay passively visible.** A Commit-anyway secret must appear in the File's
   history + the home inspector "Secrets" readout — discoverable, not a blocking modal, never silent.
   Verify the inspector/history surfaces render it.

## Related

- The surface this happens on: [secret detection & references](../../design-system/screens/secret-and-errors.md) (the
  two-step modal + apply-failure rows) · entry from [home](../screens/home.md) at Commit · apply side
  on the [operation surface](../screens/operation-surface.md).
- Branches off: [conflicts](04-conflicts.md) (a secret inside a conflicting File) · the apply-failure
  mechanics it reuses live in [errors, offline & diagnostics](06-errors-offline-diagnostics.md).
- Deferred work: [roadmap] (age encryption; richer in-flow migration).
- Decisions: [ADR 0038] (PM bridge + resolution are chezmoi's; dotden owns detection + UX) · [ADR 0024]
  (the allowlist is synced metadata) · [ADR 0039] (mid-flight = ① re-derive; the unfinished-work rule)
  · [ADR 0020] (V1-Lean — dotden holds no credentials; the CLI owns auth) · [ADR 0008] (per-file
  independence; never lose silently) · [scope-v1] (secrets scope).

<!-- Link reference definitions -->

[ADR 0008]: ../../adr/0008-invariant-ownership.md
[ADR 0020]: ../../adr/0020-provider-agnostic-pure-git-floor-v1-lean-auth.md
[ADR 0024]: ../../adr/0024-synced-vs-local-data-architecture.md
[ADR 0037]: ../../adr/0037-automation-ladder-transport-only.md
[ADR 0038]: ../../adr/0038-chezmoi-as-a-tool-not-a-faithful-wrapper.md
[ADR 0039]: ../../adr/0039-state-persistence-tiers-and-the-unfinished-work-rule.md
[CONTEXT]: ../../../CONTEXT.md
[scope-v1]: ../../scope-v1.md
[roadmap]: ../../roadmap.md
[secret-and-errors]: ../../design-system/screens/secret-and-errors.md
