/**
 * shiki-config-langs — a `shiki` barrel trimmed to the grammars dotden renders (issue 1-07).
 *
 * ## Why this exists
 *
 * `@pierre/diffs` highlights diffs by importing several symbols from the bare `shiki`
 * specifier — `bundledLanguages`, `createHighlighter`, the two engine factories,
 * `codeToHtml`, `createCssVariablesTheme`. The real `shiki` barrel statically imports
 * Shiki's **full** language + theme bundles (`bundledLanguages` is a map of ~330 lazy
 * `import()` grammar loaders, and `createHighlighter` closes over the full map). Rollup
 * cannot tree-shake a dynamic-import map, so the renderer build emits an async chunk for
 * EVERY grammar (csharp, wolfram, emacs-lisp ~780 kB, latex, swift, …) even though
 * dotden only ever renders **config files**. That is dead weight in the bundle.
 *
 * This module is aliased in for the bare `shiki` specifier (see `electron.vite.config.ts`).
 * Critically it imports ONLY from `shiki/core` + the engine subpaths (which carry no
 * grammars) and rebuilds the barrel surface — `bundledLanguages` and `createHighlighter`
 * — over a map restricted to dotden's config languages. It deliberately does NOT
 * `export *` from the full `shiki` barrel, because that re-pulls the full grammar bundle
 * into the graph regardless of which bindings are re-exported (the original leak).
 *
 * Any language id outside the set below resolves to `undefined`, so `@pierre/diffs`
 * falls back to plain, un-highlighted text for it — fine, those are not dotfiles dotden
 * manages.
 *
 * ## The config-language set
 *
 * Keys cover both canonical grammar ids AND the aliases `@pierre/diffs`' filename→lang
 * map yields for config files (`sh`/`bash`/`zsh` → the zsh/shell grammar, `vim`/`viml`/
 * `vimscript` → viml, `yaml`/`yml` → yaml, …). Alias ids share a loader so the
 * dynamic-import chunks dedupe to one per real grammar. Add a language HERE (and only
 * here) when dotden begins rendering a new config language.
 */

// Grammar-free Shiki internals (no `bundledLanguages`/`bundledThemes` are reachable
// from these subpaths, so importing them pulls in zero TextMate grammars).
import {
  createBundledHighlighter,
  codeToHtml,
  createCssVariablesTheme,
  getTokenStyleObject,
  stringifyTokenStyle,
} from 'shiki/core'
import { createJavaScriptRegexEngine } from 'shiki/engine/javascript'
import { createOnigurumaEngine } from 'shiki/engine/oniguruma'

// Each loader is the same `@shikijs/langs/<grammar>` module Shiki's full bundle would
// have lazily imported — so highlighting is byte-identical, just for fewer languages.
const shell = () => import('@shikijs/langs/shellscript')
const zsh = () => import('@shikijs/langs/zsh')
const fish = () => import('@shikijs/langs/fish')
const json = () => import('@shikijs/langs/json')
const jsonc = () => import('@shikijs/langs/jsonc')
const json5 = () => import('@shikijs/langs/json5')
const yaml = () => import('@shikijs/langs/yaml')
const toml = () => import('@shikijs/langs/toml')
const ini = () => import('@shikijs/langs/ini')
const properties = () => import('@shikijs/langs/properties')
const lua = () => import('@shikijs/langs/lua')
const viml = () => import('@shikijs/langs/viml')
const dotenv = () => import('@shikijs/langs/dotenv')
const sshConfig = () => import('@shikijs/langs/ssh-config')
const nginx = () => import('@shikijs/langs/nginx')
const nix = () => import('@shikijs/langs/nix')
const powershell = () => import('@shikijs/langs/powershell')
const xml = () => import('@shikijs/langs/xml')
const markdown = () => import('@shikijs/langs/markdown')
const diff = () => import('@shikijs/langs/diff')

/**
 * The trimmed replacement for Shiki's `bundledLanguages`. Keys are every language id
 * `@pierre/diffs` may resolve a config File to (canonical + aliases); values are the
 * grammar loaders above.
 */
export const bundledLanguages = {
  // shell family — `.sh`/`.bash`/`.zshrc` all resolve to the zsh/shell grammar.
  shellscript: shell,
  shell,
  sh: shell,
  bash: shell,
  zsh,
  fish,
  // structured config
  json,
  jsonc,
  json5,
  yaml,
  yml: yaml,
  toml,
  ini,
  cfg: ini,
  properties,
  dotenv,
  // editor / tool configs
  lua,
  viml,
  vim: viml,
  vimscript: viml,
  'ssh-config': sshConfig,
  nginx,
  nix,
  powershell,
  ps1: powershell,
  xml,
  markdown,
  md: markdown,
  diff,
}

/**
 * `createHighlighter` rebuilt the same way Shiki's full bundle builds it — via
 * `createBundledHighlighter` — but closed over the TRIMMED language map and an empty
 * theme map (dotden uses a CSS-variables theme, and `@pierre/diffs` attaches themes
 * lazily). The default engine is the dependency-free JS regex engine; `@pierre/diffs`
 * passes its own `engine` to every `createHighlighter()` call anyway, so this default
 * is only a fallback and never drags in the wasm grammar of the oniguruma engine.
 */
export const createHighlighter = createBundledHighlighter({
  langs: bundledLanguages,
  themes: {},
  engine: () => createJavaScriptRegexEngine(),
})

// The remaining symbols `@pierre/diffs` imports from `shiki`, re-exported from the
// grammar-free subpaths so the bare-`shiki` surface it depends on stays complete.
export {
  codeToHtml,
  createCssVariablesTheme,
  createJavaScriptRegexEngine,
  createOnigurumaEngine,
  getTokenStyleObject,
  stringifyTokenStyle,
}
