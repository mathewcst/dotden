/**
 * ChezmoiAdapter — a FAITHFUL wrapper over the bundled `chezmoi` CLI.
 *
 * Maps dotden's dotfile verbs 1:1 onto chezmoi subcommands with no hidden
 * reinterpretation: track -> `chezmoi add`, commit -> re-add/add + `git commit`,
 * apply -> `chezmoi apply`, untrack -> `chezmoi forget`, deleteEverywhere ->
 * `chezmoi destroy`. It also exposes source-path/status/diff and compiles the
 * OS Scope feature into a generated `.chezmoiignore` (see {@link renderOsScopeIgnore}).
 *
 * Two distinct trees are always in play:
 * - source state / source dir: chezmoi's git-tracked repo of dotfile templates,
 *   where `.zshrc` is stored as `dot_zshrc`.
 * - destination / destination dir: the real home directory where dotfiles live
 *   (e.g. `~/.zshrc`).
 * A "target path" is a path RELATIVE to the destination/home (the user-facing
 * dotfile path like `.zshrc`); {@link ChezmoiAdapter.destinationPath} resolves it
 * against the destination dir before handing it to chezmoi.
 */
import { access, mkdir, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { runCommand } from './process.js'

/**
 * Wiring for a {@link ChezmoiAdapter}: the chezmoi binary plus the two trees it
 * operates across.
 */
export interface ChezmoiAdapterOptions {
  /** Path to the chezmoi executable — normally the binary bundled inside the app. */
  readonly chezmoiBin: string
  /** chezmoi's source dir: the git-tracked repo of dotfile templates (`dot_zshrc`, …). */
  readonly sourceDir: string
  /** The destination/home dir where managed dotfiles actually live (`~/.zshrc`, …). */
  readonly destinationDir: string
}

/**
 * Faithful adapter mapping dotden verbs onto the bundled chezmoi CLI. Every
 * shelling-out method states its CLI mapping below. All chezmoi invocations are
 * funneled through the private {@link ChezmoiAdapter.chezmoi} helper so the same
 * source/destination context is always supplied.
 */
export class ChezmoiAdapter {
  constructor(private readonly options: ChezmoiAdapterOptions) {}

  /**
   * Start managing a destination file by importing it into the source state.
   *
   * Maps to `chezmoi add <dest>`.
   *
   * @param targetPath Dotfile path relative to the destination/home (e.g. `.zshrc`).
   * @throws CommandFailedError if chezmoi exits non-zero.
   */
  async track(targetPath: string): Promise<void> {
    await this.chezmoi(['add', this.destinationPath(targetPath)])
  }

  /**
   * Re-import the listed dotfiles from the destination into the source state and
   * commit the result, mirroring a "save my changes" action.
   *
   * For each target path: if it is already managed it maps to `chezmoi re-add`
   * (refresh an existing source entry), otherwise it falls back to {@link track}
   * (`chezmoi add`). The git commit is delegated so this adapter stays a pure
   * chezmoi wrapper.
   *
   * @param targetPaths Destination-relative dotfile paths to capture.
   * @param message Commit message forwarded verbatim to `git commit`.
   * @param git Collaborator that stages and commits the source repo via `git add --all` + `git commit` (GitTransport.commitAll).
   * @throws CommandFailedError if any chezmoi invocation exits non-zero.
   */
  async commit(
    targetPaths: readonly string[],
    message: string,
    git: { commitAll(message: string): Promise<void> },
  ): Promise<void> {
    for (const targetPath of targetPaths) {
      // re-add only refreshes an EXISTING source entry; new files must go through add.
      if (await this.isManaged(targetPath)) {
        await this.chezmoi(['re-add', this.destinationPath(targetPath)])
      } else {
        await this.track(targetPath)
      }
    }
    await git.commitAll(message)
  }

  /**
   * Render the source state onto the destination, i.e. write managed dotfiles to home.
   *
   * Maps to `chezmoi apply [<dest>…]`.
   *
   * @param targetPaths Optional subset of destination-relative paths to apply;
   *   empty (the default) applies everything chezmoi manages.
   * @throws CommandFailedError if chezmoi exits non-zero.
   */
  async apply(targetPaths: readonly string[] = []): Promise<void> {
    await this.chezmoi(['apply', ...targetPaths.map((path) => this.destinationPath(path))])
  }

  /**
   * Stop managing a dotfile, removing it from the source state while leaving the
   * destination copy untouched.
   *
   * Maps to `chezmoi forget <dest>`.
   *
   * @param targetPath Destination-relative dotfile path to forget.
   * @throws CommandFailedError if chezmoi exits non-zero.
   */
  async untrack(targetPath: string): Promise<void> {
    await this.chezmoi(['forget', this.destinationPath(targetPath)])
  }

  /**
   * Remove a dotfile from BOTH the source state and the destination — the
   * destructive "delete everywhere" verb.
   *
   * Maps to `chezmoi destroy --force <dest>`. `--force` is passed so chezmoi does
   * not interactively prompt for confirmation.
   *
   * @param targetPath Destination-relative dotfile path to destroy.
   * @throws CommandFailedError if chezmoi exits non-zero.
   */
  async deleteEverywhere(targetPath: string): Promise<void> {
    await this.chezmoi(['destroy', '--force', this.destinationPath(targetPath)])
  }

  /**
   * Report which managed dotfiles differ between source and destination.
   *
   * Maps to `chezmoi status`.
   *
   * @returns chezmoi's raw status output (porcelain-style lines on stdout).
   * @throws CommandFailedError if chezmoi exits non-zero.
   */
  async status(): Promise<string> {
    return (await this.chezmoi(['status'])).stdout
  }

  /**
   * Show the diff chezmoi would apply from the source state to the destination.
   *
   * Maps to `chezmoi diff [<dest>…]`.
   *
   * @param targetPaths Optional subset of destination-relative paths to diff;
   *   empty (the default) diffs everything managed.
   * @returns chezmoi's raw unified diff on stdout.
   * @throws CommandFailedError if chezmoi exits non-zero.
   */
  async diff(targetPaths: readonly string[] = []): Promise<string> {
    return (await this.chezmoi(['diff', ...targetPaths.map((path) => this.destinationPath(path))]))
      .stdout
  }

  /**
   * Resolve the source-state file that backs a destination dotfile (e.g. `.zshrc`
   * -> the `dot_zshrc` file inside the source dir).
   *
   * Maps to `chezmoi source-path <dest>`.
   *
   * @param targetPath Destination-relative dotfile path.
   * @returns Absolute path to the corresponding file in the source state.
   * @throws CommandFailedError if chezmoi exits non-zero (e.g. path not managed).
   */
  async sourcePath(targetPath: string): Promise<string> {
    return (await this.chezmoi(['source-path', this.destinationPath(targetPath)])).stdout.trim()
  }

  /**
   * Compile the OS Scope feature into chezmoi's `.chezmoiignore` inside the source
   * dir, so paths scoped to other operating systems are not applied here.
   *
   * The file contents come from {@link renderOsScopeIgnore}; it is fully generated
   * and overwritten on every call (its header warns against hand-editing).
   *
   * @param scope The current OS plus the per-path OS scoping to compile.
   * @returns Absolute path to the written `.chezmoiignore` file.
   */
  async writeOsScopeIgnore(scope: OsScopeIgnore): Promise<string> {
    const path = resolve(this.options.sourceDir, '.chezmoiignore')
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, renderOsScopeIgnore(scope), 'utf8')
    return path
  }

  /**
   * Probe whether a target path is already tracked in the source state.
   *
   * Works by resolving its {@link sourcePath} and checking that file exists on
   * disk; a missing source file (or any error) is treated as "not managed". Used
   * by {@link commit} to choose between `re-add` and `add`.
   */
  private async isManaged(targetPath: string): Promise<boolean> {
    try {
      await access(await this.sourcePath(targetPath))
      return true
    } catch {
      return false
    }
  }

  /** Resolve a destination-relative target path into an absolute path under the destination dir. */
  private destinationPath(path: string): string {
    return resolve(this.options.destinationDir, path)
  }

  /**
   * Single choke point for invoking the bundled chezmoi CLI. Always supplies the
   * adapter's source/destination context and non-interactive flags so behavior is
   * deterministic regardless of any host chezmoi config or TTY.
   *
   * @param args chezmoi subcommand and arguments, appended after the standard flags.
   * @throws CommandFailedError if chezmoi exits non-zero (propagated from runCommand).
   */
  private async chezmoi(args: readonly string[]) {
    // Ensure both trees exist up front so chezmoi never fails on a missing dir.
    await mkdir(this.options.sourceDir, { recursive: true })
    await mkdir(this.options.destinationDir, { recursive: true })
    return runCommand(this.options.chezmoiBin, [
      // Pin source/destination explicitly so we never inherit a host chezmoi config,
      // and force non-interactive (--no-tty, --force) so calls can't hang on a prompt.
      '--source',
      this.options.sourceDir,
      '--destination',
      this.options.destinationDir,
      '--no-tty',
      '--force',
      ...args,
    ])
  }
}

