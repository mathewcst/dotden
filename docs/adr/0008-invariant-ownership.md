# 0008 — Each safety invariant has one type-level owner

> Status: accepted. Sharpens the enforcement of [ADR 0006](./0006-sync-model-transport-not-commit.md)'s invariants.

**Decision:** Each of ADR 0006's four never-relaxable invariants has **exactly one structural owner, expressed in types**, and every other module **depends on that owner's type** rather than re-checking the rule. The risk-graded automation ladder gates _levels_; it does not re-assert the invariants.

| Invariant                                            | Sole owner                            | Mechanism                                                                                                                                                                            |
| ---------------------------------------------------- | ------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| #1 Never auto-resolve a Conflict                     | `ConflictModel`                       | resolved-bytes are **unconstructable** without an explicit user choice; `DiffMergeView` consumes `ConflictModel.resolve(choice)`, never `@pierre/diffs` `resolveConflict()` directly |
| #2 Never lose data silently (uncommitted-edit guard) | `ApplyPlanner`                        | emits a precondition **re-checked atomically at apply-time** inside `ChezmoiAdapter`'s write path, so there is no plan-time-snapshot → apply-time-write TOCTOU                       |
| #3 Act only within subscription                      | `ApplicabilityResolver`               | emits an `AppliesHere` witness that `ApplyPlanner`/`SyncEngine` **require as input** to act on a File                                                                                |
| #4 Confirm incoming deletions                        | `ApplyPlanner` / Apply-review surface | deletions are first-class, never applied without explicit confirmation                                                                                                               |

`AutomationPolicy` gates the automation levels by **depending on** these types; it never duplicates the gate.
(Per [ADR 0037](./0037-automation-ladder-transport-only.md) the ladder is now just **Manual / Auto-sync** —
automation is transport-only, so there is no automatic-apply path for the policy to gate.)

**Why:** In the proposed design each invariant was "owned" by a different pure module, all of which unit-test green in isolation. But the invariants actually **compose at runtime in `SyncEngine`**, per event (incoming, conflict-resolved; historically also the now-removed YOLO auto-commit-before-merge path, see [ADR 0037](./0037-automation-ladder-transport-only.md)). Four green unit tests are **testability without locality**: the real regression is `SyncEngine` forgetting to route a row through `ConflictModel`, and no pure-module test catches that. Encoding each invariant in a type that downstream modules _must_ consume makes the dangerous composition either correct-by-construction or a compile error.

**The trade-off we accepted:** the pure core carries a few witness/branded types (`AppliesHere`, an unconstructable resolved-bytes type) that add ceremony to the interfaces, in exchange for moving the safety guarantee from "remembered to check" to "cannot express the unsafe state."

**Consequences:**

- The real regression surface is **`SyncEngine` composition order**. The load-bearing test is a `SyncEngine`-level integration/property test **per event path**, asserting no path applies to a non-applicable File or auto-resolves a Conflict — in addition to (not instead of) the pure-owner unit tests.
- Review discipline: reject any PR where `SyncEngine`, `IpcBridge`, or `TrayPoller` re-checks an invariant the owning type already guarantees.
