# 0020 — Provider-agnostic pure-git floor; v1 leans on the user's git credentials

**Status:** Accepted. **Supersedes** the GitHub-specific clauses of [ADR 0001](./0001-pure-git-github-no-backend.md) (the "any git remote" rejected alternative; the "GitHub App scoped to one repo" auth mechanism; one-click repo creation).

**Decision:** dotden is **provider-agnostic at the transport floor**. The Remote is a plain git remote on any **Provider** — GitHub, GitLab, Bitbucket, self-hosted GitLab/Gitea/Forgejo, or a bare git remote over SSH. Multi-provider is a **committed long-term direction**, not a maybe; **GitHub is the v1 flavor, not a single-provider restriction**.

For **v1 we ship "V1-Lean":** dotden does **no authentication of its own** and **creates no Remote**. It holds no token, no keychain entry, no GitHub App, no OAuth. First-run is _"connect your repo"_: the user creates an empty private repo on their Provider, pastes the URL, dotden `git ls-remote` preflights credentials, then `chezmoi init <url>` clones+initializes. Push/fetch ride the user's existing SSH key or git credential helper. Change-detection uses `git ls-remote` (a git primitive), not any Provider API.

Provider-specific **conveniences** — OAuth/device-flow sign-in, one-click Remote creation, API-based change detection — are an **additive layer above the floor**, built one Provider at a time (GitHub first), and **deferred past v1**.

**Why:** dotden is a GUI over chezmoi, and chezmoi is **pure git underneath** — it does nothing provider-specific and "does not store any credentials," relying on local git config (verified, chezmoi docs, June 2026). So the transport floor — clone/push/fetch/`ls-remote` — already works on _every_ Provider with working git credentials, at zero per-provider cost. Every "GitHub-specific" thing in the original spec (device-flow auth, one-click create, API SHA-compare) was never chezmoi; it was a convenience dotden layered on top. Pulling repo creation out of v1 also dissolves the original GitHub-App-vs-OAuth fight: that fight existed _only_ because creating a repo (`POST /user/repos`) needed a broad/Administration grant. With no creation in v1, v1 auth reduces to "a credential git already accepts," which the user's own SSH/PAT supplies.

**The trade-off we accepted:** v1 gives up the "no PAT pasting / frictionless sign-in" promise — a v1 user must have working git credentials for their Provider (which dotden's actual v1 audience, chezmoi-adjacent power users, already do). The polished sign-in and one-click create are _sequenced_ into the post-v1 convenience layer, not abandoned. In exchange v1 is the smallest possible auth surface and is trivially multi-provider from day one.

**Consequences:**

- Registering a GitHub App and building a `GitHubAppClient` leave v1 scope; the latter is replaced by a "connect-an-existing-Remote + `ls-remote` preflight" slice. User stories 3–5 (device-flow sign-in, keychain token, one-click create) move to the convenience layer.
- The tray poller uses `git ls-remote` for SHA-compare, not the GitHub API.
- "Greenfield" is redefined: an _empty_ repo the **user** created which dotden initializes (vs v2's adopting a repo with existing _foreign chezmoi_ content).
- Git operations stay behind a thin module boundary so the future per-Provider convenience layer can wrap them; we do **not** build a provider-capability interface in v1 (one implementation — system git — means YAGNI).

**Open decision deferred to the convenience layer:** when we build per-Provider auth, **OAuth** is the _portable_ primitive (GitHub Apps are GitHub-only, with no GitLab/Bitbucket analogue), but a GitHub App gives tighter _least-privilege_ than OAuth's all-or-nothing `repo` scope — which matters to dotden's privacy pitch. Resolve "per-Provider-optimal auth vs one-portable-OAuth-everywhere" then, with a spike proving the chosen create-repo + push-token flow first (`gh`'s OAuth-device-flow approach is the proven fallback).

**Rejected alternatives:**

- _V1-OAuth-token (friendly GitHub sign-in in v1, minus creation)_ — keeps the polished onboarding but reintroduces GitHub-only auth code in the MVP and still falls back to system creds for other Providers. Rejected: it pulls the deferred convenience layer into v1 for one Provider, against the "be closer to chezmoi" goal.
- _Keep building the GitHub App + one-click create for v1 (the status quo)_ — picks a **non-portable** auth primitive (GitHub App has no analogue on other Providers) for a product now committed to multi-provider, and carries the unproven user-token `POST /user/repos` assumption. Rejected on portability + scope grounds.
