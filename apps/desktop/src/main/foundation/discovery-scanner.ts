/**
 * DiscoveryScanner — the first-run tool-catalog discovery scan (issue 1-06).
 *
 * On first run, dotden offers to Track the config Files the user already has on
 * disk. The suggestions are **grounded in a catalog of known tools** rather than a
 * blind "everything that exists" sweep, so what surfaces is *relevant* (a real
 * `.zshrc` / `.gitconfig` / Neovim config), not noise.
 *
 * This is the onboarding read-side of ADR 0022's central idea: the onboarding gate
 * is **feature-detection, not emptiness**. Here that means we detect *which known
 * tools the environment actually uses* by probing the catalog's candidate paths,
 * instead of suggesting from an undifferentiated directory listing. (ADR 0022's
 * post-clone C1/C2 chezmoi-feature classifier is the v1.1 sibling of this idea on
 * the Remote side; this module is the v1 home-dir side.)
 *
 * It is **Electron-free** (ADR 0023): it only reads the filesystem via
 * `node:fs/promises`, so the whole scan is testable in plain Node against a temp
 * home dir. It performs **no chezmoi/git work** — it only *finds candidate Files*;
 * Tracking the picks is the existing 1-04 {@link import('./den-service.js').DenService.trackFile}
 * path (`chezmoi add` + a `.dotden/` placement), which onboarding calls per pick.
 */
import { stat } from 'node:fs/promises'
import { isAbsolute, resolve } from 'node:path'

/**
 * One known tool in the discovery catalog.
 *
 * A catalog entry names a tool and the destination-relative config paths it is
 * *known* to use. The scanner probes each candidate path under the environment's
 * home dir; any that exist become a suggestion attributed to this tool, so the UI
 * can group suggestions by the tool the user recognizes ("Zsh", "Git", "Neovim").
 */
export interface CatalogTool {
  /** Stable id for the tool, used for grouping + as a React key (e.g. `zsh`). */
  readonly id: string
  /** Human label shown as the suggestion group header (e.g. `Zsh`). */
  readonly label: string
  /**
   * Destination-relative config paths this tool is known to use (e.g. `.zshrc`,
   * `.config/nvim`). Probed in order under the environment's home dir; each that
   * exists on disk becomes a {@link DiscoverySuggestion}.
   */
  readonly candidates: readonly string[]
}

/**
 * One suggested config File (or Folder) the scan found on disk.
 *
 * Carries enough for the Discover UI to render a `ListRow`: the path to show, the
 * tool it belongs to (for grouping), whether it is a Folder (so the copy can say
 * "Folder" vs "File", CONTEXT.md), and its size for the row's `Meta` slot.
 */
export interface DiscoverySuggestion {
  /** Destination-relative path of the found config (e.g. `.zshrc`), the Track target. */
  readonly targetPath: string
  /** Id of the catalog tool this path belongs to (groups the Discover list). */
  readonly toolId: string
  /** Human label of that tool, for the group header. */
  readonly toolLabel: string
  /** True when the path is a directory — a managed **Folder**, not a single **File**. */
  readonly isFolder: boolean
  /** Size in bytes (a File's own size, or 0 for a Folder); drives the row's size meta. */
  readonly sizeBytes: number
}

/** Wiring for a {@link DiscoveryScanner}. */
export interface DiscoveryScannerOptions {
  /** The environment's home/destination dir to scan (the same dir Apply writes into). */
  readonly homeDir: string
  /**
   * Catalog to ground the scan in; defaults to {@link DEFAULT_TOOL_CATALOG}. Injectable
   * so tests can drive a tiny catalog and a future Settings surface can extend it.
   */
  readonly catalog?: readonly CatalogTool[]
}

/**
 * The built-in catalog of known tools whose config Files dotden suggests Tracking.
 *
 * Deliberately a curated, well-known set rather than an exhaustive registry: the
 * point of grounding (ADR 0022) is *relevance*, so we list the configs a developer
 * is most likely to want synced. Anything the catalog misses is still manageable —
 * the Discover step lets the user **drag in / browse** for extra Files (the
 * acceptance criterion "manage anything, not just catalog entries"), which Track
 * through the very same path.
 *
 * Paths are POSIX-style and destination-relative (resolved under the home dir);
 * Folders (e.g. `.config/nvim`) are supported and surface as managed **Folders**.
 */
export const DEFAULT_TOOL_CATALOG: readonly CatalogTool[] = [
  { id: 'zsh', label: 'Zsh', candidates: ['.zshrc', '.zshenv', '.zprofile'] },
  { id: 'bash', label: 'Bash', candidates: ['.bashrc', '.bash_profile', '.profile'] },
  { id: 'git', label: 'Git', candidates: ['.gitconfig', '.gitignore_global'] },
  { id: 'starship', label: 'Starship', candidates: ['.config/starship.toml'] },
  { id: 'neovim', label: 'Neovim', candidates: ['.config/nvim'] },
  { id: 'vim', label: 'Vim', candidates: ['.vimrc'] },
  { id: 'tmux', label: 'tmux', candidates: ['.tmux.conf', '.config/tmux/tmux.conf'] },
  { id: 'wezterm', label: 'WezTerm', candidates: ['.wezterm.lua', '.config/wezterm'] },
  { id: 'alacritty', label: 'Alacritty', candidates: ['.config/alacritty'] },
  { id: 'ghostty', label: 'Ghostty', candidates: ['.config/ghostty/config'] },
  { id: 'kitty', label: 'kitty', candidates: ['.config/kitty'] },
  { id: 'ssh', label: 'SSH', candidates: ['.ssh/config'] },
  { id: 'editorconfig', label: 'EditorConfig', candidates: ['.editorconfig'] },
]

