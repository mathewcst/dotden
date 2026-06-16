/**
 * GitTransport — a thin, faithful wrapper over the git CLI for the repo that
 * holds chezmoi's source state (the git-tracked dotfile templates).
 *
 * Each method maps 1:1 onto a git subcommand with no hidden reinterpretation,
 * backing dotden's Sync primitives (push/fetch/status/diff). The wrapper
 * forwards to the bundled `git` binary; it does not invent behavior.
 */
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { resolve } from 'node:path'
import { CommandFailedError, runCommand } from './process.js'

/**
 * Field separator for {@link GitTransport.log}'s machine-parsable output.
 *
 * ASCII Unit Separator (`\x1f`) — a control byte that cannot appear in a commit
 * SHA, author name/email, ISO date, or (in practice) a one-line subject, so callers
 * can split each log line on it without escaping. Newlines separate commits.
 */
const GIT_LOG_SEP = '\x1f'

/**
 * True when a git failure is the benign "the repository has no commits yet" case.
 *
 * A freshly `init`ed (or freshly cloned-empty) repo makes `git log` exit non-zero
 * with this message rather than printing an empty history. For attribution that is
 * "no activity yet", not a real error, so {@link GitTransport.log} swallows exactly
 * this case and returns an empty string.
 */
function isNoCommitsYet(error: unknown): boolean {
  if (!(error instanceof CommandFailedError)) return false
  return /does not have any commits yet|bad default revision|unknown revision/i.test(
    error.result.stderr,
  )
}

/**
 * The result of attempting a {@link GitTransport.merge} — git's own auto-merge verdict.
 *
 * This is the **cross-environment Conflict** mechanism (CONTEXT.md): `git merge`
 * auto-merges non-overlapping hunks and only leaves `<<<<<<<` markers (a `UU` status)
 * where edits actually overlap. The caller routes on {@link conflictedPaths}: an empty
 * list means the whole merge auto-resolved (no user choice needed); a non-empty list is
 * the set of true Conflicts that {@link ConflictModel} must own (invariant #1, ADR 0008).
 */
export interface MergeResult {
  /** `true` when git completed the merge with no overlapping conflicts (auto-merged). */
  readonly merged: boolean
  /** The destination-relative paths git could NOT auto-merge (`UU`); empty when `merged`. */
  readonly conflictedPaths: readonly string[]
}

/**
 * The three sides of one conflicted File, read out of git's index + working tree.
 *
 * After `git merge` stops on a `UU` File, git keeps all three versions addressable: the
 * `:2:` index stage is **ours/current** (what this environment Committed, HEAD), the
 * `:3:` stage is **theirs/incoming** (what the Remote Committed), and the working-tree
 * copy holds the `<<<<<<<`-marked union. These feed {@link ConflictModel}'s three sides
 * (Keep mine / Take theirs / Open both) verbatim.
 */
export interface ConflictedFileSides {
  /** **ours/current** bytes — git stage 2 (`git show :2:<path>`). */
  readonly current: string
  /** **theirs/incoming** bytes — git stage 3 (`git show :3:<path>`). */
  readonly incoming: string
  /** **the marker-bearing union** — the working-tree copy with `<<<<<<<`/`>>>>>>>`. */
  readonly both: string
}

/**
 * Configuration for a {@link GitTransport} instance.
 */
export interface GitTransportOptions {
  /** Path to the git binary to invoke — typically the bundled `git` shipped in app resources. */
  readonly gitBin: string
  /** Working directory of the repo to operate on (chezmoi's source dir). */
  readonly repoDir: string
}

/**
 * Faithful wrapper over the git CLI for the chezmoi source-state repo.
 *
 * Every public method shells out to a single git subcommand against
 * {@link GitTransportOptions.repoDir}, mapping a dotden Sync verb onto the
 * underlying tool with no added semantics.
 */
export class GitTransport {
  constructor(private readonly options: GitTransportOptions) {}

  /**
   * Initialize a fresh repo in `repoDir` on the `main` branch.
   *
   * Maps to `git init --initial-branch=main`. Commit identity is intentionally
   * NOT set here — the author of a commit is the user's own (global/per-repo)
   * git config, not something this foundation pins.
   *
   * @throws CommandFailedError if git exits non-zero.
   */
  async init(): Promise<void> {
    await mkdir(this.options.repoDir, { recursive: true })
    await this.git(['init', '--initial-branch=main'])
  }

