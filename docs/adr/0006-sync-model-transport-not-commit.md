# 0006 — Sync model: transport not commit, with risk-graded automation

dotden strictly separates **Commit** (recording local edits into the Den through a deliberate git commit) from **transport** (pushing/pulling already-Committed changes and presenting incoming changes). The default is fully manual + notify: nothing leaves an environment until the user Commits it, and nothing rewrites local files until the user reviews and Applies it. Automation is offered as risk-graded, off-by-default levels because config sync can break a working environment or leak secrets if treated like generic cloud-drive sync.

## Automation levels

| Level                                              | What becomes automatic                                                                                              | Risk   |
| -------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------- | ------ |
| **Manual** _(default)_                             | Nothing. Manual Commit / Push / review-Apply. Tray poller notifies only.                                            | —      |
| **Auto-sync** _(onboarding opt-in)_                | Auto-push Committed changes + auto-fetch/notify. Apply stays manual review.                                         | Low    |
| **Auto-apply** _(Settings opt-in, warned)_         | Clean incoming changes apply automatically. Conflicts, uncommitted-edit guard, and incoming deletions still prompt. | Medium |
| **YOLO mode** _(Settings opt-in, strongly warned)_ | Also auto-Commits local edits, pushes, and auto-applies/merges pulls except conflicts.                              | High   |

## Invariants

dotden never auto-resolves a Conflict, never loses data silently, acts only within the environment's Workspace/Scope subscription, and confirms incoming deletions by default. Riskier levels are never enabled by default.
