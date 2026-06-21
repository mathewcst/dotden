# 0038 — chezmoi is a tool, not a faithful wrapper — the deliberate seam

> Status: accepted. **Revises [ADR 0003](./0003-faithful-chezmoi-wrapper.md)** — softens "faithful wrapper" into "use chezmoi where it does the job best; own the rest." Consistent with [ADR 0006](./0006-sync-model-transport-not-commit.md) (Sync = transport, resolved at git) and [ADR 0008](./0008-invariant-ownership.md) (`ConflictModel` owns resolution).

**Decision:** chezmoi is the **dotfile target-state engine dotden builds on — not a wrapper dotden is bound to.** dotden uses chezmoi for what chezmoi does best and **deliberately bypasses it** where a chezmoi command is interactive or lossy as a CLI-API.

**The seam — who owns what:**

| Concern | Owner | Why |
|---|---|---|
| Encoded attributes (`dot_`, `private_`, `executable_`, `symlink_`, `exact_`…) | **chezmoi** | git can't portably store mode / symlinks / "delete extras"; chezmoi has solved this cross-platform |
| Per-machine **templating** (`{{.chezmoi.os}}`, machine data) → **Placement** / per-OS content | **chezmoi** | reimplementing a templating engine + per-machine data model is the multi-year trap |
| Secret + password-manager integration (`op://`, `encrypted_` via age/gpg) → **Secret reference** | **chezmoi** | PM bridges + encryption-at-rest are chezmoi's, not ours to rebuild |
| Idempotent `apply` / `diff` / `status` (target → destination) → **Review & Apply** | **chezmoi** | the change planner the entire Apply UI sits on |
| Transport — push / fetch / source-state **merge** | **git directly** (not `chezmoi merge`) | cross-env Conflict is a pure-git merge; chezmoi adds nothing here (see ADR 0006) |
| **Interactive** resolution (the Keep / Take / Both resolver) | **dotden's `ConflictModel`** | `chezmoi merge` shells to an interactive mergetool (vimdiff) on a tty — **cannot** be wrapped headlessly (ADR 0008) |

**Retained from [ADR 0003](./0003-faithful-chezmoi-wrapper.md):**

- Added metadata (Workspace / Nook / environment-subscription) still **compiles down to chezmoi/git or stays in a chezmoi-ignored area** — chezmoi never treats it as managed target state.
- The repo **stays a valid chezmoi setup** — a user could run `chezmoi` against the Den directly.
- **Vocabulary still maps to chezmoi** where chezmoi owns the concept (Den = source state, Apply = `apply`, Scope / Placement = attributes + templates, Secret reference = PM integration). The dotden↔chezmoi table in [`CONTEXT.md`](../../CONTEXT.md) remains the contract.

**What changed:** the design test shifts from *"how does chezmoi already express this?"* (mandatory passthrough — every operation routes through chezmoi) to:

> **"Does chezmoi express this _well_? — then use it. If it's interactive or lossy, own it."**

**Why:**

- chezmoi is **not** "git + copy a file" — it's a target-state computer whose complexity (attributes, templating, secrets, cross-platform paths) is the **essential** complexity of the dotfile problem. Dropping chezmoi does not shed that complexity; it forces dotden to **rebuild chezmoi inside an Electron app**, cross-platform, minus a decade of hardening. That is the bigger, worse refactor.
- But "faithful wrapper" as a **dogma** caused real friction at exactly two seams: chezmoi's CLI is **lossy as an API** (a Go binary we shell out to and screen-scrape, not a linkable library — hence the `ChezmoiAdapter`), and chezmoi's **interactive subcommands don't wrap** (`chezmoi merge`). We were already bypassing chezmoi for cross-env merge ("pure git, not `chezmoi merge`" — `CONTEXT.md`); this ADR makes that stance **principled and general** rather than a one-off exception.
- The fix to "are we wrapping too much?" is therefore a **sharper seam**, not removal: wrap the parts that wrap cleanly, bypass the parts that don't.

**Consequences:**

- The `ChezmoiAdapter` is scoped to **state / apply / secrets**; **transport and merge are not routed through it** (git directly + `ConflictModel`). A PR that reaches for `chezmoi merge` or an interactive chezmoi subcommand is rejected — own it in-app instead.
- This unblocks the journey-04 decision that the cross-environment resolver is dotden's own 2-way merge UI, and that the apply-time local-edit guard is the reserved socket for a future 3-way (drift) merge — neither calls `chezmoi merge`.
- [ADR 0003](./0003-faithful-chezmoi-wrapper.md) is no longer read as a passthrough mandate; its retained guarantees (valid chezmoi setup, isolated metadata, vocabulary mapping) carry forward here.
