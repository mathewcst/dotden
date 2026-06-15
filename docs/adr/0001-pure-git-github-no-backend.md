# 0001 — Pure-git sync, no backend of our own

> **Partially superseded by [ADR 0020](./0020-provider-agnostic-pure-git-floor-v1-lean-auth.md) (2026-06-15).** The "no backend / no hosting / pure-git transport / poll-based notification" core stands unchanged. What 0020 overrides: dotden is **not** GitHub-only — it is provider-agnostic, and multi-provider is a committed direction (the "any git remote" rejected alternative below is now _adopted_). And v1 does **not** use a GitHub App / device flow / one-click creation — v1 leans on the user's own git credentials and creates no Remote ("V1-Lean"). Read the auth + provider specifics in 0020; read the no-backend rationale here.

**Decision:** dotden has no server. All cross-environment sync flows through a single, private, per-user git repository (the **Remote**) on a git Provider the user owns. The app bundles chezmoi and git and authenticates using the user's existing git credentials (SSH / credential helper) — no dotden-held token (auth specifics in ADR 0020).

**Why:** The product is a GUI wrapper that makes chezmoi easy, not a new sync service. chezmoi is already git-based, so leaning on git as the only transport means no hosting cost, no accounts to run, and — critically — we never hold users' configuration, which often contains secrets. The Remote lives on any git Provider the user owns; provider-specific conveniences (e.g. API-based repo creation and cheap change-detection) are an additive layer above this universal pure-git floor — see ADR 0020.

**The trade-off we accepted:** chezmoi is pull-only and has no notification mechanism, and with no backend we can't do true server push. So "notify me when another environment changed something" is necessarily **poll-based** — the app fetches the Remote (on launch and periodically) and compares. This is the single biggest consequence of the no-backend stance; a future reader wondering "why are we polling instead of pushing?" should look here.

**Scope clarification (added later):** "No backend" governs **sync and user configuration** — those stay 100% serverless and in the user's git repo; we never host config or secrets. It does **not** forbid small, **opt-in, no-PII, no-config-data** side services: privacy-first product analytics (self-hosted Umami) and a small **feedback/error relay** (part of the public monorepo) are sanctioned exceptions, off by default, that never touch configuration. The core promise — we never hold your configs/secrets, and sync needs no server — is unchanged.

**Rejected alternatives:**

- _dotden cloud backend_ — would enable real push and git-free onboarding, but turns the project into a SaaS that hosts everyone's secret-bearing dotfiles. Not worth the liability or scope.
- _Any git remote, not just GitHub_ — **adopted (see ADR 0020).** The conveniences (repo creation, change detection) are an additive per-Provider layer above a universal pure-git floor, not a GitHub dependency. Multi-provider is a committed direction; GitHub is the v1 flavor.
