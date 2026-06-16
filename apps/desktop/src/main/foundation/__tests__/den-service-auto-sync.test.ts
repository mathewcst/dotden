/**
 * DenService Auto-sync — the automation-level wiring, with REAL chezmoi/git (issue 1-12).
 *
 * Proves the AutomationPolicy actually changes behavior end to end:
 *   - Manual (the default): Commit is LOCAL — `pushed: false`, nothing reaches the Remote
 *     until Sync now;
 *   - Auto-sync: the SAME Commit auto-pushes — `pushed: true`, the change lands on the
 *     Remote with no Sync now — but Commit itself is still explicit (transport-not-commit).
 *
 * Also exercises `pollSnapshot()` (the Remote URL + HEAD SHA the TrayPoller seeds with).
 */
/* eslint-disable turbo/no-undeclared-env-vars -- integration test discovers local chezmoi/git binaries. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GitTransport } from '../git-transport.js'
import { DenService } from '../den-service.js'
import { runCommand } from '../process.js'

let root: string
let chezmoiBin: string
let gitBin: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dotden-autosync-'))
  chezmoiBin = await requireTool('chezmoi', 'DOTDEN_CHEZMOI_BIN')
  gitBin = await requireTool('git', 'DOTDEN_GIT_BIN')
})
afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** Count the commits advertised on the bare Remote's `main` (0 when nothing pushed yet). */
async function remoteCommitCount(remote: string): Promise<number> {
  const out = (await runCommand(gitBin, ['ls-remote', remote, 'refs/heads/main'])).stdout.trim()
  return out.length > 0 ? 1 : 0
}

describe('DenService Auto-sync (real chezmoi/git, issue 1-12)', () => {
  it('Manual: Commit stays LOCAL — pushed:false, nothing on the Remote until Sync now', async () => {
    const remote = join(root, 'remote.git')
    await runCommand(gitBin, ['init', '--bare', remote])
    const home = join(root, 'home')
    const source = join(root, 'source')
    await mkdir(home, { recursive: true })
    await initSourceRepo(source, remote)

    const den = new DenService({
      chezmoiBin,
      gitBin,
      sourceDir: source,
      destinationDir: home,
      environment: { id: 'env-a', label: 'this-mac', os: process.platform },
      // default automationLevel omitted ⇒ Manual.
    })

    await writeFile(join(home, '.zshrc'), 'export EDITOR=nvim\n')
    await den.trackFile('.zshrc', 't-track')
    const commit = await den.commitTracked(['.zshrc'], 't-commit')

    expect(commit.pushed).toBe(false)
    // The Remote has nothing yet — Manual never auto-pushes.
    expect(await remoteCommitCount(remote)).toBe(0)

    // Sync now pushes it explicitly.
    await den.syncPush('t-push')
    expect(await remoteCommitCount(remote)).toBe(1)
  })

  it('Auto-sync: the same Commit auto-pushes — pushed:true, the change reaches the Remote', async () => {
    const remote = join(root, 'remote.git')
    await runCommand(gitBin, ['init', '--bare', remote])
    const home = join(root, 'home')
    const source = join(root, 'source')
    await mkdir(home, { recursive: true })
    await initSourceRepo(source, remote)

    const den = new DenService({
      chezmoiBin,
      gitBin,
      sourceDir: source,
      destinationDir: home,
      environment: { id: 'env-a', label: 'this-mac', os: process.platform },
      automationLevel: 'auto-sync',
    })

    await writeFile(join(home, '.zshrc'), 'export EDITOR=nvim\n')
    await den.trackFile('.zshrc', 't-track')
    const commit = await den.commitTracked(['.zshrc'], 't-commit')

    // Auto-sync pushed the already-Committed change with no Sync now.
    expect(commit.pushed).toBe(true)
    expect(await remoteCommitCount(remote)).toBe(1)
  })

  it('pollSnapshot reports the Remote URL + local HEAD SHA (the TrayPoller seed)', async () => {
    const remote = join(root, 'remote.git')
    await runCommand(gitBin, ['init', '--bare', remote])
    const home = join(root, 'home')
    const source = join(root, 'source')
    await mkdir(home, { recursive: true })
    await initSourceRepo(source, remote)
    const den = new DenService({
      chezmoiBin,
      gitBin,
      sourceDir: source,
      destinationDir: home,
      environment: { id: 'env-a', label: 'this-mac', os: process.platform },
    })

    // Before any commit: a Remote is configured, but HEAD is unborn.
    const before = await den.pollSnapshot()
    expect(before.remoteUrl).toBe(remote)
    expect(before.headSha).toBeNull()

    await writeFile(join(home, '.zshrc'), 'export EDITOR=nvim\n')
    await den.trackFile('.zshrc', 't-track')
    await den.commitTracked(['.zshrc'], 't-commit')

    // After a Commit: HEAD is a real 40-char SHA the poller seeds itself with.
    const after = await den.pollSnapshot()
    expect(after.headSha).toMatch(/^[0-9a-f]{40}$/)
  })
})

/** Init an env's source repo as a working tree wired to the bare Remote, hermetic identity. */
async function initSourceRepo(sourceDir: string, remote: string): Promise<void> {
  await mkdir(sourceDir, { recursive: true })
  const git = new GitTransport({ gitBin, repoDir: sourceDir })
  await git.init()
  await runCommand(gitBin, ['config', 'user.name', 'dotden tests'], { cwd: sourceDir })
  await runCommand(gitBin, ['config', 'user.email', 'dotden@example.invalid'], { cwd: sourceDir })
  await runCommand(gitBin, ['config', 'commit.gpgsign', 'false'], { cwd: sourceDir })
  await git.addRemote('origin', remote)
}

/** Resolve a tool binary: env override wins, else first PATH hit, else throw. */
async function requireTool(name: string, envName: string): Promise<string> {
  const fromEnv = process.env[envName]
  if (fromEnv) return fromEnv
  for (const directory of (process.env.PATH ?? '').split(delimiter)) {
    const candidate = join(directory, name)
    try {
      await runCommand(candidate, ['--version'])
      return candidate
    } catch {
      // keep probing PATH
    }
  }
  throw new Error(`${name} binary not found. Set ${envName}.`)
}