  /**
   * Stage every change in the repo and record a commit (dotden's Commit verb).
   *
   * Maps to `git add --all` then `git commit --message <message>`.
   *
   * @param message Commit message to record.
   * @throws CommandFailedError if staging or committing exits non-zero
   * (e.g. nothing to commit).
   */
  async commitAll(message: string): Promise<void> {
    await this.git(['add', '--all'])
    await this.git(['commit', '--message', message])
  }

  /**
   * Stage EXACTLY the given paths and record a commit — the selective Commit
   * verb (record only the chosen Files, not everything dirty in the tree).
   *
   * Maps to `git add -- <…paths>` then `git commit --message <message>`. The `--`
   * separator plus explicit paths is git's "record exactly these" operation: only
   * the listed paths are staged, so unrelated dirty paths in the source tree stay
   * out of the commit.
   *
   * @param paths Repo-relative or absolute paths to stage (the committed Files'
   *   source-state files); passed verbatim to `git add` after `--`.
   * @param message Commit message to record.
   * @throws CommandFailedError if staging or committing exits non-zero
   * (e.g. nothing to commit).
   */
  async commit(paths: readonly string[], message: string): Promise<void> {
    await this.git(['add', '--', ...paths])
    await this.git(['commit', '--message', message])
  }

  /**
   * Stage the given paths and commit them ONLY IF the staged tree actually changed —
   * the idempotent metadata-commit primitive (issue 1-15).
   *
   * Identical to {@link commit} but tolerant of a no-op: an OS-Scope edit can be a
   * *clamp* that leaves the synced `.myenv/` + generated `.chezmoiignore` byte-for-byte
   * unchanged (e.g. a request to broaden past a Folder is clamped to the existing Scope),
   * so there is nothing to record. A plain `git commit` would exit non-zero ("nothing to
   * commit") and surface as a spurious failure; this checks `git diff --cached --quiet`
   * after staging and simply returns when the index matches HEAD — never fail loudly on a
   * legitimate no-op, never invent an empty commit.
   *
   * @param paths Repo-relative or absolute paths to stage (passed verbatim after `--`).
   * @param message Commit message to record when there is a staged change.
   * @throws CommandFailedError if staging or the (non-empty) commit exits non-zero.
   */
  async commitIfChanged(paths: readonly string[], message: string): Promise<void> {
    await this.git(['add', '--', ...paths])
    if (!(await this.hasStagedChanges())) return // index matches HEAD — nothing to record.
    await this.git(['commit', '--message', message])
  }

  /**
   * Whether the index has a staged change relative to HEAD (something to commit).
   *
   * Maps to `git diff --cached --quiet`, which exits **0** when the index matches HEAD
   * (nothing staged) and **non-zero** when there is a staged change. The codebase's
   * `runCommand` throws on a non-zero exit (like {@link merge}'s pattern), so we treat the
   * thrown case as "there is a staged change". Used by {@link commitIfChanged} to make an
   * unchanged metadata write a clean no-op rather than a "nothing to commit" failure.
   */
  private async hasStagedChanges(): Promise<boolean> {
    try {
      await this.git(['diff', '--cached', '--quiet'])
      return false // exit 0 → index matches HEAD, nothing staged.
    } catch {
      return true // non-zero exit → there is a staged change to commit.
    }
  }

  /**
   * Register a named remote pointing at `url`.
   *
   * Maps to `git remote add <name> <url>`.
   *
   * @param name Remote name (e.g. `origin`).
   * @param url Remote repository URL.
   * @throws CommandFailedError if the remote already exists or git exits non-zero.
   */
  async addRemote(name: string, url: string): Promise<void> {
    await this.git(['remote', 'add', name, url])
  }

  /**
   * Push `branch` to `remote`, setting it as the upstream (dotden's Sync push).
   *
   * Maps to `git push --set-upstream <remote> <branch>`.
   *
   * @param remote Remote name to push to. Defaults to `origin`.
   * @param branch Branch to push. Defaults to `main`.
   * @throws CommandFailedError if the push is rejected or git exits non-zero.
   */
  async push(remote = 'origin', branch = 'main'): Promise<void> {
    await this.git(['push', '--set-upstream', remote, branch])
  }

