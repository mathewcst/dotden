# Secret detection · offline · apply-error (Batch E)

> Phase 5 — Batch E. The commit-time **secret** 2-step flow + the **offline-queue** and
> **apply-failure** states. New `Secret & errors` SECTION (`343:5185`) on `05 · Screens — App`.
> Part of the [design system](../README.md). Domain: `CONTEXT.md` — secrets **warn + Convert to a
> Secret reference**, _soft_-block not hard-block (L119/L203); a Secret reference is an `op://…`
> placeholder resolved from the vault at **Apply** (L41); **Offline → commit locally + queue, retry on
> reconnect** (L110); apply is per-file, some files can fail to write.

Four screens, left→right in the section (section-relative x = `48 / 1560 / 3072 / 4584`, y `88`):

| Screen                                   | id         | What                                                      |
| ---------------------------------------- | ---------- | --------------------------------------------------------- |
| Secret detected (1 of 2) · choose path   | `343:5243` | `SecretWarning` over scrim-dimmed home                    |
| Secret reference (2 of 2) · pick manager | `354:6937` | `SecretPicker` over scrim-dimmed home                     |
| Offline — changes queued                 | `344:6096` | `Banner` Offline inserted into home `AppShell`            |
| Apply failed — retry                     | `360:6720` | `Banner` Error + `ListRow` Error rows over Review & Apply |

## The secret flow — two steps (warn, never block)

**Why two steps** (user-driven): one modal carrying both the _choice_ and the password-manager
_picker_ was too convoluted, and a "Convert" block beside an "I understand" checkbox was
contradictory (it's one decision, not two). Split so each screen has one job — **step 1 decides**,
**step 2 (only when converting) picks where**.

### Step 1 — `SecretWarning` (`341:1184`)

560-wide popover modal, **warn-amber** (NOT destructive-red — catching a secret is a caution and the
remedy is non-destructive; functional-color discipline reserves red for failure/delete). Anatomy:

- amber `alert-triangle` badge (on `dd/amber/950`) + **"Possible secret detected"** + subtitle.
- **detected card** (`muted` surface) — file path (mono) + amber `SECRET` `Pill` + the kind/line
  ("AWS Access Key ID · line 3") + a **masked value** (`AKIA••••••••••••N7QX`) so the user sees
  exactly what was flagged without re-exposing it.
- a single **`SelectRow` choice group** _(radio `Lead`; was `RadioRow` pre-M4)_ (mutually exclusive): **Convert to a Secret reference**
  (selected default) / **Commit the secret anyway**. Under Commit, a **"Don't warn me about this file
  again"** checkbox — the per-environment "sync anyway" allowlist decision (`CONTEXT.md` L203),
  file-scoped (not a global kill-switch for the scanner).
- footer: **Cancel** (Outline) / **Continue** (Primary). Continue → step 2 when _Convert_ is chosen;
  → the commit when _Commit anyway_ is chosen.

### Step 2 — `SecretPicker` (`353:1207`)

Only the password-manager chooser. ember `lock` badge + **"Choose your password manager"**. Three
**`SelectRow`** rows _(radio `Lead` + trailing Pill; were `PMOption` pre-M4)_ — **1Password** (selected, `op` CLI **detected**), **Bitwarden** (`bw` detected),
**`pass`** (**not found** → "Install pass to use this option", disabled). A **"Remember my choice for
the future"** checkbox. footer: **Back** (Ghost) / **Convert to Secret reference** (Primary, `lock`
lead) — the actual conversion. The synced result is a reference like `op://vault/item/field`; the real
secret stays in the vault and only the reference syncs (`CONTEXT.md` L41).

Both steps render over the **scrim-dimmed home** (the [confirm-dialog](./confirm-dialogs.md)
precedent). The home inspector's "Secrets · None detected" stays **consistent** — the scan catches the
secret _at the door_, before it ever enters the Den.

## Offline — changes queued (`344:6096`)

The Batch-C banner-insert technique (see [sync states](./sync-states.md)): clone home → detach the
`AppShell` → `insertChild(1, Banner Offline)` (body `FILL` shrinks, nothing covered). Banner copy:
"Offline — changes queued · Will sync when you reconnect" (`CONTEXT.md` L110). Self-consistency
overrides: titlebar status glyph → **cloud** + "Offline"; inspector **this-mac** env row → "Offline"

- muted dot (it's the offline environment). work-laptop's incoming card is **kept** — already-fetched
  changes still Apply offline; only _push_ is queued.

## Apply failed — retry (`360:6720`)

Cloned **Review & Apply** (the apply surface, `228:1153`) → detach `AppShell` → insert `Banner`
**Error**: "Couldn't apply 2 files · They were left unchanged — retry when you're ready." with a
**Retry** action (retry-all). The left list is reframed **COULDN'T APPLY · 2** with a `ListRow`
**Error** row (`.gitconfig`, "Permission denied") above the cleanly-applied file; the conflict-section
header was relabeled to match. One retry only (in the banner), so the action is unambiguous; the
center per-file **Apply** stays for the clean file.

- **`ListRow` Error** _(was a `FileRow` Error variant pre-M4)_: `State=Error` on **`ListRow`**
  (`439:1103`) — faint destructive-bg tint + the red `alert-triangle`; the row **`Meta#173:1`** carries
  the OS reason per instance ("Permission denied", "File is open in another app"). Build note: a
  variable-bound paint's `opacity` must be set **on the paint object before assignment** — a post-hoc
  spread dropped it once and the tint rendered at full strength (see [figma-conventions](../figma-conventions.md)).

## Components (page `02 · Components`)

> **⚠️ M4 (2026-06-14):** `RadioRow` and `PMOption` were **retired** — both folded into **`SelectRow`**
> (`429:1109`). The two modals below now contain `SelectRow` instances (radio `Lead`; PMOption's trailing
> Pill + mono `op://` ref carried over). Historical anatomy kept below for reference.

- _(retired)_ **`RadioRow`** → `SelectRow` (radio `Lead`, `Title`/`Subtitle`, full ember-border
  selection). Was the reusable single-choice card. **Reuse `SelectRow` for Batch F's automation ladder.**
- _(retired)_ **`PMOption`** → `SelectRow` with a Green/Neutral trailing `Pill` ("CLI detected" / "Not
  found") + the `op://` ref as a **mono per-instance font override** on the subtitle. Disabled = the
  SelectRow `Disabled` state.
- **`SecretWarning`** (`341:1184`) / **`SecretPicker`** (`353:1207`) — the two composed modals above;
  no exposed component props (content is fixed copy), instanced over a scrim like `Dialog`. Their rows
  are `SelectRow` instances.

## Reconciliation — onboarding hard-block → soft warn

`CONTEXT.md` L203 turns secrets from block→warn. The onboarding discovery row's state `Blocked` (red
`alert-triangle` in the checkbox slot + "Secret · excluded", **no** checkbox — a hard exclude) was
**renamed `Warn`** and softened: a **real unchecked `Checkbox`** (the file is now _selectable_), an
**amber** `WarnIcon` + "Secret · review at commit". _(M4: the `DiscoverRow` itself was folded into
**`ListRow`** — `Warn` is now a `ListRow` State, amber bg/fg.)_ The Discover subtitle was
reworded "…secrets are detected and **held back automatically**" → "…secrets are flagged so you store
them safely, **never synced raw**." The secret stays **unchecked by default** (the "6 selected" /
"Track 6 configs" count is unchanged) and is handled by the step-1/step-2 flow at commit. See
[onboarding](./onboarding.md).

White-fill + binding audits clean across the section.
