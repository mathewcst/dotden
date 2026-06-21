/**
 * EnvironmentRegistry tests — identity, editable label, git-log attribution (issue 1-05).
 *
 * Drives the registry against REAL git/chezmoi in a disposable temp Den so the
 * acceptance criteria are proven for real, not faked:
 *
 * - identity setup writes a stable id to the synced registry AND mirrors it into the
 *   environment-local chezmoi config (`[data].dotden_env_id`) — the subscription seam;
 * - renaming the label is a one-line change that NEVER touches the id (no churn) and
 *   adds no attribution fields to the registry file;
 * - attribution (last author / activity / count) is computed LIVE from `git log` and is
 *   never persisted to `.dotden/environments.json`;
 * - the returning-claim fork suggests the likely entry by OS + setup-time hostname.
 */
/* eslint-disable turbo/no-undeclared-env-vars -- integration test discovers local chezmoi/git binaries. */
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { EnvironmentRegistry, type LocalIdentity } from '../environment-registry.js'
import { GitTransport } from '../chezmoi/git-transport.js'
import { DenStore } from '../den-store.js'
import { runCommand } from '../platform/process.js'

let root: string
let source: string
let configPath: string
let chezmoiBin: string
let gitBin: string

const identity: LocalIdentity = {
  id: 'env-self-1',
  label: 'this-laptop',
  os: process.platform,
  hostnameAtSetup: 'this-laptop',
}

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dotden-registry-'))
  source = join(root, 'source')
  configPath = join(root, 'local-config', 'chezmoi.toml')
  chezmoiBin = await requireTool('chezmoi', 'DOTDEN_CHEZMOI_BIN')
  gitBin = await requireTool('git', 'DOTDEN_GIT_BIN')
  await initSourceRepo(source)
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

/** Build a registry bound to the temp Den + a given local identity. */
function registryFor(id: LocalIdentity = identity): EnvironmentRegistry {
  return new EnvironmentRegistry({
    sourceDir: source,
    gitBin,
    chezmoiBin,
    destinationDir: join(root, 'home'),
    configPath,
    identity: id,
  })
}

