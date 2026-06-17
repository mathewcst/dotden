# dotden

A cross-platform desktop GUI that wraps **chezmoi**, letting a user manage and sync their **Den** (their whole configuration) across every **environment** they work on — without learning chezmoi's command line.

## Where things live

- **Domain glossary** — [`CONTEXT.md`](CONTEXT.md). What every term means (Den, environment, Workspace, Commit, Apply…) and the dotden↔chezmoi mapping. Speak this vocabulary in code and copy.
- **Decisions + rationale** — [`docs/adr/`](docs/adr/). Every hard, surprising, hard-to-reverse choice. Read the relevant ADR before changing behavior it governs.
- **v1 scope** — [`docs/scope-v1.md`](docs/scope-v1.md). What ships in v1, and what's deliberately deferred.
- **Roadmap** — [`docs/roadmap.md`](docs/roadmap.md). Post-v1 enhancements.
- **Dev conventions (craft)** — [`docs/conventions.md`](docs/conventions.md). Tests, components, main-process layering, renderer feature-folders + scoped den-session store (ADR 0027), comments, lint/format.
- **Design system** — [`docs/design-system/`](docs/design-system/). Tokens, components, and per-screen specs (Figma-mirrored). Start at its README; grep `inventory.md` for node IDs.
- **Brand & UI copy** — [`docs/brand-and-vocabulary.md`](docs/brand-and-vocabulary.md). App name, positioning, capitalization, and in-app label wording.

## Ground rules

- Stay a **faithful chezmoi wrapper** (ADR 0003): every concept maps to a real chezmoi concept; rename only for presentation.
- **Never fail silently** — surface what happened and the fix; empty/fallback states are first-class UI.
- Public OSS: **over-comment rather than under** (ADR 0021).
