# 0022 — The onboarding gate is feature-detection, not emptiness

**Status:** Accepted. **Refines** the "greenfield = empty repo" boundary of [ADR 0020](./0020-provider-agnostic-pure-git-floor-v1-lean-auth.md) (and its [ADR 0001](./0001-pure-git-github-no-backend.md) ancestry). Scheduled for **v1.1** — after the v1 "proposed" onboarding flow ships.

**Decision:** When the user connects a Remote, dotden decides what to do by **detecting which chezmoi features the repo uses**, not by checking whether it is empty. After preflight, a repo falls into one of four buckets:

- **A — empty** (`git ls-remote` returns no refs): greenfield init, write the `.myenv/` marker.
- **B — dotden-managed** (clone shows `.myenv/`): second/returning environment, normal multi-env flow.
- **C1 — non-empty, no `.myenv/`, only benign files** (plain `dot_*`, `README`, `LICENSE`, `.gitignore`): **the user picks which existing files to track** (lightweight adopt).
- **C2 — non-empty with foreign chezmoi features dotden doesn't expose** (`run_*` scripts, logic templates, `encrypted_*`, `.chezmoiexternal`, complex `.chezmoiignore`): **hard-refuse** with a specific reason — "this repo uses chezmoi features dotden doesn't manage yet; full adoption is v2 — connect an empty repo or use the chezmoi CLI for now."

**v1 proper ships only A + B.** The C1/C2 classifier is **v1.1**: it has no UI designs yet, and during v1 the sole user/designer simply connects empty repos.

**Why:** "Greenfield = empty" conflates two independent things — _has content_ and _uses features we can't handle_. A `git ls-remote` that returns a head SHA proves the Remote is **reachable**, not that it is **safe to initialize as greenfield**: a repo created with GitHub's default "Add a README" is non-empty but harmless, while a hand-crafted chezmoi repo is the actual hazard. `chezmoi init` clones whatever is there and treats it as source state, so a foreign repo corrupts the mental model quietly (a stray `README.md` becomes a target `~/README.md`; a `run_` script would execute on apply) rather than failing cleanly. Gating on emptiness would both **wrongly refuse** a benign README repo and **fail to detect** the genuinely dangerous case once we relax the empty rule. Feature-detection gates on the thing that actually matters.

**The v1↔v2 line does not move.** Foreign chezmoi features stay v2; C2 is exactly that boundary, now enforced by a scan instead of an emptiness check. C2's richer v2 treatment — preserve unsupported constructs read-only, "managed via chezmoi CLI" — remains v2 (see CONTEXT.md _Future enhancements_).

**Consequences:**

- v1.1 onboarding gains a post-clone scan for the unsupported-construct set above; C2 detection must be conservative (refuse on any unrecognized feature) so nothing dangerous slips through as C1.
- C1 adopt is **opt-in per file**, not auto-track-everything — dotden must not silently start managing a stray `README` as a dotfile.
- The `.myenv/` marker is load-bearing for bucket B; greenfield init (bucket A) must write it.

**Rejected alternatives:**

- _Keep the emptiness gate (refuse all non-empty repos)_ — wrongly rejects the common "repo with a README" case and still wouldn't distinguish benign from foreign once relaxed. Rejected: gates on the wrong axis.
- _Proceed on C2 with unsupported constructs locked read-only_ — pulls the v2 "preserve foreign chezmoi" work into v1.1 and blurs the v1↔v2 boundary. Rejected: hard-refuse is cheaper and keeps the line crisp.