/**
 * One entry of the OS Scope feature: a managed dotfile and the set of operating
 * systems it is scoped to.
 */
export interface OsScopedPath {
  /** Destination-relative dotfile path being scoped (e.g. `.config/foo`). */
  readonly targetPath: string
  /** Platforms on which this path is in scope; on others it is ignored by chezmoi. */
  readonly oses: readonly NodeJS.Platform[]
}

/**
 * Input to {@link renderOsScopeIgnore}: the current platform plus every scoped path.
 */
export interface OsScopeIgnore {
  /** The platform this environment is running on; paths not scoped to it are ignored. */
  readonly currentOs: NodeJS.Platform
  /** All OS-scoped paths to consider when building the ignore list. */
  readonly paths: readonly OsScopedPath[]
}

/**
 * Build the contents of a generated `.chezmoiignore` from an OS Scope.
 *
 * Emits exactly the paths NOT scoped to {@link OsScopeIgnore.currentOs} (so chezmoi
 * skips them in this environment), prefixed by a generated-file header that warns
 * the file is owned by dotden and must not be hand-edited. Paths are made relative
 * and forward-slashed because chezmoi's ignore patterns are POSIX-style even on
 * Windows.
 *
 * @param scope The current OS and the per-path OS scoping.
 * @returns The full `.chezmoiignore` text, header comment included, newline-terminated.
 */
export function renderOsScopeIgnore(scope: OsScopeIgnore): string {
  const ignored = scope.paths
    .filter((path) => !path.oses.includes(scope.currentOs))
    .map((path) => relative('.', path.targetPath).replaceAll('\\', '/'))

  return [
    '# Generated by dotden from File/Folder OS Scope. Do not edit by hand.',
    "# Paths listed here are outside this environment's Scope.",
    ...ignored,
    '',
  ].join('\n')
}
