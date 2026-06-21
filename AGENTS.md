# dotden

A cross-platform desktop GUI that wraps **chezmoi**, letting a user manage and sync their **Den** (their whole configuration) across every **environment** they work on — without learning chezmoi's command line.

## Where things live

- **Domain glossary** — [`CONTEXT.md`](CONTEXT.md). What every term means (Den, environment, Workspace, Commit, Apply…) and the dotden↔chezmoi mapping. Speak this vocabulary in code and copy.
- **Decisions + rationale** — [`docs/adr/`](docs/adr/). Every hard, surprising, hard-to-reverse choice. Read the relevant ADR before changing behavior it governs.
- **v1 scope** — [`docs/scope-v1.md`](docs/scope-v1.md). What ships in v1, and what's deliberately deferred.
- **Roadmap** — [`docs/roadmap.md`](docs/roadmap.md). Post-v1 enhancements.
- **Dev conventions (craft)** — [`docs/conventions.md`](docs/conventions.md). Tests, components, main-process layering, the `src/shared` IPC contract (renderer never imports `main/**`, ADR 0031), renderer three-layer architecture (`app → features → shared`) + scoped den-session store + `ui/`-vs-`den/` component tiers + structural lint gates (ADR 0027 revised by 0033/0034/0035/0036), comments, lint/format.
- **Design system** — [`docs/design-system/`](docs/design-system/). Tokens, components, and per-screen specs (Figma-mirrored). Start at its README; grep `inventory.md` for node IDs.
- **Brand & UI copy** — [`docs/brand-and-vocabulary.md`](docs/brand-and-vocabulary.md). App name, positioning, capitalization, and in-app label wording.

## Ground rules

- **chezmoi is a tool, not a mandate** (ADR 0038, revising ADR 0003): use chezmoi where it does the job best (attributes, templating, secrets, idempotent apply); own transport, source-state merge, and anything interactive (git directly + dotden's `ConflictModel`). The repo still stays a valid chezmoi setup and vocabulary still maps to chezmoi where chezmoi owns the concept.
- **Never fail silently** — surface what happened and the fix; empty/fallback states are first-class UI.
- Public OSS: **over-comment rather than under** (ADR 0021).
