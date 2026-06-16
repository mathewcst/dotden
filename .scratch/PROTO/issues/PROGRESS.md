# PROGRESS — live build status (dotden v1)

The single source of truth for **what is done / in flight / blocked**. Agents update their issue's row
(and append a line to the Log) when they **start** and **finish**.

## How to update

- **Starting:** set Status `🟡 In progress`, put your agent id + date in *Who* / *Started*.
- **Finishing:** set Status `✅ Done`, fill *Finished* + *Branch/PR* + a one-line *Outcome*; append a **Log** entry.
- **Blocked:** set `⛔ Blocked`, note the reason + blocking issue in *Outcome*.
- An issue is **grabbable** only when every code in its *Blocked by* (see [TRACK.md](./TRACK.md)) is `✅ Done`.

Status key: `⬜ Not started` · `🟡 In progress` · `🔵 In review` · `✅ Done` · `⛔ Blocked`

## Ready now (no blockers)

- `1-09` — [issue-09-review-and-apply.md](./issue-09-review-and-apply.md) _(unblocked by 1-07 + 1-00)_
- `1-14` — [issue-14-workspaces-groups.md](./issue-14-workspaces-groups.md) _(unblocked by 1-07)_
- `2-01` — [issue-2-01-history-tab.md](./issue-2-01-history-tab.md) _(unblocked by 1-01 + 1-07)_
- `3-01` — [issue-3-01-commit-wide-event-ring-buffer.md](./issue-3-01-commit-wide-event-ring-buffer.md) _(unblocked by 1-04)_
- `3-19` — [issue-3-19-electron-builder-packaging.md](./issue-3-19-electron-builder-packaging.md)
- `3-22` — [issue-3-22-ci-pipeline.md](./issue-3-22-ci-pipeline.md)
- `3-23` — [issue-3-23-license-choice.md](./issue-3-23-license-choice.md)

> `1-15` (OS Scope) still waits on `1-14`; `2-08` still waits on `1-12`.

> Everything else unlocks as its blockers reach ✅. PRD 2 work generally needs the PRD 1 thread done; PRD 3 needs PRD 1 (+ some PRD 2) done.

## PRD 1 — MVP (the sync loop)

