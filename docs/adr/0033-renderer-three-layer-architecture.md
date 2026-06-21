# 0033 — Renderer is three layers: `app → features → shared`, one-way

**Status:** accepted · 2026-06-21 · supersedes the "shell/launch are features" and
"composition root is `shell/`" framing of ADR 0027 (its feature-by-capability idea and
the scoped store survive — the store's home moves in ADR 0034).

ADR 0027 organized the renderer into `features/` by domain capability, put cross-cutting
pieces in `shared/`, scaffolded shadcn primitives in `ui/`, and named `shell/` the
composition root — **but kept `shell/` and `launch/` as features.** In practice there was
no _layering_: `shell/` imports ~10 features (`DenWindow`/panes/`DialogLayer` wire commit,
apply, workspace, secrets, sync, scope, diagnostics) and the den-session store composes
feature slices, while features import the store back. So one "feature" (shell) depended on
nearly every other feature, with no rule governing which way imports may flow. New work had
no bright-line for _"is this a feature?"_ — so the auto-update prompt, the boot router, and
a command-log viewer all became `features/`. That drifts back toward the hard-to-pinpoint
sprawl ADR 0027 set out to kill, one level up.

## Decision

**Three layers, one-way dependency graph.**

```
app/                       ◀ composition root — MAY import features + den-session + shared
  App.tsx · main.tsx · providers/   (Tooltip, Launch, DenSession key={role})
  launch/    boot routing (was features/launch)
  shell/     DenWindow · panes · DialogLayer · TitleBar… (was features/shell)
  update/    root-mounted UpdateDownloadedPrompt (was features/update)
      ↓ may import
features/                  ◀ capabilities only — MAY import den-session + shared;
  onboarding returning workspace commit sync apply         NEVER app or another feature
  secrets settings file-history scope diagnostics
      ↓ may import
components/  lib/  hooks/  den-session/   ◀ shared leaves — NEVER import features/app
```

1. **`app/` is the composition root.** The application shell — `App.tsx`/`main.tsx`, the
   providers, boot routing (`launch/`), and the three-pane den window that wires features
   into slots (`shell/`) — lives here. `app/` is the _only_ layer permitted to import
   `features/`. Nothing imports `app/`.
2. **`features/` are user-facing capabilities**, named in glossary words. A feature may
   import the shared leaves and the `den-session` store; it may **not** import `app/` or
   another feature's internals.
3. **Shared leaves** — `components/`, `lib/`, `hooks/`, and `den-session/` (ADR 0034) —
   import only sideways/down; never `features/` or `app/`.

**The bright-line "what is a feature" test:** a folder earns `features/` only if it delivers
a **discrete user-facing capability a user would name** (Onboarding, Commit, Apply, Sync,
Secrets, Settings, File History, Scope, Workspace, Diagnostics). App _infrastructure_ — the
shell frame, boot routing, the root-mounted update prompt — is not a capability and lives in
`app/`. (Diagnostics _is_ a capability — the command-log viewer, ADR 0030 — so it stays a
feature even though it's one small component.)

**Why `shell/` is `app/`, not a shared component.** A shared layer that imports features
re-creates the exact cycle that makes boundaries meaningless and unlintable. dotden's
"shell" is literally the thing that wires every feature into a layout — that _is_ the
application layer (bulletproof-react's `app/`), not a reusable component. ADR 0027 already
called shell "the composition root"; this ADR just stops _also_ calling it a feature.

## Alternatives considered

- **Keep ADR 0027's flat "everything is a feature."** Rejected: no layering, shell imports
  every feature, and no bright-line for new folders — the drift this ADR fixes.
- **`components/shell/`, and allow `components → features`.** Rejected: the shared→feature
  cycle; `components/` stops being safe-to-import-anywhere and the graph becomes unlintable.
- **Two layers (features + shared) only.** Rejected: nowhere honest for the composition
  root — it _must_ import features, so it can't be shared, and calling it a feature is the
  status quo we're leaving.

## Consequences

- `git mv features/{shell,launch,update} → app/{shell,launch,update}`; the other 11 stay
  `features/`. Mechanical, history-preserving — details in the migration handoff.
- **Enforced, not just documented** — `eslint-plugin-boundaries` (ADR 0035) makes the graph
  above a lint config; the element/rule list is the canonical statement of this architecture.
- Supersedes ADR 0027 Decision 1's "shell/launch are features" and Decision 2's
  "composition root is `shell/`". ADR 0027's wins survive: features-by-capability (not
  file-type), glossary naming, the rejected `git/`/`file/` bucket, and the scoped store
  (relocated in ADR 0034).
- `app/` is granted the only feature fan-in — by design; it is the root.
- **`returning` merged into `onboarding` (A5, boundaries pass).** The gate surfaced that
  `returning` was the _same_ setup domain as `onboarding` — both carried the `OB*` (onboarding-step)
  vocabulary and `returning` imported `onboarding`'s connect-repo screen sideways. They are now
  **one** feature with two entry shells (`OnboardingShell` first-run, `ReturningShell`
  existing-Den/new-environment), so the shared steps are intra-feature and the roster is **10**
  features, not 11. The launch routes (`onboarding`/`returning`) and `app/launch` routing are
  unchanged — app-level routing, not the feature boundary. (See conventions.md _Renderer layering_.)
