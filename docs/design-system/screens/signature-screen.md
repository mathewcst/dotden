# Signature screen (Figma page `03 · App — Main`)

> The main three-pane window — the reference for the whole system and the source-of-truth
> for tokens/icon colors (`54:3`). Part of the [design system](../README.md); built as an
> [`AppShell` + default panes](../components.md).

The main three-pane window — the reference for the whole system:

- **Title bar:** traffic lights · ember "Personal" workspace switcher · centered `⌘K` search ·
  sync status · bell · settings · environment avatar.
- **Left pane (sidebar):** `WORKSPACES` header · Personal/Work workspace sections · nested file
  tree with M/A statuses + `↓`/`!` decorations · `this-mac` environment footer.
- **Center pane:** selected `~/.zshrc` — file header (`● modified` tag, **Commit changes** ember
  primary, Discard) · tabs (Changes/History/Scope) · token-bound red/green **diff** with line
  numbers.
- **Right pane (inspector):** neutral _incoming changes_ callout (Review & Apply) · file info
  (Workspace / Scope chips / Last commit / Secrets) · recent commits · environments with status dots.
