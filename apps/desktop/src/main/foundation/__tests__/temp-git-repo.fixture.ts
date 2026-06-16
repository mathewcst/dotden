/**
 * Test fixture: builds a throwaway, fully-wired dotden sandbox in a tempdir.
 *
 * createTempDotdenRepo() lays out the three directories dotden operates over —
 * a chezmoi `home` (destination), a chezmoi `source` dir that doubles as the git
 * working repo, and a bare `remote.git` to push/fetch against — then returns a
 * ChezmoiAdapter and GitTransport already pointed at them, plus a cleanup().
 * Not shipped: this exists only so integration tests can exercise the real
 * chezmoi/git CLIs against disposable state.
 */
/* eslint-disable turbo/no-undeclared-env-vars -- integration fixture discovers local test binaries. */
import { chmod, mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { ChezmoiAdapter } from '../chezmoi-adapter.js'
import { GitTransport } from '../git-transport.js'
import { runCommand } from '../process.js'

/**
 * A fully-provisioned, disposable dotden environment for integration tests.
 *
 * Bundles the on-disk layout (the three dirs + resolved binaries) together with
 * adapters already wired to that layout, so a test can drive real chezmoi/git
 * operations and then tear everything down via {@link DotdenTestRepo.cleanup}.
 */
export interface DotdenTestRepo {
  /** Tempdir holding the whole sandbox; everything below lives under here, and cleanup() removes it. */
  readonly root: string
  /** chezmoi destination dir — the fake home where applied dotfiles (e.g. `.zshrc`) land. */
  readonly home: string
  /** chezmoi source dir AND the git working repo — holds source-state files (e.g. `dot_zshrc`) under version control. */
  readonly source: string
  /** Path to the bare `remote.git`, the push/fetch target for sync tests. */
  readonly remote: string
  /** Absolute path to the chezmoi binary resolved for this run (env override or PATH probe). */
  readonly chezmoiBin: string
  /** Absolute path to the git binary resolved for this run (env override or PATH probe). */
  readonly gitBin: string
  /** ChezmoiAdapter pre-wired to {@link source} (source) and {@link home} (destination). */
  readonly chezmoi: ChezmoiAdapter
  /** GitTransport pre-wired to {@link source} as its repo dir, with `origin` set to {@link remote}. */
  readonly git: GitTransport
  /** Recursively deletes {@link root}. Idempotent (force); call in test teardown. */
  readonly cleanup: () => Promise<void>
}

/**
 * Creates and wires up a fresh {@link DotdenTestRepo} on disk.
 *
 * Provisions a unique tempdir, creates the home/source dirs, discovers the
 * chezmoi/git binaries, inits the source repo, creates a bare remote, links
 * `origin`, and returns adapters bound to all of it.
 *
 * @returns A ready-to-use sandbox; the caller owns teardown via `cleanup()`.
 * @throws Error if the chezmoi or git binary cannot be found (see {@link requireTool}).
 *
 * @example
 * const repo = await createTempDotdenRepo()
 * try {
 *   await repo.chezmoi.track('.zshrc')   // -> `chezmoi add` against repo.source/repo.home
 * } finally {
 *   await repo.cleanup()
 * }
 */
export async function createTempDotdenRepo(): Promise<DotdenTestRepo> {
  // `dotden-` prefix + random suffix keeps parallel test runs from colliding.
  const root = await mkdtemp(join(tmpdir(), 'dotden-'))
  const home = join(root, 'home')
  const source = join(root, 'source')
  const remote = join(root, 'remote.git')
  await mkdir(home, { recursive: true })
  await mkdir(source, { recursive: true })

  const chezmoiBin = await requireTool('chezmoi', 'DOTDEN_CHEZMOI_BIN')
  const gitBin = await requireTool('git', 'DOTDEN_GIT_BIN')
  const git = new GitTransport({ gitBin, repoDir: source })
  await git.init()
  // Pin a deterministic commit identity on the source repo so chezmoi.commit()
  // (which records via `git commit`) works without depending on the host's git
  // config. This belongs in the test fixture, not production GitTransport.init().
  await runCommand(gitBin, ['config', 'user.name', 'dotden tests'], { cwd: source })
  await runCommand(gitBin, ['config', 'user.email', 'dotden@example.invalid'], { cwd: source })
  // Disable commit signing in the sandbox: a developer's global git config may enable
  // `commit.gpgsign` against an interactive signer (e.g. a 1Password/SSH agent), which
  // cannot complete in a headless test run and would hang/fail `git commit`. The test
  // repo must be hermetic, so we force signing off regardless of the host config.
  await runCommand(gitBin, ['config', 'commit.gpgsign', 'false'], { cwd: source })
  // Bare remote = a valid push/fetch target with no working tree of its own.
  await runCommand(gitBin, ['init', '--bare', remote])
  await git.addRemote('origin', remote)

  return {
    root,
    home,
    source,
    remote,
    chezmoiBin,
    gitBin,
    chezmoi: new ChezmoiAdapter({ chezmoiBin, sourceDir: source, destinationDir: home }),
    git,
    cleanup: () => rm(root, { recursive: true, force: true }),
  }
}

/**
 * Writes a minimal `chmod +x` shell stub at `path` (prints "stub" and exits 0).
 *
 * Used by tests that need a discoverable, runnable executable on disk without
 * depending on a real tool — e.g. to exercise PATH/env-override resolution.
 *
 * @param path Absolute destination for the stub script.
 */
export async function createExecutableStub(path: string): Promise<void> {
  await writeFile(path, '#!/bin/sh\necho stub\n', 'utf8')
  await chmod(path, 0o755)
}

/**
 * Resolves a tool binary: env-var override wins, else first PATH hit, else throws.
 *
 * @throws Error if neither the env override nor a PATH probe locates the binary.
 */
async function requireTool(name: string, envName: string): Promise<string> {
  const fromEnv = process.env[envName]
  if (fromEnv) return fromEnv
  const found = await findOnPath(name)
  if (found) return found
  throw new Error(`${name} binary not found. Set ${envName}.`)
}

// Probes each PATH entry by actually running `<candidate> --version`: a clean
// exit proves the file exists, is executable, and is the right tool — cheaper
// to reason about than stat + mode checks across platforms.
async function findOnPath(name: string): Promise<string | undefined> {
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    const candidate = join(directory, name)
    try {
      await runCommand(candidate, ['--version'])
      return candidate
    } catch {
      // continue
    }
  }
  return undefined
}