| Issue | Title | Type | Blocked by | Status | Who | Started | Finished | Branch/PR | Outcome |
|-------|-------|------|-----------|--------|-----|---------|----------|-----------|---------|
| `1-00` | Spike: validate @pierre/trees renderRowDecoration two-axis row geometry | HITL | — | ✅ Done | claude | 2026-06-15 | 2026-06-15 | .scratch/proto-row-decoration | GO — keep the overlay. beta.4 draws a coloured M/A/D/R/U letter; `renderRowDecoration` text lands directly left of it (`↓ M`/`⚠ U`), no overlap/clip at compact/default/relaxed. No `unsafeCSS`, no `setGitStatus` fallback. Recipe + shots in issue-00. |
| `1-01` | Faithful-wrapper foundation — ChezmoiAdapter/GitTransport + Vitest harness | AFK | — | ✅ Done | pi | 2026-06-15 | 2026-06-15 | workspace | Added Vitest harness, temp git fixture, ChezmoiAdapter/GitTransport, bundled-tool resolver, ADR 0019, and real chezmoi/git integration tests. |
| `1-02` | ~~Register GitHub App~~ — DEFERRED to convenience layer (V1-Lean, ADR 0020) | HITL | — | ⏸️ Deferred | | | | | |
| `1-03` | RemoteClient — connect existing Remote, ls-remote preflight, system git creds | AFK | — | ✅ Done | pi | 2026-06-15 | 2026-06-15 | workspace | Added RemoteClient, timeout/cancel process support, typed IPC/preload bridge, minimal Connect URL UI, and tests for preflight/init/latest SHA/no env override/sanitized diagnostics. |
| `1-04` | First end-to-end thread — Track → Commit → Sync → second-env Apply (incoming-clean) | AFK | 1-01, 1-03 | ✅ Done | workflow | 2026-06-15 | 2026-06-15 | feat/main-app | End-to-end thread real across two envs: IpcBridge (_trace on every call) + OperationTracer (allowlisted wide events, bounded ring) + SyncEngine (incoming-clean route) + ApplicabilityResolver (un-forgeable AppliesHere) + ApplyPlanner + MyenvStore (.myenv/) + 3-pane shell using @pierre/trees+@pierre/diffs. 51 tests incl. SyncEngine property + real-binary e2e. |
| `1-05` | Environment registry & identity — stable id, editable label, git-log attribution | AFK | 1-04 | ✅ Done | workflow | 2026-06-15 | 2026-06-15 | feat/main-app | EnvironmentRegistry: stable id (UUID, hostname-independent) + editable label (one-line registry diff, no churn) + attribution derived live from `git log` (never persisted). Own id mirrored to local chezmoi `[data].dotden_env_id` (spike-proven subscription-`.chezmoiignore` seam); new-or-returning probe + claim adopt id; suggestClaims by OS+setup-hostname (no auto-merge). `env:*` IPC + editable EnvironmentBadge UI. 69 tests green. |
| `1-06` | Tool-catalog discovery scan + first-environment onboarding | AFK | 1-04 | ✅ Done | workflow | 2026-06-15 | 2026-06-15 | feat/main-app | DiscoveryScanner (catalog-grounded home-dir scan, feature-detection not sweep, ADR 0022) + `discover:*` IPC; OnboardingShell + OnboardingMenu rail + OBContent steps Welcome/CreateRepo/ConnectURL(reuses 1-03 preflight)/Discover/Commit/AutoSync(wired slot)/Done; drag-in/browse for missed Files; picks Track via 1-04 path → default Workspace auto-seeded; App routes onboarding↔Workspace. 81 tests green. |
| `1-07` | Three-pane view — tree interactions, git-status decorations, inspector, diff | AFK | 1-04 | ✅ Done | workflow | 2026-06-15 | 2026-06-15 | feat/main-app | Real three-pane wired chezmoi↔main↔IPC↔UI: `den:tree`/`den:diff` IPC over `DenService.fileTree`/`fileDiff` (managed + parsed `chezmoi status` local axis M/A/D from **column X only** — col Y is the incoming axis owned by 1-09 — + `chezmoi ignored` muted + `.myenv/` placement; per-File `chezmoi diff`). Renderer @pierre/trees with setGitStatus + search + inline rename + drag-reorganize + renderRowDecoration seam (1-09); @pierre/diffs PatchDiff of selected File; inspector FILE info. @pierre/trees beta pinned + pnpm-patched (Math.random sticky-jitter→0); Shiki trimmed to config langs via a grammar-free `shiki` shim (308→93 chunks). gpgsign-off test hygiene. 91 tests green. |
| `1-08` | Right-click row actions + Untrack + Delete everywhere | AFK | 1-07 | ✅ Done | workflow | 2026-06-15 | 2026-06-15 | feat/main-app | Right-click row menu (`@base-ui` ContextMenu over `@pierre/trees`, target via `data-item-path`) offers Commit · Apply · Untrack · Delete everywhere (latter visibly distinct: separator + red). Untrack→`forget` (File STAYS on disk everywhere, Default-tone confirm says so); Delete everywhere→`destroy` (Destructive-tone confirm NAMES every subscribed environment via `den:affected-environments`). Both commit LOCALLY (ADR 0006). **Caught+fixed a real bug**: forget/destroy *deletes* the source-state file but the commit only staged `.myenv/`, leaving the deletion unstaged → it would re-appear on Sync; switched to `commitAll` so the removal travels (proven by a cross-env clone test). +4 DenService e2e tests; 95 tests green. |
| `1-09` | Remote-axis decorations + Review & Apply surface (one/all, atomicity, retry) | AFK | 1-07, 1-00 | ⬜ Not started | | | | | |
| `1-10` | ApplyPlanner invariants — uncommitted-edit guard + incoming-deletion confirmation | AFK | 1-09 | ⬜ Not started | | | | | |
| `1-11` | Conflict resolution — ConflictModel + merge view, auto-merge non-overlapping | AFK | 1-09 | ⬜ Not started | | | | | |
| `1-12` | Sync-now polish + Auto-sync + TrayPoller + OS notification + AutomationPolicy | AFK | 1-09, 1-03 | ⬜ Not started | | | | | |
| `1-13` | Second-environment onboarding — new-or-returning, subscription pick, claim | AFK | 1-05, 1-11, 1-12 | ⬜ Not started | | | | | |
| `1-14` | Workspaces (access boundary, invisible until 2nd) + nested Groups | AFK | 1-07 | ⬜ Not started | | | | | |
| `1-15` | OS Scope + inheritance (narrowable) → per-OS .chezmoiignore | AFK | 1-01, 1-07, 1-14 | ⬜ Not started | | | | | |
| `1-16` | Offline Commit + queued pushes + retry on reconnect/next Sync | AFK | 1-04, 1-12 | ⬜ Not started | | | | | |

## PRD 2 — Improvement (history · secrets · settings)