describe('EnvironmentRegistry', () => {
  it('writes a stable id to the registry and mirrors it into local chezmoi config', async () => {
    const entry = await registryFor().setupIdentity()
    expect(entry.id).toBe('env-self-1')
    expect(entry.label).toBe('this-laptop')

    // The synced registry holds exactly { id, label, os, subscribedWorkspaces } — no
    // attribution fields are persisted (ADR 0024).
    const stored = (await new DenStore(source).readEnvironments()).environments[0]
    expect(Object.keys(stored ?? {}).sort()).toEqual(['id', 'label', 'os', 'subscribedWorkspaces'])

    // The own id is mirrored into the environment-local config, and chezmoi can read
    // it back as a template value — this is the per-environment subscription seam.
    const config = await readFile(configPath, 'utf8')
    expect(config).toContain('[data]')
    expect(config).toContain('dotden_env_id = "env-self-1"')
    const templated = await runCommand(chezmoiBin, [
      '--config',
      configPath,
      '--source',
      source,
      '--destination',
      join(root, 'home'),
      '--no-tty',
      'execute-template',
      '{{ .dotden_env_id }}',
    ])
    expect(templated.stdout.trim()).toBe('env-self-1')
  })

  it('renames the label without changing the id or adding churn', async () => {
    const registry = registryFor()
    await registry.setupIdentity()

    const renamed = await registry.renameLabel('Work MBP')
    expect(renamed.id).toBe('env-self-1') // identity preserved
    expect(renamed.label).toBe('Work MBP')

    // The on-disk registry shows the new label, the SAME id, and still no attribution.
    const stored = (await new DenStore(source).readEnvironments()).environments[0]
    expect(stored).toEqual({
      id: 'env-self-1',
      label: 'Work MBP',
      os: process.platform,
      subscribedWorkspaces: ['personal'],
    })
  })

  it('rejects a blank label rename', async () => {
    const registry = registryFor()
    await registry.setupIdentity()
    await expect(registry.renameLabel('   ')).rejects.toThrow()
  })

  it('derives attribution from git log and never persists it', async () => {
    const registry = registryFor()
    await registry.setupIdentity()
    // Commit as the environment's label author so attribution can join on it.
    await commitAs(source, 'this-laptop', 'this-laptop@example.invalid', 'Commit .zshrc')

    const list = await registry.list()
    const self = list.find((e) => e.isSelf)
    expect(self).toBeDefined()
    expect(self?.attribution.commitCount).toBe(1)
    expect(self?.attribution.lastAuthorName).toBe('this-laptop')
    expect(self?.attribution.lastSubject).toBe('Commit .zshrc')
    expect(self?.attribution.lastActivityAt).toMatch(/^\d{4}-\d{2}-\d{2}T/) // ISO-8601

    // Re-reading the registry file shows attribution was NOT written into it.
    const fileText = await readFile(join(source, '.dotden', 'environments.json'), 'utf8')
    expect(fileText).not.toMatch(/lastAuthor|lastActivity|commitCount|lastSubject/)
  })

  it('reports zero attribution for an environment with no matching commits', async () => {
    const registry = registryFor()
    await registry.setupIdentity()
    // A different environment exists in the registry but never authored a commit.
    await new DenStore(source).registerEnvironment({
      id: 'env-other',
      label: 'never-committed',
      os: 'darwin',
      subscribedWorkspaces: ['personal'],
    })

    const list = await registry.list()
    const other = list.find((e) => e.id === 'env-other')
    expect(other?.attribution.commitCount).toBe(0)
    expect(other?.attribution.lastActivityAt).toBeUndefined()
    expect(other?.isSelf).toBe(false)
  })

  it('suggests a returning-claim match by OS + setup-time hostname, never auto-merging', async () => {
    // Seed a registry that already contains a returning candidate matching our host.
    const store = new DenStore(source)
    await store.seedDefault({ id: 'env-existing', label: 'this-laptop', os: process.platform })
    await store.registerEnvironment({
      id: 'env-windows',
      label: 'win-box',
      os: 'win32',
      subscribedWorkspaces: ['personal'],
    })

    // A FRESH install (different local id) probes who it might be returning to.
    const fresh = registryFor({ ...identity, id: 'fresh-no-claim-yet' })
    const suggestions = await fresh.suggestClaims()

    // Strongest match (same OS + hostname) ranks first; it is NOT applied automatically.
    expect(suggestions[0]?.entry.id).toBe('env-existing')
    expect(suggestions[0]?.reasons).toContain('hostname-match')
    // The win32 entry only matches if our os happens to be win32; on other OSes it is excluded.
    const ids = suggestions.map((s) => s.entry.id)
    if (process.platform === 'win32') expect(ids).toContain('env-windows')
    else expect(ids).not.toContain('env-windows')
  })

  // ── new-or-returning registration with subscription (issue 1-13) ──

  it('registerWithSubscription defaults to ALL Workspaces and mirrors the env id', async () => {
    // Seed a Den with two Workspaces from a peer environment.
    const store = new DenStore(source)
    await store.seedDefault({ id: 'env-peer', label: 'peer', os: process.platform })
    const work = await store.createWorkspace('Work')

    // A fresh second environment registers with NO explicit pick → subscribes to ALL.
    const entry = await registryFor().registerWithSubscription()
    expect(entry.id).toBe('env-self-1')
    expect([...entry.subscribedWorkspaces].sort()).toEqual([work.id, 'personal'].sort())

    // The own id is mirrored so the templated `.chezmoiignore` can self-identify (issue 1-05).
    expect(await readFile(configPath, 'utf8')).toContain('dotden_env_id = "env-self-1"')
  })

  it('registerWithSubscription honors an explicit subset (the returning pick)', async () => {
    const store = new DenStore(source)
    await store.seedDefault({ id: 'env-peer', label: 'peer', os: process.platform })
    await store.createWorkspace('Work')

    // The user picks ONLY the default Personal Workspace.
    const entry = await registryFor().registerWithSubscription(['personal'])
    expect(entry.subscribedWorkspaces).toEqual(['personal'])
  })

  it('workspaces() lists the Den’s Workspaces for the subscription pick', async () => {
    const store = new DenStore(source)
    await store.seedDefault({ id: 'env-peer', label: 'peer', os: process.platform })
    await store.createWorkspace('Work')
    const list = await registryFor().workspaces()
    expect(list.map((w) => w.label).sort()).toEqual(['Personal', 'Work'])
  })

  // ── Lifecycle: claim / reassign / retire (issue 2-15, ADR 0024) ──

  it('retire drops a decommissioned environment and commits the change so it travels', async () => {
    const registry = registryFor()
    await registry.setupIdentity() // env-self-1 is THIS environment
    const store = new DenStore(source)
    await store.registerEnvironment({
      id: 'env-old',
      label: 'old-desktop',
      os: 'linux',
      subscribedWorkspaces: ['personal'],
    })

    const list = await registry.retire('env-old')
    // The retired entry is gone; this environment remains in the returned (re-listed) data.
    expect(list.map((e) => e.id).sort()).toEqual(['env-self-1'])

    // The removal was Committed (a `.dotden/` diff) so it travels on the next Sync.
    const log = await new GitTransport({ gitBin, repoDir: source }).log()
    expect(log).toContain('Retire environment env-old')
  })

  it('retire refuses to drop THIS running environment (never orphan the local id)', async () => {
    const registry = registryFor()
    await registry.setupIdentity()
    await expect(registry.retire('env-self-1')).rejects.toThrow()
  })

  it('retire rejects an unknown id rather than silently no-op-ing', async () => {
    const registry = registryFor()
    await registry.setupIdentity()
    await expect(registry.retire('env-never-existed')).rejects.toThrow()
  })

  it('reassign folds a duplicate into the keeper (unioning subscriptions) and commits it', async () => {
    const registry = registryFor()
    await registry.setupIdentity()
    const store = new DenStore(source)
    const work = await store.createWorkspace('Work')
    // The keeper (this env) subscribes to Personal; the duplicate subscribed to Work.
    await store.setSubscriptions({ id: 'env-self-1', label: 'this-laptop', os: process.platform }, [
      'personal',
    ])
    await store.registerEnvironment({
      id: 'env-dup',
      label: 'this-laptop-2',
      os: process.platform,
      subscribedWorkspaces: [work.id],
    })

    // Fold the duplicate INTO self (the common "registered twice" fix — allowed; only folding
    // self AWAY is refused).
    const list = await registry.reassign('env-dup', 'env-self-1')
    expect(list.map((e) => e.id).sort()).toEqual(['env-self-1'])
    const self = list.find((e) => e.isSelf)
    expect([...(self?.subscribedWorkspaces ?? [])].sort()).toEqual(['personal', work.id].sort())

    const log = await new GitTransport({ gitBin, repoDir: source }).log()
    expect(log).toContain('Reassign environment env-dup into env-self-1')
  })

  it('reassign refuses to fold AWAY this running environment', async () => {
    const registry = registryFor()
    await registry.setupIdentity()
    const store = new DenStore(source)
    await store.registerEnvironment({
      id: 'env-other',
      label: 'other',
      os: process.platform,
      subscribedWorkspaces: ['personal'],
    })
    await expect(registry.reassign('env-self-1', 'env-other')).rejects.toThrow()
  })

  it('lifecycle ops never persist attribution into the registry (git-log-derived, ADR 0024)', async () => {
    const registry = registryFor()
    await registry.setupIdentity()
    const store = new DenStore(source)
    await store.registerEnvironment({
      id: 'env-dup',
      label: 'dup',
      os: process.platform,
      subscribedWorkspaces: ['personal'],
    })
    await store.registerEnvironment({
      id: 'env-gone',
      label: 'gone',
      os: 'linux',
      subscribedWorkspaces: ['personal'],
    })
    await registry.reassign('env-dup', 'env-self-1')
    await registry.retire('env-gone')

    const fileText = await readFile(join(source, '.dotden', 'environments.json'), 'utf8')
    expect(fileText).not.toMatch(/lastAuthor|lastActivity|commitCount|lastSubject/)
  })
})

/** Initialize a git source repo with a deterministic identity (host config-independent). */
async function initSourceRepo(dir: string): Promise<void> {
  await mkdir(dir, { recursive: true })
  const git = new GitTransport({ gitBin, repoDir: dir })
  await git.init()
  await runCommand(gitBin, ['config', 'user.name', 'dotden tests'], { cwd: dir })
  await runCommand(gitBin, ['config', 'user.email', 'dotden@example.invalid'], { cwd: dir })
  // Hermetic sandbox: force commit signing off so the host's global `commit.gpgsign`
  // (which may target an interactive 1Password/SSH agent) can't hang/fail `git commit`.
  await runCommand(gitBin, ['config', 'commit.gpgsign', 'false'], { cwd: dir })
}

/** Make a real commit authored by a specific name/email so attribution can join on it. */
async function commitAs(dir: string, name: string, email: string, subject: string): Promise<void> {
  await writeFile(join(dir, 'note.txt'), `${subject}\n`, 'utf8')
  await runCommand(gitBin, ['add', '--', 'note.txt'], { cwd: dir })
  await runCommand(
    gitBin,
    ['-c', `user.name=${name}`, '-c', `user.email=${email}`, 'commit', '--message', subject],
    { cwd: dir },
  )
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
