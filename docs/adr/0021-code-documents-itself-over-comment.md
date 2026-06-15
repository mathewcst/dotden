# 0021 — Code documents itself; we over-comment rather than under

**Status:** accepted · 2026-06-15

dotden is a **public OSS** project (the "public OSS monorepo" decision in `CONTEXT.md`) whose source is read by newcomers — and by AI agents — to learn _why_, not just _what_. So in-code documentation is a first-class requirement, not an afterthought, and we bias deliberately toward **more** explanation: a redundant comment costs a line, a missing one costs a reader an hour. When in doubt, document.

**What this means in practice:**

- **Every exported symbol carries a TSDoc/JSDoc block** — classes, interfaces, type aliases, functions, and public methods. Document the _contract_: what it guarantees, what it throws (`@throws`), and what `@param`/`@returns` _mean_ — never restate the TypeScript type the signature already gives.
- **Explain the non-obvious _why_ inline.** Implementation choices a reader would otherwise reverse-engineer — `shell: false` to remove an injection surface, `--no-tty --force` to keep chezmoi non-interactive, re-`mkdir` before each git call — get a short `//` comment stating the reason.
- **State the faithful-wrapper mapping (ADR 0003).** Because dotden is a presentation layer over chezmoi/git, any method that shells out names the CLI command it maps to (`track` → `chezmoi add`; Commit → add/re-add + `git commit`). The mapping _is_ documentation, and writing it down keeps the wrapper honest.
- **Each module gets a file-level header** describing its role in the architecture.
- **Speak the domain glossary** (`CONTEXT.md`) — source vs destination state, target path, Den, Workspace, Remote — so comments use the same language as the code and the product.

**Over- beats under-, but noise is still noise.** "Bias toward more" is not license to restate the obvious (`/** The constructor. */`) or to add boilerplate tags (`@author`, `@version`, `@date`). The test is whether a comment saves a reader work; if it only echoes the code, drop it. Self-evident private one-liners need nothing.

## Consequences

- New exported API without documentation should not pass review; "add the docs" is a valid review block.
- Documentation is **additive** — adding or refining comments never changes behavior, so it is always a safe, low-risk diff and a good first contribution.
- The reference implementation is `apps/desktop/src/main/` (the faithful-wrapper foundation); match its altitude and style when documenting new code.
- Applies to all hand-written TypeScript across `apps/*` and `packages/*`. Generated code and vendored sources are exempt.
- Enforcement is **review-based today** — `@dotden/eslint-config` carries no `jsdoc` rules, so `pnpm check` does _not_ yet flag missing/malformed docs. Wiring `eslint-plugin-jsdoc` into the shared config (so the convention becomes mechanical) is the recommended follow-up.