  /**
   * Fetch refs from `remote` without merging (dotden's Sync fetch).
   *
   * Maps to `git fetch <remote>`.
   *
   * @param remote Remote name to fetch from. Defaults to `origin`.
   * @throws CommandFailedError if git exits non-zero.
   */
  async fetch(remote = 'origin'): Promise<void> {
    await this.git(['fetch', remote])
  }

  /**
   * Merge `<remote>/<branch>` into the current branch — the cross-environment Conflict
   * mechanism (CONTEXT.md; ADR 0008 invariant #1).
   *
   * Maps to `git merge --no-edit <remote>/<branch>`. **Merge, not rebase** (the issue's
   * decision): rebase rewrites history and muddies the per-environment git-log
   * attribution (issue 1-05). git **auto-merges non-overlapping hunks for free** here —
   * the user is never asked about changes that don't actually conflict — and only leaves
   * `<<<<<<<` markers (a `UU` status) where edits overlap. A non-zero exit with `UU`
   * paths present is therefore NOT an error: it is exactly the true-Conflict set the
   * caller hands to {@link import('./conflict-model.js').ConflictModel}. Any other
   * non-zero exit (e.g. network) is a real failure and is rethrown.
   *
   * `--no-edit` keeps an auto-merge non-interactive (it would otherwise open an editor
   * for the merge-commit message); on conflict no commit is made at all, so the caller
   * completes it via {@link completeMerge} after resolution.
   *
   * @param remote Remote whose branch to merge. Defaults to `origin`.
   * @param branch Branch to merge. Defaults to `main`.
   * @returns Whether git auto-merged cleanly, plus the conflicted paths if not.
   * @throws CommandFailedError for a non-zero exit that is NOT a content conflict.
   */
  async merge(remote = 'origin', branch = 'main'): Promise<MergeResult> {
    try {
      await this.git(['merge', '--no-edit', `${remote}/${branch}`])
      // Exit 0 → git auto-merged everything (including non-overlapping hunks). No Conflict.
      return { merged: true, conflictedPaths: [] }
    } catch (error) {
      // A merge that stopped on overlapping hunks exits non-zero but leaves `UU` paths in
      // `git status`. Distinguish that (a true Conflict to resolve) from a real failure.
      const conflictedPaths = await this.conflictedPaths()
      if (conflictedPaths.length > 0) {
        return { merged: false, conflictedPaths }
      }
      // No conflict markers but git still failed → a genuine error (network, bad ref, …).
      throw error
    }
  }

  /**
   * List the destination-relative paths git could not auto-merge — the true Conflicts.
   *
   * Maps to `git status --porcelain=v1` and keeps the `UU` ("both modified", an
   * unmerged/overlapping conflict) entries. Non-overlapping merges never appear here
   * because git already resolved them, so this is precisely the set the
   * {@link import('./conflict-model.js').ConflictModel} owner must drive (invariant #1).
   *
   * @returns The conflicted paths (empty when the tree has no unmerged entries).
   * @throws CommandFailedError if git exits non-zero.
   */
  async conflictedPaths(): Promise<string[]> {
    const out: string[] = []
    for (const line of (await this.status()).split('\n')) {
      // Porcelain v1 unmerged conflicts are `UU <path>` (both sides modified the File).
      if (line.startsWith('UU ')) out.push(line.slice(3).trim())
    }
    return out
  }

  /**
   * Read the three sides of one conflicted File from git's index + working tree.
   *
   * Maps to `git show :2:<path>` (ours/current/HEAD), `git show :3:<path>`
   * (theirs/incoming), and a read of the working-tree copy (the `<<<<<<<`-marked union).
   * These are the exact bytes {@link import('./conflict-model.js').ConflictModel} exposes
   * as its Keep mine / Take theirs / Open both sides — no reinterpretation.
   *
   * @param path Destination-relative File path that is in Conflict (a `UU` entry).
   * @returns The current/incoming/both bytes for the File.
   * @throws CommandFailedError if either index stage cannot be read.
   */
  async conflictedFile(path: string): Promise<ConflictedFileSides> {
    // `git show :N:<path>` prints index stage N: 2 = ours (HEAD), 3 = theirs (MERGE_HEAD).
    const current = (await this.git(['show', `:2:${path}`])).stdout
    const incoming = (await this.git(['show', `:3:${path}`])).stdout
    // The "both" side is the working-tree copy git wrote with `<<<<<<<` conflict markers —
    // the union the user can open and hand-edit. Read it directly off disk (falling back to
    // an empty string only if the File is absent, e.g. a delete/modify conflict).
    const both = (await this.readWorkingTreeFile(path)) ?? ''
    return { current, incoming, both }
  }

