/**
 * GitTransport — a thin, faithful wrapper over the git CLI for the repo that
 * holds chezmoi's source state (the git-tracked dotfile templates).
 *
 * Each method maps 1:1 onto a git subcommand with no hidden reinterpretation,
 * backing dotden's Sync primitives (push/fetch/status/diff). The wrapper
 * forwards to the bundled `git` binary; it does not invent behavior.
 */
import { mkdir } from 'node:fs/promises'
import { runCommand } from './process.js'

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
   * Initialize a fresh repo in `repoDir` on the `main` branch and pin a
   * deterministic commit identity.
   *
   * Maps to `git init --initial-branch=main` followed by two `git config`
   * calls. The fixed test identity (`dotden tests` / `dotden@example.invalid`)
   * keeps commit hashes and author metadata reproducible across runs.
   *
   * @throws CommandFailedError if any git invocation exits non-zero.
   */
  async init(): Promise<void> {
    await mkdir(this.options.repoDir, { recursive: true })
    await this.git(['init', '--initial-branch=main'])
    await this.git(['config', 'user.name', 'dotden tests'])
    await this.git(['config', 'user.email', 'dotden@example.invalid'])
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
 * Maps to `git clone --branch main <remoteUrl> <destination>`, then pins the
 * same deterministic commit identity as {@link GitTransport.init} so commits
 * made through the returned transport are reproducible.
 *
 * @param gitBin Path to the git binary (typically the bundled `git`).
 * @param remoteUrl Repository URL to clone.
 * @param destination Local directory to clone into; becomes the transport's repoDir.
 * @returns A configured transport for the freshly cloned repo.
 * @throws CommandFailedError if the clone or either config call exits non-zero.
 */
export async function cloneRepo(
  gitBin: string,
  remoteUrl: string,
  destination: string,
): Promise<GitTransport> {
  await runCommand(gitBin, ['clone', '--branch', 'main', remoteUrl, destination])
  const transport = new GitTransport({ gitBin, repoDir: destination })
  await runCommand(gitBin, ['config', 'user.name', 'dotden tests'], { cwd: destination })
  await runCommand(gitBin, ['config', 'user.email', 'dotden@example.invalid'], { cwd: destination })
  return transport
}
