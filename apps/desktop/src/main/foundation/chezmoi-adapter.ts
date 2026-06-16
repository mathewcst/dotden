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
import { access, mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, relative, resolve } from 'node:path'
import { parseChezmoiStatus } from './chezmoi-status.js'
import { scopedOutPaths, type Os, type Scope } from './os-scope.js'
import { renderSubscriptionIgnore } from './subscription-ignore.js'
import { runCommand } from './process.js'

/**
 * Thrown by {@link ChezmoiAdapter.applyGuarded} when the File it is about to apply has
 * an **uncommitted local edit** at apply-time — the atomic re-check of invariant #2
 * (never lose data silently, ADR 0008). `ApplyPlanner` blocks this at plan-time, but the
 * authoritative guarantee is THIS re-check, taken immediately before the write so there
 * is no plan-time-snapshot → apply-time-write TOCTOU. The message states the fix so the
 * caller can surface it (never fail silently).
 */
export class UncommittedLocalEditError extends Error {
  constructor(readonly targetPath: string) {
    super(
      `Apply blocked: ${targetPath} has uncommitted local edits on this environment. ` +
        `Commit or discard your local changes first, then Apply (so in-progress work is not overwritten).`,
    )
    this.name = 'UncommittedLocalEditError'
  }
}

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
  /**
   * Optional path to chezmoi's **environment-local** config file (TOML).
   *
   * When set, every chezmoi invocation passes `--config <path>` so the local
   * `[data]` table — notably `dotden_env_id` (see {@link writeEnvId}) — is in scope
   * for templates like a per-environment `.chezmoiignore`. The config file is
   * environment-LOCAL state and is never synced (ADR 0024). Omitted in tests that
   * do not exercise templated config data.
   */
  readonly configPath?: string
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
   * Staging is SELECTIVE: each target's source-state file (via {@link sourcePath})
   * is resolved and only those paths are committed, so the commit records exactly
   * the chosen Files — unrelated dirty paths in the source tree are not swept in.
   *
   * @param targetPaths Destination-relative dotfile paths to capture.
   * @param message Commit message forwarded verbatim to `git commit`.
   * @param git Collaborator that stages exactly the committed Files' source paths and
   *   commits them via `git add -- <…paths>` + `git commit` (GitTransport.commit).
   * @throws CommandFailedError if any chezmoi invocation exits non-zero.
   */
  async commit(
    targetPaths: readonly string[],
    message: string,
    git: { commit(paths: readonly string[], message: string): Promise<void> },
  ): Promise<void> {
    for (const targetPath of targetPaths) {
      // re-add only refreshes an EXISTING source entry; new files must go through add.
      if (await this.isManaged(targetPath)) {
        await this.chezmoi(['re-add', this.destinationPath(targetPath)])
      } else {
        await this.track(targetPath)
      }
    }
    // Resolve each target to its source-state file so git stages exactly those paths
    // (after the add/re-add loop above, every target is managed and resolvable).
    const sourcePaths = await Promise.all(
      targetPaths.map((targetPath) => this.sourcePath(targetPath)),
    )
    await git.commit(sourcePaths, message)
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
   * Apply ONE File with the **authoritative atomic uncommitted-edit guard** (invariant
   * #2, ADR 0008) — the write path that owns "never lose data silently".
   *
   * The sequence is deliberately re-check-then-write **inside this method**, with no
   * caller-visible gap: it runs `chezmoi status` and refuses (throws
   * {@link UncommittedLocalEditError}) if the File shows a local edit in column X (the
   * last-written-vs-actual column — the user's own hand-edit on THIS environment), and
   * only then runs `chezmoi apply <file>`. Because the status probe and the apply are
   * adjacent here — not split across a plan-time snapshot and a later apply-time write —
   * there is no TOCTOU window: a File the user dirties *after* the plan was built is
   * still caught at the last possible instant before chezmoi would overwrite it.
   *
   * `ApplyPlanner` blocks the same condition at plan-time so the user sees the warning in
   * Review; this method is the load-bearing *guarantee* that the warning cannot be
   * bypassed by a stale plan. Maps to `chezmoi status` (re-check) + `chezmoi apply <dest>`.
   *
   * @param targetPath Destination-relative File path to apply (e.g. `.zshrc`).
   * @throws UncommittedLocalEditError if the File has an uncommitted local edit at this instant.
   * @throws CommandFailedError if `chezmoi status` or `chezmoi apply` exits non-zero.
   */
  async applyGuarded(targetPath: string): Promise<void> {
    // Atomic re-check: the local edit set RIGHT NOW, not from a plan-time snapshot.
    if ((await this.localEdits()).has(targetPath)) {
      // Refuse before writing — applying would silently overwrite in-progress local work.
      throw new UncommittedLocalEditError(targetPath)
    }
    // Delegate the write to {@link apply} so there is ONE write choke point (the guard is
    // the only thing this method adds on top of the per-path apply).
    await this.apply([targetPath])
  }

  /**
   * The set of destination-relative paths with an **uncommitted local edit** on this
   * environment — the local-drift axis that drives invariant #2.
   *
   * Maps to `chezmoi status`, reading **column X only** (last-written-vs-actual = the
   * user's hand-edit here) via {@link parseChezmoiStatus}; the incoming/apply-direction
   * column Y is deliberately ignored (it is the Remote axis, issue 1-09). The returned
   * set is what {@link ApplyPlanner} consumes for its plan-time block and what
   * {@link applyGuarded} re-derives for its apply-time guarantee — one faithful source of
   * "is this File dirty here?" so plan and apply agree.
   *
   * @returns Paths the user has locally modified/added/deleted but not committed.
   * @throws CommandFailedError if `chezmoi status` exits non-zero.
   */
  async localEdits(): Promise<ReadonlySet<string>> {
    return new Set(parseChezmoiStatus(await this.status()).map((entry) => entry.path))
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
   * List the destination-relative paths of every **File** chezmoi manages.
   *
   * Maps to `chezmoi managed --include files` (the `--include files` filter drops
   * managed directories so the caller gets only the leaf Files the three-pane tree
   * renders, issue 1-07). Paths are home-relative (`.zshrc`, `.config/nvim/init.lua`)
   * — the same id space as {@link status}/{@link diff}, so the renderer keys the tree,
   * the git-status axis, and the diff off one consistent path set.
   *
   * @returns The managed File paths, one per non-empty output line, sorted by chezmoi.
   * @throws CommandFailedError if chezmoi exits non-zero.
   */
  async managed(): Promise<string[]> {
    const { stdout } = await this.chezmoi(['managed', '--include', 'files'])
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
  }

  /**
   * List the destination-relative paths chezmoi is **ignoring** in this environment.
   *
   * Maps to `chezmoi ignored`. These are the Files a `.chezmoiignore` rule excludes
   * from Apply here — in dotden that is the OS-Scope "scoped out of this OS" set
   * (issue 1-15). The three-pane tree renders these rows **muted/ignored** (issue
   * 1-07 owns that rendering; the rule that drives it is compiled by
   * {@link writeOsScopeIgnore}). Returns an empty list when nothing is ignored.
   *
   * @returns The ignored destination-relative paths, one per non-empty output line.
   * @throws CommandFailedError if chezmoi exits non-zero.
   */
  async ignoredPaths(): Promise<string[]> {
    const { stdout } = await this.chezmoi(['ignored'])
    return stdout
      .split('\n')
      .map((line) => line.trim())
      .filter((line) => line.length > 0)
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
   * Compile the OS Scope feature into chezmoi's `.chezmoiignore` inside the source dir
   * (issue 1-15), so paths scoped to other operating systems are not applied here.
   *
   * The file is **fully generated and overwritten** on every call (its header warns against
   * hand-editing), and it is the SINGLE writer of `.chezmoiignore`: it always re-emits the
   * `.myenv/` rule (dotden metadata is never a managed target, ADR 0024) PLUS the
   * scoped-out paths, so it never clobbers `MyenvStore`'s `.myenv/` rule and the two
   * concerns can't drift. The scoped-out set is computed by {@link scopedOutPaths} from each
   * path's EFFECTIVE Scope (inheritance pre-folded by the caller).
   *
   * @param scope The current OS plus the per-path EFFECTIVE OS scoping to compile.
   * @returns Absolute path to the written `.chezmoiignore` file.
   */
  async writeOsScopeIgnore(scope: OsScopeIgnore): Promise<string> {
    const path = resolve(this.options.sourceDir, '.chezmoiignore')
    await mkdir(dirname(path), { recursive: true })
    await writeFile(path, renderOsScopeIgnore(scope), 'utf8')
    return path
  }

  /**
   * Compile the FULL `.chezmoiignore` — `.myenv/` rule + static OS-scope lines + the
   * dynamic **per-environment Workspace subscription** template (issue 1-13).
   *
   * This SUPERSEDES {@link writeOsScopeIgnore} as the single writer once a Den has more than
   * the default Workspace: the generated file additionally carries a chezmoi Go-template block
   * that self-identifies via `[data].dotden_env_id` (issue 1-05) and ignores every File whose
   * Workspace this environment does NOT subscribe to (ADR 0005). The OS-scope concern is still
   * folded in (the same static scoped-out paths {@link writeOsScopeIgnore} emits) so the two
   * never drift or clobber each other — it is one generated file with one writer.
   *
   * Because the subscription is decided *inside chezmoi at apply time*, ONE repo materializes
   * different subsets per environment — flipping `dotden_env_id` flips which Files are managed
   * (proven by the subscription spike). The registry-entry guard's fail-safe (a missing/empty
   * subscription ignores everything, never errors, never apply-all) lives in the template; the
   * primary ordering guard (write the entry before any apply) is the DenService's job.
   *
   * @param scope The current OS plus the per-path EFFECTIVE OS scoping (issue 1-15), whose
   *   scoped-out paths become the static OS lines alongside the subscription template.
   * @returns Absolute path to the written `.chezmoiignore` file.
   */
  async writeSubscriptionIgnore(scope: OsScopeIgnore): Promise<string> {
    const path = resolve(this.options.sourceDir, '.chezmoiignore')
    await mkdir(dirname(path), { recursive: true })
    // Reuse the OS-scope translation for the static scoped-out lines, then hand them to the
    // subscription renderer which appends the dynamic, self-identifying template block.
    const osScopedOutPaths = scopedOutPaths(scope.paths, scope.currentOs).map((targetPath) =>
      relative('.', targetPath).replaceAll('\\', '/'),
    )
    await writeFile(path, renderSubscriptionIgnore({ osScopedOutPaths }), 'utf8')
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
      // Pin the environment-local config file (when provided) so `[data].dotden_env_id`
      // is in scope for templated config like a per-environment `.chezmoiignore`.
      ...(this.options.configPath ? ['--config', this.options.configPath] : []),
      '--no-tty',
      '--force',
      ...args,
    ])
  }

  /**
   * Mirror this environment's own stable `id` into the **environment-local** chezmoi
   * config as `[data].dotden_env_id` (ADR 0024 — the per-environment subscription seam).
   *
   * This is what lets a templated `.chezmoiignore` self-identify and look up
   * `registry[.dotden_env_id].subscribedWorkspaces`, so each environment applies only
   * the Workspaces it subscribes to (issue 1-01/1-05; proven by the subscription
   * `.chezmoiignore` spike). The value is written to {@link ChezmoiAdapterOptions.configPath}
   * (TOML), which is environment-LOCAL and never synced — the id lives in the synced
   * registry too, but the *config* copy is local so it cannot cause merge churn.
   *
   * The write is surgical: an existing `dotden_env_id` line under `[data]` is replaced
   * in place, otherwise a `[data]` table (or just the key) is appended — so a
   * user-authored chezmoi config is preserved rather than clobbered.
   *
   * @param envId This environment's stable id (from the local identity / registry).
   * @returns Absolute path to the config file written.
   * @throws Error when the adapter was constructed without a `configPath`.
   */
  async writeEnvId(envId: string): Promise<string> {
    const path = this.options.configPath
    if (!path) {
      throw new Error('ChezmoiAdapter.writeEnvId requires a configPath')
    }
    await mkdir(dirname(path), { recursive: true })
    let current = ''
    try {
      current = await readFile(path, 'utf8')
    } catch {
      // No config yet — we will create one carrying just the [data].dotden_env_id key.
    }
    await writeFile(path, upsertEnvIdInToml(current, envId), 'utf8')
    return path
  }
}

/**
 * Insert or replace `dotden_env_id` inside a chezmoi config TOML's `[data]` table.
 *
 * Kept as a pure string transform (not a TOML library) so it is trivially testable
 * and adds no dependency. It handles the three cases dotden cares about:
 * - an existing `dotden_env_id = "…"` line → replaced in place;
 * - an existing `[data]` table without the key → the key is inserted right after the
 *   table header;
 * - no `[data]` table at all → a fresh `[data]` table with the key is appended.
 *
 * @param existing Current config text (empty string when the file does not exist yet).
 * @param envId The stable environment id to record.
 * @returns The updated config text, newline-terminated.
 */
export function upsertEnvIdInToml(existing: string, envId: string): string {
  const quoted = JSON.stringify(envId) // TOML basic strings share JSON's quoting/escaping.
  const keyLine = `    dotden_env_id = ${quoted}`
  const lines = existing.split('\n')

  // Case 1: replace an existing dotden_env_id assignment wherever it sits.
  const keyIndex = lines.findIndex((line) => /^\s*dotden_env_id\s*=/.test(line))
  if (keyIndex !== -1) {
    lines[keyIndex] = keyLine
    return ensureTrailingNewline(lines.join('\n'))
  }

  // Case 2: a [data] table exists but lacks the key — insert right after its header.
  const dataIndex = lines.findIndex((line) => /^\s*\[data\]\s*$/.test(line))
  if (dataIndex !== -1) {
    lines.splice(dataIndex + 1, 0, keyLine)
    return ensureTrailingNewline(lines.join('\n'))
  }

  // Case 3: no [data] table — append one carrying just the id.
  const base = existing.trim().length > 0 ? `${existing.replace(/\n*$/, '')}\n\n` : ''
  return ensureTrailingNewline(`${base}[data]\n${keyLine}`)
}

/** Guarantee exactly one trailing newline so successive writes stay stable. */
function ensureTrailingNewline(text: string): string {
  return `${text.replace(/\n*$/, '')}\n`
}

/** The relative path dotden's chezmoi-ignored synced-metadata directory lives at (ADR 0024). */
const MYENV_IGNORE_RULE = '.myenv/'

/**
 * One entry of the OS Scope feature: a managed dotfile/Folder and its **effective** Scope
 * (issue 1-15).
 *
 * `scope` is the path's EFFECTIVE Scope — the OSes it applies on AFTER the caller folded
 * Folder/Workspace inheritance ({@link import('./os-scope.js').effectiveScope}) — or `null`
 * for the universal Scope ("applies everywhere"). This adapter does not know the Folder
 * hierarchy; it only translates already-resolved effective Scopes into ignore entries.
 */
export interface OsScopedPath {
  /** Destination-relative dotfile path being scoped (e.g. `.config/foo`). */
  readonly targetPath: string
  /** EFFECTIVE Scope: the OSes this path applies on, or `null` for universal. */
  readonly scope: Scope
}

/**
 * Input to {@link renderOsScopeIgnore}: the current platform plus every scoped path.
 */
export interface OsScopeIgnore {
  /** The platform this environment is running on; paths not scoped to it are ignored. */
  readonly currentOs: Os
  /** All OS-scoped paths to consider when building the ignore list (each with its effective Scope). */
  readonly paths: readonly OsScopedPath[]
}

/**
 * Build the FULL contents of a generated `.chezmoiignore` from an OS Scope (issue 1-15).
 *
 * Emits, in order:
 * 1. a generated-file header warning the file is dotden-owned and must not be hand-edited;
 * 2. the `.myenv/` rule (dotden's synced metadata is never a managed target, ADR 0024), so
 *    this renderer can be the SINGLE writer of `.chezmoiignore` without dropping that rule;
 * 3. exactly the paths whose effective Scope does NOT include {@link OsScopeIgnore.currentOs}
 *    ({@link scopedOutPaths}), so chezmoi skips them in this environment.
 *
 * Paths are made relative and forward-slashed because chezmoi's ignore patterns are
 * POSIX-style even on Windows.
 *
 * @param scope The current OS and the per-path EFFECTIVE OS scoping.
 * @returns The full `.chezmoiignore` text, header comment included, newline-terminated.
 */
export function renderOsScopeIgnore(scope: OsScopeIgnore): string {
  const ignored = scopedOutPaths(scope.paths, scope.currentOs).map((targetPath) =>
    relative('.', targetPath).replaceAll('\\', '/'),
  )

  return [
    '# Generated by dotden. Do not edit by hand.',
    '# dotden owns this file: it keeps its synced metadata out of chezmoi, and lists',
    "# the Files/Folders scoped to other operating systems than this environment's.",
    // The synced-metadata rule ALWAYS comes first so it survives every regeneration.
    MYENV_IGNORE_RULE,
    ...ignored,
    '',
  ].join('\n')
}