  /**
   * Write resolved bytes for one File and stage it as resolved — the resolution write.
   *
   * Writes `bytes` to the working-tree File then maps to `git add -- <path>`, which marks
   * the previously-`UU` entry as resolved. The bytes come ONLY from
   * {@link import('./conflict-model.js').ResolvedConflict} (the user's explicit choice),
   * so this method never invents a resolution — it just persists one (ADR 0008 #1).
   *
   * @param path Destination-relative File path being resolved.
   * @param bytes The exact resolved bytes (from a user choice) to write + stage.
   * @throws CommandFailedError if staging exits non-zero.
   */
  async writeResolved(path: string, bytes: string): Promise<void> {
    await writeFile(resolve(this.options.repoDir, path), bytes, 'utf8')
    await this.git(['add', '--', path])
  }

  /**
   * Complete an in-progress merge once every conflicted File has been staged-as-resolved.
   *
   * Maps to `git commit --no-edit` (records the pending MERGE_HEAD as a merge commit). The
   * caller must have resolved every `UU` path via {@link writeResolved} first; git refuses
   * to commit while unmerged entries remain, which is the backstop that an unresolved
   * Conflict can never be silently committed.
   *
   * @param message Optional merge-commit subject; defaults to git's generated message.
   * @throws CommandFailedError if unmerged entries remain or git exits non-zero.
   */
  async completeMerge(message?: string): Promise<void> {
    const args = message ? ['commit', '--message', message] : ['commit', '--no-edit']
    await this.git(args)
  }

  /**
   * Abort an in-progress merge, restoring the pre-merge state.
   *
   * Maps to `git merge --abort`. This is the **Abort** action in the resolver: it throws
   * away the half-merged working tree and returns to HEAD, so a user who does not want to
   * resolve right now loses nothing (and nothing is auto-resolved).
   *
   * @throws CommandFailedError if there is no merge to abort or git exits non-zero.
   */
  async abortMerge(): Promise<void> {
    await this.git(['merge', '--abort'])
  }

  /** Read a working-tree File's bytes, or `null` when it is absent (e.g. a delete conflict). */
  private async readWorkingTreeFile(path: string): Promise<string | null> {
    try {
      return await readFile(resolve(this.options.repoDir, path), 'utf8')
    } catch {
      return null
    }
  }

  /**
   * Return the working-tree status in stable, machine-parsable form.
   *
   * Maps to `git status --porcelain=v1` — the v1 porcelain format is contracted
   * to be stable across git versions, so callers can parse it reliably.
   *
   * @returns Raw porcelain stdout (empty string when the tree is clean).
   * @throws CommandFailedError if git exits non-zero.
   */
  async status(): Promise<string> {
    return (await this.git(['status', '--porcelain=v1'])).stdout
  }

  /**
   * Read the current branch's tip commit SHA — the local "where this environment is"
   * marker the {@link import('./tray-poller.js').TrayPoller} seeds itself with.
   *
   * Maps to `git rev-parse HEAD`. The poller compares the *Remote's* advertised SHA
   * (`git ls-remote`, issue 1-03) against this so the FIRST observed Remote SHA equal
   * to local HEAD is correctly "nothing new" rather than a spurious notification. A
   * repo with no commits yet (fresh init/clone-empty) has no HEAD, so this returns
   * `null` rather than throwing — the poller then treats the first Remote SHA as
   * genuinely incoming (correct for a brand-new clone).
   *
   * @returns The 40-char HEAD SHA, or null when the repo has no commits yet.
   * @throws CommandFailedError for any non-zero exit that is NOT "no commits yet".
   */
  async headSha(): Promise<string | null> {
    try {
      return (await this.git(['rev-parse', 'HEAD'])).stdout.trim() || null
    } catch (error) {
      // A fresh repo has an unborn HEAD; rev-parse fails. That is "no commit yet", not
      // an error — return null so the poller's first comparison is against "nothing seen".
      if (isNoCommitsYet(error)) return null
      throw error
    }
  }