| Issue | Title | Type | Blocked by | Status | Who | Started | Finished | Branch/PR | Outcome |
|-------|-------|------|-----------|--------|-----|---------|----------|-----------|---------|
| `2-01` | History tab — per-File version list + read-only preview | AFK | 1-01, 1-07 | ⬜ Not started | | | | | |
| `2-02` | Restore-forward + non-destructive confirm | AFK | 1-04, 2-01 | ⬜ Not started | | | | | |
| `2-03` | SecretScanner — commit-time scan + warn step | AFK | 1-01, 1-04 | ⬜ Not started | | | | | |
| `2-04` | Commit-anyway + synced per-File 'don't warn' allowlist | AFK | 2-03 | ⬜ Not started | | | | | |
| `2-05` | PM picker + convert to a Secret reference | AFK | 1-01, 2-03, 2-04 | ⬜ Not started | | | | | |
| `2-06` | Secret reference resolves on a second environment | AFK | 2-05, 1-13 | ⬜ Not started | | | | | |
| `2-07` | Onboarding Discover Warn reconciliation | AFK | 2-03, 1-06 | ⬜ Not started | | | | | |
| `2-08` | SettingsShell + Sync tab | AFK | 1-06, 1-07, 1-12 | ⬜ Not started | | | | | |
| `2-09` | Commit tab — message-template editor | AFK | 2-08 | ⬜ Not started | | | | | |
| `2-10` | Appearance + default Apply/notification preferences controls | AFK | 2-08 | ⬜ Not started | | | | | |
| `2-11` | Account tab — GitHub + detected PM CLI + reconnect | AFK | 1-03, 2-05, 2-08 | ⬜ Not started | | | | | |
| `2-12` | Automation tab + Auto-apply path | AFK | 2-08, 1-09, 1-10, 1-11, 1-12, 1-14, 1-15 | ⬜ Not started | | | | | |
| `2-13` | YOLO mode — strongly-warned full hands-off | AFK | 2-12, 1-10, 1-11, 1-14, 1-15 | ⬜ Not started | | | | | |
| `2-14` | Privacy tab — opt-in toggles + copy (control surface only) | AFK | 2-08 | ⬜ Not started | | | | | |
| `2-15` | Environments tab + claim / reassign / retire lifecycle | AFK | 2-08, 1-05, 1-13 | ⬜ Not started | | | | | |
| `2-16` | About tab — version, update check, chezmoi credit | AFK | 2-08 | ⬜ Not started | | | | | |
| `2-17` | Synced-vs-local settings — defaults + local override | AFK | 2-09, 2-10, 2-14, 1-05 | ⬜ Not started | | | | | |

## PRD 3 — Polish (distribution · telemetry · feedback · state surfaces)

| Issue | Title | Type | Blocked by | Status | Who | Started | Finished | Branch/PR | Outcome |
|-------|-------|------|-----------|--------|-----|---------|----------|-----------|---------|
| `3-01` | Commit instrumented end-to-end: one allowlist-typed Wide event into the always-on ring buffer | AFK | 1-04 | ⬜ Not started | | | | | |
| `3-02` | Extend instrumentation to the remaining operations + tail sampling governs buffer size | AFK | 3-01 | ⬜ Not started | | | | | |
| `3-03` | TraceContextCodec — trace_id across the renderer-main IPC boundary (relay half deferred) | AFK | 1-04, 3-01 | ⬜ Not started | | | | | |
| `3-04` | Banner status strip wired to live Sync state (six tones + CTAs) | AFK | 1-09, 1-12 | ⬜ Not started | | | | | |
| `3-05` | Toast transient success/info confirmations | AFK | 3-04 | ⬜ Not started | | | | | |
| `3-06` | Native macOS tray menu wired to live state + actions | AFK | 1-09, 1-12, 3-04, 2-12, 2-13 | ⬜ Not started | | | | | |
| `3-07` | OS notifications for cross-environment activity (notify-only, native macOS chrome) | AFK | 1-12, 3-06, 2-12 | ⬜ Not started | | | | | |
| `3-08` | Offline + apply-error screens with Retry (per-file atomicity, empty incoming review) | AFK | 1-09, 1-16, 3-04 | ⬜ Not started | | | | | |
| `3-09` | First-launch consent screen + egress-gate wiring (two independent opt-ins, off by default) | AFK | 3-01, 2-14 | ⬜ Not started | | | | | |
| `3-10` | TelemetrySink consent gate proven to suppress egress (the load-bearing privacy test) | AFK | 3-02, 3-09 | ⬜ Not started | | | | | |
| `3-11` | Sentry egress mapping + PII scrub in beforeSend (faked transport, gate-closed) | AFK | 3-10 | ⬜ Not started | | | | | |
| `3-12` | Sentry provisioning + end-to-end egress verification (DSN) | HITL | 3-11 | ⬜ Not started | | | | | |
| `3-13` | Umami payload mapping (cookieless counts + engagement events, faked transport) | AFK | 3-10 | ⬜ Not started | | | | | |
| `3-14` | Umami provisioning + end-to-end egress verification (self-hosted instance) | HITL | 3-13 | ⬜ Not started | | | | | |
| `3-15` | In-app feedback form: compose, preview, attach scrubbed log (from known path) | AFK | 3-02 | ⬜ Not started | | | | | |
| `3-16` | Screenshot attachment + structural attachment contract (magic-byte, EXIF-strip, size-cap) | AFK | 3-15 | ⬜ Not started | | | | | |
| `3-17` | Feedback offline queue + relay client (trace_id propagated on the relay boundary) | AFK | 3-03, 3-16 | ⬜ Not started | | | | | |
| `3-18` | Relay deployment: moderated GitHub issues, rate-limit, attestation, server-side scrub | HITL | 3-17 | ⬜ Not started | | | | | |
| `3-19` | electron-builder packaging: dmg / NSIS / AppImage with pinned chezmoi (unsigned) | AFK | — | ⬜ Not started | | | | | |
| `3-20` | Auto-update from GitHub Releases: background download, apply-on-restart with defer, version surface | AFK | 3-19, 2-16 | ⬜ Not started | | | | | |
| `3-21` | Wire the GitHub Releases publish feed + first release (fill REPLACE_ME) | HITL | 3-20 | ⬜ Not started | | | | | |
| `3-22` | CI pipeline: frozen-lockfile install with ADR 0015 guards + turbo affected check/build | AFK | — | ⬜ Not started | | | | | |
| `3-23` | OSS LICENSE choice (MIT vs Apache-2.0) | HITL | — | ⬜ Not started | | | | | |

