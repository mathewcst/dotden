# 0024 — Synced vs. local data architecture

**Status:** accepted · 2026-06-15 · _amended 2026-06-20_

> **Amendment (2026-06-20):** the synced metadata directory was renamed `.myenv/` → **`.dotden/`** (and the code seam `MyenvStore` → `DenStore`, file `den-store.ts`). "myenv" was a pre-rename working name (cf. the local `menv` clone dir; see `CONTEXT.md` _Avoid_ list). Pre-v1, single-machine, no shipped dens — done as a clean cut with **no back-compat detection** of the old name.

dotden splits the data it owns into two tiers by a single governing principle: **_user-authored data_** (the organization and identity labels the user creates) **syncs through the repo**; **_environment-local facts_** (paths, installed tools, tokens, runtime state) **stay local**. This ADR fixes that boundary, the on-repo metadata layout, and the environment-registry/identity model that rides on it.

## Synced — the chezmoi-ignored `.dotden/` directory

Everything dotden syncs lives in a single chezmoi-ignored `.dotden/` directory in the repo (plus native chezmoi constructs), so chezmoi never treats it as a managed target:

- Workspace/Group tree + File/Folder placements + per-environment Workspace subscriptions
- Environment registry `{ id, label, os, subscribedWorkspaces }`
- Secret-scan "sync anyway" allowlist decisions
- Shared user settings: commit-message template, theme, default Apply/notification preferences
- _(OS Scope rules live as native `.chezmoiignore`; Secret references as native chezmoi templates — already in-repo)_

## Local — Electron `userData` / OS keychain, never synced

- _(v1: no dotden-held credential — git auth is the user's own SSH key / git credential helper. A dotden-managed Provider token in the keychain arrives only with the post-v1 OAuth convenience layer.)_
- Password-manager choice / detected CLI presence
- Poll cadence + on/off, tray/autostart behavior
- Last-known remote SHA + poll runtime state
- Observability ring buffer + telemetry sampling-disposition state
- Actual filesystem paths and other OS-bound specifics
- chezmoi's own environment-local config

A synced setting acts as the _default_; an environment may override it locally.

## Environment registry & lifecycle

The registry (in the chezmoi-ignored `.dotden/` metadata) holds per-environment `{ id, label, os, subscribedWorkspaces }`, written on first run, on rename, and when Workspace subscriptions change. **Identity is the stable random ID, never the hostname** (hostnames collide and change). "Who changed this" / last-sync / activity is **derived from git log**, never written to the registry, to avoid merge churn.

**Identity setup mechanics (issue 1-05).** The stable ID is a generated token minted once at setup into environment-local state (Electron `userData`), alongside the **hostname captured at setup** — used only as the returning-claim match hint (issue 1-13), never as the identity, so a later rename still resolves the match. That own ID is also mirrored into the **environment-local chezmoi config as `[data].dotden_env_id`** (never synced): a templated `.chezmoiignore` self-identifies with `{{ .dotden_env_id }}` and looks up `registry[.dotden_env_id].subscribedWorkspaces`, which is the per-environment subscription seam (proven by a `.chezmoiignore` spike — flipping `dotden_env_id` flips which Files are managed). Renaming the label edits only the `label` field (a one-line diff); the ID and all git-log attribution survive. Attribution is computed live by joining `git log` author name to the environment label, so the registry never stores activity fields.

**Lifecycle:** a reinstall enters the "connect existing" path and is asked _"new environment, or returning?"_ — choosing returning **claims** an existing registry entry and adopts its ID (history/attribution stay continuous). dotden suggests the likely match by OS + hostname but **never auto-merges**. Claiming only re-associates identity; files are applied fresh from the repo via normal Apply. Settings also offer **Reassign/merge** (fix a mistaken duplicate) and **Retire/remove** (decommissioned environment).

## Why

Keeping user-authored organization in the repo is what lets a second environment reconstruct the Den; keeping environment-local facts out is what stops merge churn and prevents paths, tokens, and runtime state from ever entering shared storage. Deriving attribution from git log (rather than writing it to the registry) keeps the registry small and merge-friendly. The privacy floor — paths, contents, secrets, and tokens are never synced — is enforced here at the data boundary and, for telemetry, in the type system (ADR 0007).

## Related

- [ADR 0003](0003-faithful-chezmoi-wrapper.md) — Workspace/Group is the one dotden addition with no chezmoi equivalent, stored in the chezmoi-ignored `.dotden/` file.
- [ADR 0005](0005-workspaces-as-environment-access-boundaries.md) — Workspace subscription is the access boundary the registry records.
- [ADR 0020](0020-provider-agnostic-pure-git-floor-v1-lean-auth.md) — why v1 holds no credential locally.
- [ADR 0007](0007-observability-wide-events-local-traces.md) — the local observability sink and telemetry sampling state.
