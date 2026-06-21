/**
 * DenService offline queue — queued pushes + retry on reconnect/next Sync (issue 1-16),
 * with REAL chezmoi/git.
 *
 * Proves the end-to-end offline contract (ADR 0006) the slice promises:
 *   - **Commit succeeds offline** — a Commit made while the Remote is unreachable still
 *     records locally (`pushed:false`), and under Auto-sync its push is QUEUED (`queued:true`),
 *     never failing the operation.
 *   - **Queued push flushes on the next Sync** — once the Remote is reachable again, `syncPush`
 *     pushes every unpushed commit and clears the queue (`pushPending()` → false).
 *   - **Queued push flushes on reconnect** — `flushPushQueue` is the reconnect retry path:
 *     it sends the queued commits and clears the queue.
 *   - **Survives a restart, no duplicate/drop** — a fresh DenService over the same dirs sees
 *     the persisted pending flag and flushes the SAME commits exactly once.
 *
 * The offline trigger is deterministic + fast: `origin` points at an SSH URL on a closed
 * local port with a short `GIT_SSH_COMMAND` ConnectTimeout, so `git push` fails with a real
 * "Connection refused/timed out" — git's genuine offline signature (classified by
 * `isOfflineError`) — without a flaky real network. The DenService inherits `process.env`
 * through `runCommand`, so the test's `GIT_SSH_COMMAND` reaches the real git invocation.
 */
/* eslint-disable turbo/no-undeclared-env-vars -- integration test discovers local chezmoi/git binaries + tunes ssh timeout. */
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { GitTransport } from '../git-transport.js'
import { DenService } from '../den-service.js'
import { runCommand } from '../platform/process.js'

let root: string
let chezmoiBin: string
let gitBin: string
let savedSshCommand: string | undefined

/** An SSH URL to a closed local port → a fast, deterministic "connection refused" offline push. */
const UNREACHABLE_REMOTE = 'ssh://git@127.0.0.1:1/den.git'

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dotden-offline-'))
  chezmoiBin = await requireTool('chezmoi', 'DOTDEN_CHEZMOI_BIN')
  gitBin = await requireTool('git', 'DOTDEN_GIT_BIN')
  // Bound the SSH connect so the "offline" push fails in ~1s rather than the default minutes,
  // and never prompts. The DenService's git inherits this via process.env (runCommand merge).
  savedSshCommand = process.env.GIT_SSH_COMMAND
  process.env.GIT_SSH_COMMAND =
    'ssh -o BatchMode=yes -o ConnectTimeout=1 -o StrictHostKeyChecking=no'
})
afterEach(async () => {
  if (savedSshCommand === undefined) delete process.env.GIT_SSH_COMMAND
  else process.env.GIT_SSH_COMMAND = savedSshCommand
  await rm(root, { recursive: true, force: true })
})

/** Count the commits advertised on the bare Remote's `main` (0 when nothing pushed yet). */
async function remoteCommitCount(remote: string): Promise<number> {
  const out = (await runCommand(gitBin, ['ls-remote', remote, 'refs/heads/main'])).stdout.trim()
  return out.length > 0 ? 1 : 0
}

