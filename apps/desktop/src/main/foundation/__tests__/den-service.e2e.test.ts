/**
 * DenService end-to-end thread — the issue 1-04 tracer bullet, with REAL binaries.
 *
 * Drives the whole MVP sync loop across TWO environments against real chezmoi/git
 * and disposable temp state, proving the acceptance criteria are wired end to end:
 *
 *   env A:  Track a File → Commit (templated message, LOCAL until pushed) → Sync push
 *   env B:  clone the Den → list incoming (incoming-clean only) → Apply → File on disk
 *
 * It also asserts the two cross-cutting properties this slice stands up: the synced
 * `.myenv/` (default Workspace + environment registry) travels through the Remote,
 * and a non-applicable File is never applied on env B.
 */
/* eslint-disable turbo/no-undeclared-env-vars -- integration test discovers local chezmoi/git binaries. */
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cloneRepo, GitTransport } from '../git-transport.js'
import { DenService } from '../den-service.js'
import { MyenvStore } from '../myenv-store.js'
import { OperationTracer } from '../operation-tracer.js'
import { runCommand } from '../process.js'

let root: string
let chezmoiBin: string
let gitBin: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dotden-e2e-'))
  chezmoiBin = await requireTool('chezmoi', 'DOTDEN_CHEZMOI_BIN')
  gitBin = await requireTool('git', 'DOTDEN_GIT_BIN')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('DenService end-to-end thread (real chezmoi/git)', () => {
  it('threads Track → Commit (local) → Sync push → clone → list incoming → Apply across two environments', async () => {
    // ── Shared bare Remote (the Den's only shared storage, ADR 0001) ──
    const remote = join(root, 'remote.git')
    await runCommand(gitBin, ['init', '--bare', remote])

    // ── Environment A: its source repo is the Den, its home is the fake dotfiles ──
    const aHome = join(root, 'a-home')
    const aSource = join(root, 'a-source')
    await mkdir(aHome, { recursive: true })
    await initSourceRepo(aSource, remote)
    const tracerA = new OperationTracer()
    const envA = new DenService({
      chezmoiBin,
      gitBin,
      sourceDir: aSource,
      destinationDir: aHome,
      environment: { id: 'env-a', label: 'this-mac', os: process.platform },
      tracer: tracerA,
    })

    // A user edits a real dotfile and Tracks it.
    await writeFile(join(aHome, '.zshrc'), 'export EDITOR=nvim\n')
    await envA.trackFile('.zshrc', 'trace-track')

    // Commit — LOCAL until pushed (ADR 0006). The result carries the templated
    // message and which template produced it (the Commit UI surface).
    const commit = await envA.commitTracked(['.zshrc'], 'trace-commit')
    expect(commit.pushed).toBe(false)
    expect(commit.templateId).toBe('default')
    expect(commit.message).toBe('Commit 1 file(s) from this-mac: .zshrc')
    expect(commit.committedFiles).toEqual(['.zshrc'])

    // The synced .myenv/ exists in the Den BEFORE pushing.
    const aStore = new MyenvStore(aSource)
    expect((await aStore.readEnvironments()).environments.map((e) => e.id)).toEqual(['env-a'])
    expect((await aStore.readWorkspaces()).placements).toContainEqual({
      targetPath: '.zshrc',
      workspaceId: 'personal',
    })

    // Sync now: push the local Commit to the Remote — now it is shared.
    await envA.syncPush('trace-push')

    // A wide event landed for each Operation in env A's ring buffer (ADR 0007).
    expect(tracerA.events().map((e) => e.kind)).toEqual(
      expect.arrayContaining(['track', 'commit', 'sync']),
    )

    // ── Environment B: clone the Den from the Remote (fresh, empty home) ──
    const bHome = join(root, 'b-home')
    const bSource = join(root, 'b-source')
    await mkdir(bHome, { recursive: true })
    await cloneRepo(gitBin, remote, bSource)
    const envB = new DenService({
      chezmoiBin,
      gitBin,
      sourceDir: bSource,
      destinationDir: bHome,
      environment: { id: 'env-b', label: 'work-laptop', os: process.platform },
      tracer: new OperationTracer(),
    })

    // The synced model travelled through the Remote: env B sees env A's registry
    // entry, the default Workspace, and the File placement — this is how a second
    // environment reconstructs the Den (ADR 0024).
    const bStore = new MyenvStore(bSource)
    expect((await bStore.readEnvironments()).environments[0]?.id).toBe('env-a')
    expect((await bStore.readWorkspaces()).workspaces[0]?.id).toBe('personal')

    // List incoming for a reviewed Apply — incoming-clean only (no local copy).
    expect(existsSync(join(bHome, '.zshrc'))).toBe(false)
    const incoming = await envB.listIncomingClean('trace-list')
    expect(incoming).toEqual([{ targetPath: '.zshrc', workspaceId: 'personal' }])

    // Apply writes the File to env B's disk with the exact source bytes.
    const applied = await envB.applyIncoming(['.zshrc'], 'trace-apply')
    expect(applied.applied).toEqual(['.zshrc'])
    await expect(readFile(join(bHome, '.zshrc'), 'utf8')).resolves.toBe('export EDITOR=nvim\n')
  })

  it('fileTree() reads managed Files with their placement, local status, and diff (issue 1-07)', async () => {
    const remote = join(root, 'remote.git')
    await runCommand(gitBin, ['init', '--bare', remote])

    const home = join(root, 'home')
    const source = join(root, 'source')
    await mkdir(home, { recursive: true })
    await initSourceRepo(source, remote)
    const env = new DenService({
      chezmoiBin,
      gitBin,
      sourceDir: source,
      destinationDir: home,
      environment: { id: 'env-a', label: 'this-mac', os: process.platform },
    })

    // Track + Commit one File so it is managed and clean, then a second File that we
    // leave dirty on disk so the tree shows a real local-axis status letter.
    await writeFile(join(home, '.zshrc'), 'export EDITOR=nvim\n')
    await env.trackFile('.zshrc', 'trace-track-1')
    await env.commitTracked(['.zshrc'], 'trace-commit-1')
    await writeFile(join(home, '.gitconfig'), 'name = a\n')
    await env.trackFile('.gitconfig', 'trace-track-2')
    await env.commitTracked(['.gitconfig'], 'trace-commit-2')

    // Now edit .zshrc on disk WITHOUT committing — it must show as a local modification.
    await writeFile(join(home, '.zshrc'), 'export EDITOR=nvim\nexport PAGER=less\n')

    const view = await env.fileTree()
    const byPath = new Map(view.files.map((f) => [f.targetPath, f]))
    // Both Tracked Files appear, placed in the default Workspace.
    expect(byPath.get('.zshrc')?.workspaceId).toBe('personal')
    expect(byPath.get('.gitconfig')?.workspaceId).toBe('personal')
    // The edited File carries a real local-axis status; the untouched one is clean.
    expect(byPath.get('.zshrc')?.status).toBe('modified')
    expect(byPath.get('.gitconfig')?.status).toBeNull()
    // Neither File is OS-scoped-out, so neither is muted.
    expect(byPath.get('.zshrc')?.muted).toBe(false)
    // The default Workspace travels in the view so the tree can section by Workspace.
    expect(view.workspaces[0]?.id).toBe('personal')

    // fileDiff() returns chezmoi's real unified diff for the edited File…
    const diff = await env.fileDiff('.zshrc')
    expect(diff).toContain('PAGER=less')
    // …and an empty diff for the clean File (no fabricated patch).
    await expect(env.fileDiff('.gitconfig')).resolves.toBe('')
  })

  it('env B never applies a File outside its subscription (invariant #3 end-to-end)', async () => {
    const remote = join(root, 'remote.git')
    await runCommand(gitBin, ['init', '--bare', remote])

    const aHome = join(root, 'a-home')
    const aSource = join(root, 'a-source')
    await mkdir(aHome, { recursive: true })
    await initSourceRepo(aSource, remote)
    const envA = new DenService({
      chezmoiBin,
      gitBin,
      sourceDir: aSource,
      destinationDir: aHome,
      environment: { id: 'env-a', label: 'this-mac', os: process.platform },
    })

    await writeFile(join(aHome, '.zshrc'), 'subscribed bytes\n')
    await envA.trackFile('.zshrc', 'trace-track')
    await envA.commitTracked(['.zshrc'], 'trace-commit')
    await envA.syncPush('trace-push')

    // Env B clones, but we narrow its subscription to a Workspace that does NOT own
    // the File, then ask it to apply the path directly — it must refuse to write.
    const bHome = join(root, 'b-home')
    const bSource = join(root, 'b-source')
    await mkdir(bHome, { recursive: true })
    await cloneRepo(gitBin, remote, bSource)
    const bStore = new MyenvStore(bSource)
    // Register env B subscribed to a different Workspace than the File's ('personal').
    await bStore.registerEnvironment({
      id: 'env-b',
      label: 'work-laptop',
      os: process.platform,
      subscribedWorkspaces: ['work'],
    })
    const envB = new DenService({
      chezmoiBin,
      gitBin,
      sourceDir: bSource,
      destinationDir: bHome,
      environment: { id: 'env-b', label: 'work-laptop', os: process.platform },
    })

    // listIncomingClean must NOT surface the non-subscribed File…
    expect(await envB.listIncomingClean('trace-list')).toEqual([])
    // …and a direct apply of the path is refused (witness never minted) — File stays absent.
    const applied = await envB.applyIncoming(['.zshrc'], 'trace-apply')
    expect(applied.applied).toEqual([])
    expect(existsSync(join(bHome, '.zshrc'))).toBe(false)
  })
})

/**
 * Initialize an env's source repo as a git working tree wired to the shared bare
 * Remote, with a deterministic commit identity (so `git commit` works without the
 * host's git config — identity is the test's concern, not production GitTransport).
 */
async function initSourceRepo(sourceDir: string, remote: string): Promise<void> {
  await mkdir(sourceDir, { recursive: true })
  const git = new GitTransport({ gitBin, repoDir: sourceDir })
  await git.init()
  await runCommand(gitBin, ['config', 'user.name', 'dotden tests'], { cwd: sourceDir })
  await runCommand(gitBin, ['config', 'user.email', 'dotden@example.invalid'], { cwd: sourceDir })
  // Hermetic sandbox: force commit signing off so the host's global `commit.gpgsign`
  // (which may target an interactive 1Password/SSH agent) can't hang/fail `git commit`.
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