## Log (append-only, newest first)

<!-- Add one line per state change: `YYYY-MM-DD · code · status · agent · note` -->
2026-06-15 · CODE · ✅ Done · workflow · 1-08 right-click row verbs + Untrack + Delete everywhere: row context menu (`@base-ui` ContextMenu over the `@pierre/trees` tree; right-clicked File recovered from the row's `data-item-path`) offers Commit · Apply · Untrack · Delete everywhere — the destructive verb visibly distinct (separator above + red text/badge). Untrack→`chezmoi forget` (source + `.myenv/` placement dropped, File STAYS on disk on EVERY environment; Default-tone `ConfirmDialog` whose copy says so — non-destructive, NOT styled red). Delete everywhere→`chezmoi destroy --force` (source + destination removed; Destructive-tone confirm that NAMES every affected environment via new `den:affected-environments` blast-radius query = envs subscribed to the File's Workspace, self first). Both commit LOCALLY (ADR 0006). `den:untrack`/`den:delete-everywhere`/`den:affected-environments` IPC + preload + Workspace wiring; `OperationKind` gains untrack/delete-everywhere; `MyenvStore.removePlacement`; `button.tsx` destructive/outline variants. **Caught + fixed a real bug while TDD-ing the seam**: forget/destroy *delete* the source-state file (`dot_zshrc`) but `untrackFile`/`deleteEverywhereFile` committed only `['.myenv','.chezmoiignore']`, leaving the deletion unstaged → the removed File stayed committed in the Remote and would re-appear on the next Sync. Switched both to `git.commitAll` so the deletion travels; proven by a cross-env clone test (env B clones a Den without the destroyed File). +4 DenService e2e tests (untrack keeps-on-disk, destroy removes-everywhere, deletion-travels, affectedEnvironments blast radius). 95 tests green. Unblocks nothing new (1-09 already grabbable).
2026-06-15 · CODE · ✅ Done · workflow · 1-07 fix (reviewer): the local status axis read the WRONG `chezmoi status` column. Per `chezmoi help status` (verified empirically against the bundled binary), column 1/X = last-written-vs-actual = the LOCAL edit; column 2/Y = actual-vs-target = what `apply` will do = the INCOMING axis (1-09). `parseChezmoiStatus` preferred Y, so a local delete (`DA`) mislabeled "added" and incoming-only rows (` M`/` A`, no local edit) leaked onto the local axis. Now reads **column X only** (no Y fallback): `DA`→deleted, ` M`/` A`/` R`→omitted (incoming, 1-09's job), `MM`→modified (unchanged). Rewrote the doc comment + unit-test spec to match chezmoi's documented columns; e2e fileTree (local `MM`→modified) still green. 91 tests green. Unblocks 1-09's Remote axis cleanly (no incoming collision on the local axis). Commit amended.
2026-06-15 · CODE · ✅ Done · workflow · 1-07 three-pane view: real chezmoi↔main↔IPC↔UI three-pane. NEW `den:tree`/`den:diff` IPC (read-only, _trace-asserted) over `DenService.fileTree` (managed Files + `parseChezmoiStatus` local axis M/A/D/R/U + `chezmoi ignored`→muted + `.myenv/` placement, all in one snapshot) and `fileDiff` (`chezmoi diff <file>`). New `ChezmoiAdapter.managed()`/`ignoredPaths()` + pure `chezmoi-status.ts` parser. Renderer Workspace rebuilt: @pierre/trees FileTree driven by setGitStatus + working search (⌘K) + inline rename + drag-reorganize + a no-op renderRowDecoration seam for the 1-09 Remote axis; @pierre/diffs PatchDiff of the selected File's real diff; inspector FILE info (Workspace/Scope/Path/Status) + incoming-callout seam (1-09). @pierre/* betas already pinned; pnpm-patched @pierre/trees to kill the `Math.random()` sticky-inset jitter; Shiki trimmed to dotden's config languages via a grammar-free `shiki` alias-shim (renderer build 308→93 chunks; wolfram/emacs-lisp/cpp/etc gone). Test hygiene: force `commit.gpgsign=false` in the temp-repo fixtures so host 1Password signing can't hang `git commit`. 90 tests green (8 status-parser + 1 fileTree/fileDiff e2e + tree/diff IpcBridge). Unblocks 1-08/1-09/1-14/2-01.
2026-06-15 · 1-07 · 🟡 In progress · workflow · Started three-pane view slice.
2026-06-15 · CODE · ✅ Done · workflow · 1-06 tool-catalog discovery scan + first-environment onboarding: DiscoveryScanner scans the home dir grounded in a known-tools catalog (feature-detection, not a blind sweep — ADR 0022) + drag-in/browse `inspectCustomPath` for missed Files (home-relative, escape-guarded); `discover:scan`/`discover:inspect-path` IPC (carry `_trace`, route to scanner). UI: OnboardingShell (rail + content slot + step router) + OnboardingMenu (6-step rail) + OBContent steps Welcome→CreateRepo→ConnectURL(reuses 1-03 preflight/connect)→Discover→Commit(Commit+Sync via 1-04)→AutoSync(wired opt-in slot, engine=1-12)→Done; ListRow scan rows; picks Track via 1-04 `den.track` → default Workspace auto-seeded (no org asked); App.tsx routes onboarding↔Workspace. 81 tests green (11 DiscoveryScanner + discover IPC). 2-07/2-08 dep satisfied (still need their other blockers).
2026-06-15 · CODE · ✅ Done · workflow · 1-05 environment registry & identity: stable hostname-independent id minted at setup + frozen setup-hostname claim hint; editable label (one-line registry diff, no churn, id untouched); attribution derived live from `git log` (never persisted); own id mirrored to local chezmoi `[data].dotden_env_id` (spike-proven subscription-`.chezmoiignore` seam); new-or-returning probe (readLocalIdentity/claimLocalIdentity) + suggestClaims by OS+setup-hostname (no auto-merge); `env:*` IPC + editable EnvironmentBadge UI; ADR 0024 extended. 69 tests green.
2026-06-15 · CODE · ✅ Done · workflow · 1-04 first end-to-end thread (Track→Commit→Sync→2nd-env Apply, incoming-clean) real across two envs; IpcBridge/_trace + OperationTracer + SyncEngine + AppliesHere witness + ApplyPlanner + .myenv/ store + 3-pane shell (@pierre/trees+diffs); 51 tests green (SyncEngine property + real-binary e2e). 1-05/1-06/1-07/3-01 unblocked.
2026-06-15 · 1-04 · 🟡 In progress · workflow · Started end-to-end thread slice.
2026-06-15 · 1-03 · ✅ Done · pi · RemoteClient preflight/init/latest-SHA slice landed with typed IPC/UI and tests; 1-04 now grabbable.
2026-06-15 · 1-03 · 🟡 In progress · pi · Started RemoteClient connect/preflight/init/latest-SHA slice.
2026-06-15 · tracker · ✅ Updated · pi · Reconciled Ready now after 1-01 completion and V1-Lean 1-02 deferral; 1-03 is now grabbable.
2026-06-15 · 1-01 · ✅ Done · pi · Vitest harness + faithful chezmoi/git wrapper foundation landed; tests/typecheck/lint/build pass.
2026-06-15 · 1-01 · 🟡 In progress · pi · Started Vitest harness + ChezmoiAdapter/GitTransport foundation.