  /**
   * Read the URL of a named remote — the Remote URL the
   * {@link import('./tray-poller.js').TrayPoller} hands to `git ls-remote` each tick.
   *
   * Maps to `git remote get-url <remote>`. Returns `null` when the remote is not
   * configured (e.g. a Den initialized but never connected to a Remote), so the poller
   * can stay dormant rather than poll a non-existent Remote (never fail by guessing).
   *
   * @param remote Remote name to read. Defaults to `origin`.
   * @returns The configured URL, or null when the remote does not exist.
   */
  async remoteUrl(remote = 'origin'): Promise<string | null> {
    try {
      return (await this.git(['remote', 'get-url', remote])).stdout.trim() || null
    } catch {
      // No such remote configured — the Den has no Remote to poll yet.
      return null
    }
  }

  /**
   * Return the diff of the working tree against a ref.
   *
   * Maps to `git diff <ref>`.
   *
   * @param ref Ref to diff against. Defaults to `HEAD`.
   * @returns Raw diff stdout.
   * @throws CommandFailedError if git exits non-zero.
   */
  async diff(ref = 'HEAD'): Promise<string> {
    return (await this.git(['diff', ref])).stdout
  }

  /**
   * Read the commit history, optionally scoped to a path, in a stable parsable form.
   *
   * Maps to `git log --pretty=<fmt> [--max-count=<n>] [-- <path>]`. This is the
   * attribution source for the environment registry: "who changed this" / last-sync
   * / activity are **derived from git log, never written to the registry** (ADR 0024),
   * so the synced `.myenv/` registry stays small and merge-friendly.
   *
   * The format is `%H` (full SHA), `%an` (author name), `%ae` (author email),
   * `%aI` (author date, strict ISO-8601), `%s` (subject) joined by an ASCII Unit
   * Separator (`\x1f`), one commit per line — chosen over the porcelain because it
   * is unambiguous to split even when a subject contains tabs or arbitrary text.
   *
   * @param options Optional `path` to scope history to and `maxCount` to cap entries.
   * @returns Raw stdout (empty string when there are no commits, e.g. a fresh repo).
   * @throws CommandFailedError if git exits non-zero for a reason other than "no commits".
   */
  async log(options: { readonly path?: string; readonly maxCount?: number } = {}): Promise<string> {
    const args = [
      'log',
      `--pretty=format:%H${GIT_LOG_SEP}%an${GIT_LOG_SEP}%ae${GIT_LOG_SEP}%aI${GIT_LOG_SEP}%s`,
    ]
    if (typeof options.maxCount === 'number') args.push(`--max-count=${options.maxCount}`)
    if (options.path) args.push('--', options.path)
    try {
      return (await this.git(args)).stdout
    } catch (error) {
      // A brand-new repo with zero commits makes `git log` exit non-zero
      // ("does not have any commits yet"). That is not an error for attribution —
      // it just means there is no activity yet, so surface an empty history.
      if (isNoCommitsYet(error)) return ''
      throw error
    }
  }

  /**
   * Run a git subcommand in the repo directory.
   *
   * The dir is re-created (`mkdir` recursive, a no-op if it exists) on every
   * call so the cwd is guaranteed to exist even if a prior step or external
   * process removed it — git fails hard when invoked in a missing cwd.
   */
  private async git(args: readonly string[]) {
    await mkdir(this.options.repoDir, { recursive: true })
    return runCommand(this.options.gitBin, args, { cwd: this.options.repoDir })
  }
}

/**
 * Clone the `main` branch of `remoteUrl` into `destination` and return a
 * {@link GitTransport} bound to the cloned repo.
 *
 * Maps to `git clone --branch main <remoteUrl> <destination>`. Commit identity is
 * intentionally NOT pinned here (it's the user's own git config); a caller that
 * commits through the returned transport is responsible for configuring identity.
 *
 * @param gitBin Path to the git binary (typically the bundled `git`).
 * @param remoteUrl Repository URL to clone.
 * @param destination Local directory to clone into; becomes the transport's repoDir.
 * @returns A configured transport for the freshly cloned repo.
 * @throws CommandFailedError if the clone exits non-zero.
 */
export async function cloneRepo(
  gitBin: string,
  remoteUrl: string,
  destination: string,
): Promise<GitTransport> {
  await runCommand(gitBin, ['clone', '--branch', 'main', remoteUrl, destination])
  return new GitTransport({ gitBin, repoDir: destination })
}