/**
 * Result of a {@link DiscoveryScanner.scan}.
 *
 * Suggestions are flat (the UI groups them by `toolId`); the count is surfaced
 * separately so the Discover step can drive empty/"found N" copy without re-counting.
 */
export interface DiscoveryScanResult {
  /** Every config File/Folder the scan found, grounded in the catalog. */
  readonly suggestions: readonly DiscoverySuggestion[]
}

/**
 * Scans an environment's home dir for known-tool config Files to suggest Tracking.
 *
 * The scanner is intentionally **read-only and side-effect-free**: it never runs
 * chezmoi/git and never writes anything. It answers exactly one question — "which
 * catalog-known config paths exist here?" — so the rest of onboarding (Track via the
 * 1-04 path, default Workspace via {@link import('./den-store.js').DenStore.seedDefault})
 * stays in its own owner.
 */
export class DiscoveryScanner {
  private readonly catalog: readonly CatalogTool[]

  /**
   * @param options Home dir to scan + optional catalog override.
   */
  constructor(private readonly options: DiscoveryScannerOptions) {
    this.catalog = options.catalog ?? DEFAULT_TOOL_CATALOG
  }

  /**
   * Probe every catalog candidate under the home dir and return the ones that exist.
   *
   * For each catalog tool, each candidate path is `stat`-ed under the home dir; a
   * hit becomes a {@link DiscoverySuggestion} tagged with its tool (for grouping),
   * Folder-ness (File vs Folder copy), and size (the row meta). A missing path or any
   * `stat` error is simply skipped — discovery never fails because a guessed path is
   * absent (that is the normal case for most catalog entries).
   *
   * Suggestions are de-duplicated by `targetPath` so a path that two tools both claim
   * surfaces once (attributed to the first tool that listed it), keeping the Discover
   * list clean.
   *
   * @returns The found config Files/Folders, grounded in the catalog.
   */
  async scan(): Promise<DiscoveryScanResult> {
    const seen = new Set<string>()
    const suggestions: DiscoverySuggestion[] = []
    for (const tool of this.catalog) {
      for (const candidate of tool.candidates) {
        // De-dup across tools so a shared path (rare, but e.g. `.profile`) appears once.
        if (seen.has(candidate)) continue
        const probe = await this.probe(candidate)
        if (!probe) continue
        seen.add(candidate)
        suggestions.push({
          targetPath: candidate,
          toolId: tool.id,
          toolLabel: tool.label,
          isFolder: probe.isFolder,
          sizeBytes: probe.sizeBytes,
        })
      }
    }
    return { suggestions }
  }

  /**
   * Inspect an **arbitrary** destination-relative path the user dragged in or browsed
   * for, so the Discover step can Track Files the catalog missed.
   *
   * This is the "manage anything, not just catalog entries" acceptance criterion: the
   * UI hands a path (which must live under the home dir — Track operates on
   * destination-relative paths), and we return a suggestion shaped exactly like a scan
   * hit (attributed to a synthetic `custom` tool) so it renders in the same list.
   *
   * @param targetPath Destination-relative path the user picked (e.g. `.config/foo`).
   * @returns A suggestion when the path exists under the home dir; `null` otherwise
   *   (a non-existent or out-of-home path is not a manageable target — never fail
   *   silently: the caller surfaces "that file isn't under your home directory").
   */
  async inspectCustomPath(targetPath: string): Promise<DiscoverySuggestion | null> {
    // Reject absolute/escaping paths up front: Track targets are home-relative, and a
    // path that resolves outside the home dir cannot be a chezmoi destination target.
    if (isAbsolute(targetPath) || !this.isUnderHome(targetPath)) return null
    const probe = await this.probe(targetPath)
    if (!probe) return null
    return {
      targetPath,
      toolId: 'custom',
      toolLabel: 'Added by you',
      isFolder: probe.isFolder,
      sizeBytes: probe.sizeBytes,
    }
  }

  /** True when a destination-relative path stays within the home dir after resolution. */
  private isUnderHome(targetPath: string): boolean {
    const home = resolve(this.options.homeDir)
    const resolved = resolve(home, targetPath)
    return resolved === home || resolved.startsWith(home + pathSep())
  }

  /**
   * `stat` a destination-relative path under the home dir.
   *
   * @returns `{ isFolder, sizeBytes }` when the path exists, or `null` when it is
   *   absent or unreadable (the common, non-error case for a guessed catalog path).
   */
  private async probe(
    targetPath: string,
  ): Promise<{ isFolder: boolean; sizeBytes: number } | null> {
    try {
      const info = await stat(resolve(this.options.homeDir, targetPath))
      // A directory is a managed Folder; report 0 bytes for it (its own inode size is
      // not meaningful as "config size") and the File's byte size otherwise.
      return { isFolder: info.isDirectory(), sizeBytes: info.isDirectory() ? 0 : info.size }
    } catch {
      return null
    }
  }
}

/** Path separator used for the under-home containment check (platform-native). */
function pathSep(): string {
  // `resolve` produces native separators, so compare against the native one.
  return process.platform === 'win32' ? '\\' : '/'
}
