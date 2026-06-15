# 0003 — dotden as a faithful wrapper over chezmoi

dotden stays aligned with chezmoi rather than inventing divergent semantics. User-facing actions such as **Commit**, **Apply**, **Untrack**, and **Delete everywhere** are presentation names over real chezmoi/git operations, with the mapping maintained in `CONTEXT.md`. The deliberate addition is dotden's **Workspace** / **Folder** organization and environment-subscription metadata, stored in a chezmoi-ignored area so chezmoi never treats it as managed target state.

This keeps the repo a valid chezmoi setup and makes dotden easier to reason about: every feature starts with “how does chezmoi already express this?” If dotden adds metadata, it must compile down to chezmoi/git behavior or stay clearly isolated from chezmoi semantics.