describe('DenService offline queue (real chezmoi/git, issue 1-16)', () => {
  it('Auto-sync offline: Commit records locally, the push is QUEUED, then a later Sync flushes it', async () => {
    const realRemote = join(root, 'remote.git')
    await runCommand(gitBin, ['init', '--bare', realRemote])
    const home = join(root, 'home')
    const source = join(root, 'source')
    const outbox = join(root, 'push-outbox.json')
    await mkdir(home, { recursive: true })
    // Wire origin to the UNREACHABLE remote first so the auto-push fails offline.
    await initSourceRepo(source, UNREACHABLE_REMOTE)

    const den = new DenService({
      chezmoiBin,
      gitBin,
      sourceDir: source,
      destinationDir: home,
      environment: { id: 'env-a', label: 'this-mac', os: process.platform },
      automationLevel: 'auto-sync',
      pushOutboxPath: outbox,
    })

    await writeFile(join(home, '.zshrc'), 'export EDITOR=nvim\n')
    await den.trackFile('.zshrc', 't-track')

    // Commit while "offline": it MUST succeed locally and queue the push, not throw.
    const commit = await den.commitTracked(['.zshrc'], 't-commit')
    expect(commit.pushed).toBe(false)
    expect(commit.queued).toBe(true)
    expect(await den.pushPending()).toBe(true)
    // Nothing reached the (real) Remote — the change is only local + queued.
    expect(await remoteCommitCount(realRemote)).toBe(0)

    // Reconnect: point origin at the reachable Remote and Sync now. One push flushes the
    // queued commit and clears the outbox (queued pushes flush on the next Sync).
    await runCommand(gitBin, ['remote', 'set-url', 'origin', realRemote], { cwd: source })
    const sync = await den.syncPush('t-sync')
    expect(sync.pushed).toBe(true)
    expect(sync.queued).toBe(false)
    expect(await den.pushPending()).toBe(false)
    expect(await remoteCommitCount(realRemote)).toBe(1)
  })

  it('reconnect path: a queued push flushes via flushPushQueue() exactly once', async () => {
    const realRemote = join(root, 'remote.git')
    await runCommand(gitBin, ['init', '--bare', realRemote])
    const home = join(root, 'home')
    const source = join(root, 'source')
    const outbox = join(root, 'push-outbox.json')
    await mkdir(home, { recursive: true })
    await initSourceRepo(source, UNREACHABLE_REMOTE)

    const den = new DenService({
      chezmoiBin,
      gitBin,
      sourceDir: source,
      destinationDir: home,
      environment: { id: 'env-a', label: 'this-mac', os: process.platform },
      automationLevel: 'auto-sync',
      pushOutboxPath: outbox,
    })

    await writeFile(join(home, '.zshrc'), 'export EDITOR=nvim\n')
    await den.trackFile('.zshrc', 't-track')
    await den.commitTracked(['.zshrc'], 't-commit')
    expect(await den.pushPending()).toBe(true)

    // Reconnect, then drive the flush as the powerMonitor/`online` handler would.
    await runCommand(gitBin, ['remote', 'set-url', 'origin', realRemote], { cwd: source })
    const flush = await den.flushPushQueue('t-flush')
    expect(flush.pushed).toBe(true)
    expect(flush.queued).toBe(false)
    expect(await den.pushPending()).toBe(false)
    expect(await remoteCommitCount(realRemote)).toBe(1)

    // A second flush is a clean no-op — the queue is empty, so it does NOT double-push.
    const again = await den.flushPushQueue('t-flush-2')
    expect(again.pushed).toBe(false)
    expect(again.queued).toBe(false)
  })

  it('survives a restart: a fresh DenService over the same outbox flushes the queued push once', async () => {
    const realRemote = join(root, 'remote.git')
    await runCommand(gitBin, ['init', '--bare', realRemote])
    const home = join(root, 'home')
    const source = join(root, 'source')
    const outbox = join(root, 'push-outbox.json')
    await mkdir(home, { recursive: true })
    await initSourceRepo(source, UNREACHABLE_REMOTE)

    const opts = {
      chezmoiBin,
      gitBin,
      sourceDir: source,
      destinationDir: home,
      environment: { id: 'env-a', label: 'this-mac', os: process.platform },
      automationLevel: 'auto-sync' as const,
      pushOutboxPath: outbox,
    }
    const before = new DenService(opts)
    await writeFile(join(home, '.zshrc'), 'export EDITOR=nvim\n')
    await before.trackFile('.zshrc', 't-track')
    await before.commitTracked(['.zshrc'], 't-commit')
    expect(await before.pushPending()).toBe(true)

    // "Restart": a brand-new DenService over the same dirs/outbox still knows a push is owed.
    await runCommand(gitBin, ['remote', 'set-url', 'origin', realRemote], { cwd: source })
    const afterRestart = new DenService(opts)
    expect(await afterRestart.pushPending()).toBe(true)

    const flush = await afterRestart.flushPushQueue('t-flush')
    expect(flush.pushed).toBe(true)
    expect(await afterRestart.pushPending()).toBe(false)
    // Exactly the one offline Commit reached the Remote — not duplicated, not dropped.
    expect(await remoteCommitCount(realRemote)).toBe(1)
  })

  it('Manual offline Sync: a failed Sync queues (does not throw) and a later Sync flushes it', async () => {
    const realRemote = join(root, 'remote.git')
    await runCommand(gitBin, ['init', '--bare', realRemote])
    const home = join(root, 'home')
    const source = join(root, 'source')
    const outbox = join(root, 'push-outbox.json')
    await mkdir(home, { recursive: true })
    await initSourceRepo(source, UNREACHABLE_REMOTE)

    const den = new DenService({
      chezmoiBin,
      gitBin,
      sourceDir: source,
      destinationDir: home,
      environment: { id: 'env-a', label: 'this-mac', os: process.platform },
      // Manual (default): Commit never auto-pushes; the user presses Sync now.
      pushOutboxPath: outbox,
    })

    await writeFile(join(home, '.zshrc'), 'export EDITOR=nvim\n')
    await den.trackFile('.zshrc', 't-track')
    const commit = await den.commitTracked(['.zshrc'], 't-commit')
    // Manual never queues at Commit time (no auto-push attempted).
    expect(commit.pushed).toBe(false)
    expect(commit.queued).toBe(false)
    expect(await den.pushPending()).toBe(false)

    // Sync now while offline: the push can't go out, so it is QUEUED — and crucially does
    // NOT throw (the local Commit is safe + will retry), so the UI shows the offline banner.
    const offlineSync = await den.syncPush('t-sync-offline')
    expect(offlineSync.pushed).toBe(false)
    expect(offlineSync.queued).toBe(true)
    expect(await den.pushPending()).toBe(true)
    expect(await remoteCommitCount(realRemote)).toBe(0)

    // Reconnect + Sync now again → flushes the queued push.
    await runCommand(gitBin, ['remote', 'set-url', 'origin', realRemote], { cwd: source })
    const onlineSync = await den.syncPush('t-sync-online')
    expect(onlineSync.pushed).toBe(true)
    expect(await den.pushPending()).toBe(false)
    expect(await remoteCommitCount(realRemote)).toBe(1)
  })
})

/** Init an env's source repo as a working tree wired to `remote`, hermetic identity. */
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
