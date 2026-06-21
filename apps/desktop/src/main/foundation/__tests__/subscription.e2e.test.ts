/**
 * Second-environment subscription thread — issue 1-13, with REAL chezmoi/git.
 *
 * Proves the spike's load-bearing finding against the production seam: ONE repo, two
 * environments with DIFFERENT Workspace subscriptions, materialize DIFFERENT subsets — driven
 * by a templated `.chezmoiignore` that joins each env's `[data].dotden_env_id` (issue 1-05)
 * against the synced registry. Also proves the issue's acceptance criteria end to end:
 *
 *   - picks subscribed Workspaces (defaulting to all) → only those Files apply;
 *   - the registry-entry guard (a) ordering: the entry is written BEFORE any apply;
 *   - the guard (b) fail-safe: an UNREGISTERED env materializes an EMPTY Den (apply nothing),
 *     never an error — AND the never-silent warning surfaces WHY;
 *   - un-subscribe keep vs remove: `.chezmoiignore` alone never deletes; `keep` orphans the
 *     File on disk, `remove` explicitly deletes THIS env's local copy.
 */
/* eslint-disable turbo/no-undeclared-env-vars -- integration test discovers local chezmoi/git binaries. */
import { existsSync } from 'node:fs'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cloneRepo, GitTransport } from '../chezmoi/git-transport.js'
import { DenService } from '../den-service.js'
import { EnvironmentRegistry } from '../environment-registry.js'
import { ChezmoiAdapter } from '../chezmoi/chezmoi-adapter.js'
import { runCommand } from '../platform/process.js'

let root: string
let chezmoiBin: string
let gitBin: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dotden-sub-e2e-'))
  chezmoiBin = await requireTool('chezmoi', 'DOTDEN_CHEZMOI_BIN')
  gitBin = await requireTool('git', 'DOTDEN_GIT_BIN')
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('second-environment subscription (real chezmoi/git)', () => {
  it('two envs with different subscriptions materialize different subsets from one repo', async () => {
    const remote = join(root, 'remote.git')
    await runCommand(gitBin, ['init', '--bare', remote])

    // ── env A: build a Den with TWO Workspaces (Personal + Work), one File each ──
    const a = await makeEnv('a', remote, 'env-a', 'desktop', process.platform)
    await writeFile(join(a.home, '.personal-rc'), 'PERSONAL=1\n')
    await writeFile(join(a.home, '.work-rc'), 'WORK=1\n')
    await a.den.trackFile('.personal-rc', 't1')
    const work = await a.den.createWorkspace('Work', 'tw')
    // Track .work-rc first (it must be placed), THEN move it into the Work Workspace (ADR 0005).
    await a.den.trackFile('.work-rc', 't3')
    await a.den.setFileWorkspace('.work-rc', work.id, 't2')
    // env A subscribes to ALL Workspaces (default) so it materializes both Files.
    await a.registry.registerWithSubscription()
    await a.den.commitTracked(['.personal-rc', '.work-rc'], 't4')
    await a.den.syncPush('t5')

    // ── env B: clone, subscribe to ONLY Personal (a different subset) ──
    const b = await makeEnv('b', remote, 'env-b', 'work-laptop', process.platform, { clone: true })
    // The subscription pick: only Personal. Writes the entry BEFORE any apply (ordering guard a).
    const personalId = (await b.den.subscriptionState()).workspaces.find(
      (w) => w.label === 'Personal',
    )!.id
    await b.den.setSubscriptions([personalId], 'b-sub')

    // First materialization is a deliberate reviewed Apply — apply everything incoming.
    const incoming = await b.den.listIncomingClean('b-list')
    await b.den.applyIncoming(
      incoming.map((i) => i.targetPath),
      'b-apply',
    )

    // env B got the Personal File but NOT the un-subscribed Work File (one repo, different subset).
    expect(existsSync(join(b.home, '.personal-rc'))).toBe(true)
    expect(existsSync(join(b.home, '.work-rc'))).toBe(false)

    // And chezmoi itself reports the Work File as IGNORED here (the templated rule is live).
    const ignored = await chezmoiIgnored(b)
    expect(ignored).toContain('.work-rc')
    expect(ignored).not.toContain('.personal-rc')
  })

  it('an UNREGISTERED env materializes an EMPTY Den (fail-safe), never an error, and surfaces why', async () => {
    const remote = join(root, 'remote.git')
    await runCommand(gitBin, ['init', '--bare', remote])
    const a = await makeEnv('a', remote, 'env-a', 'desktop', process.platform)
    await writeFile(join(a.home, '.personal-rc'), 'P=1\n')
    await a.den.trackFile('.personal-rc', 't1')
    await a.registry.registerWithSubscription()
    await a.den.commitTracked(['.personal-rc'], 't2')
    await a.den.syncPush('t3')

    // env B clones but is NOT registered yet (between clone and claim — the guard's gap).
    const b = await makeEnv('b', remote, 'env-b', 'laptop', process.platform, { clone: true })

    // Never silent: the empty-Den warning explains WHY + the fix (not a confusing blank).
    const state = await b.den.subscriptionState()
    expect(state.registered).toBe(false)
    expect(state.emptyDenWarning).toMatch(/isn't registered/i)

    // The fail-safe (b): `chezmoi apply` must NOT error and must apply NOTHING (ignore-everything).
    // Drive a raw apply of everything; the templated `*` ignores the whole tree, so nothing lands.
    await b.chezmoi.apply()
    expect(existsSync(join(b.home, '.personal-rc'))).toBe(false)
  })

  it('un-subscribe: `.chezmoiignore` never deletes — keep orphans the File, remove deletes the local copy', async () => {
    const remote = join(root, 'remote.git')
    await runCommand(gitBin, ['init', '--bare', remote])
    const a = await makeEnv('a', remote, 'env-a', 'desktop', process.platform)
    await writeFile(join(a.home, '.work-rc'), 'WORK=1\n')
    const work = await a.den.createWorkspace('Work', 'tw')
    await a.den.trackFile('.work-rc', 't1')
    await a.den.setFileWorkspace('.work-rc', work.id, 't2')
    await a.registry.registerWithSubscription()
    await a.den.commitTracked(['.work-rc'], 't3')
    await a.den.syncPush('t4')

    // env B subscribes to ALL, applies, then un-subscribes Work.
    const b = await makeEnv('b', remote, 'env-b', 'laptop', process.platform, { clone: true })
    await b.den.setSubscriptions(undefined, 'b-sub-all') // default: all
    const incoming = await b.den.listIncomingClean('b-list')
    await b.den.applyIncoming(
      incoming.map((i) => i.targetPath),
      'b-apply',
    )
    expect(existsSync(join(b.home, '.work-rc'))).toBe(true)

    // KEEP: un-subscribe Work but leave the File on disk (the safe default — ignore ≠ delete).
    await b.den.unsubscribeWorkspace(work.id, 'keep', 'b-unsub-keep')
    expect(existsSync(join(b.home, '.work-rc'))).toBe(true) // orphan persists
    // chezmoi now IGNORES it here (un-subscribed) — proving the rule changed, not the file.
    expect(await chezmoiIgnored(b)).toContain('.work-rc')

    // REMOVE: re-subscribe + re-apply, then un-subscribe with `remove` — the local copy is deleted.
    await b.den.setSubscriptions(undefined, 'b-resub')
    const again = await b.den.listIncomingClean('b-list2')
    await b.den.applyIncoming(
      again.map((i) => i.targetPath),
      'b-apply2',
    )
    expect(existsSync(join(b.home, '.work-rc'))).toBe(true)
    await b.den.unsubscribeWorkspace(work.id, 'remove', 'b-unsub-remove')
    // The local copy is gone HERE…
    expect(existsSync(join(b.home, '.work-rc'))).toBe(false)
    // …but env A's source state still carries the File (remove is local-only, not Den-wide).
    expect(existsSync(join(a.source, 'dot_work-rc'))).toBe(true)
  })
})

// ── Test fixture: an environment = source repo + home + DenService + EnvironmentRegistry ──

interface Env {
  readonly source: string
  readonly home: string
  readonly config: string
  readonly den: DenService
  readonly registry: EnvironmentRegistry
  readonly chezmoi: ChezmoiAdapter
}

async function makeEnv(
  name: string,
  remote: string,
  id: string,
  label: string,
  os: string,
  opts: { clone?: boolean } = {},
): Promise<Env> {
  const source = join(root, `${name}-source`)
  const home = join(root, `${name}-home`)
  const config = join(root, `${name}-config`, 'chezmoi.toml')
  await mkdir(home, { recursive: true })
  if (opts.clone) {
    await cloneRepo(gitBin, remote, source)
    await configureIdentity(source)
  } else {
    await initSourceRepo(source, remote)
  }
  const den = new DenService({
    chezmoiBin,
    gitBin,
    sourceDir: source,
    destinationDir: home,
    configPath: config,
    environment: { id, label, os },
  })
  const registry = new EnvironmentRegistry({
    sourceDir: source,
    gitBin,
    chezmoiBin,
    destinationDir: home,
    configPath: config,
    identity: { id, label, os, hostnameAtSetup: label },
  })
  const chezmoi = new ChezmoiAdapter({
    chezmoiBin,
    sourceDir: source,
    destinationDir: home,
    configPath: config,
  })
  return { source, home, config, den, registry, chezmoi }
}

/** Read `chezmoi ignored` for an env (the live ignore set, honoring the templated config). */
async function chezmoiIgnored(env: Env): Promise<string[]> {
  return env.chezmoi.ignoredPaths()
}

async function initSourceRepo(sourceDir: string, remote: string): Promise<void> {
  await mkdir(sourceDir, { recursive: true })
  const git = new GitTransport({ gitBin, repoDir: sourceDir })
  await git.init()
  await configureIdentity(sourceDir)
  await git.addRemote('origin', remote)
}

async function configureIdentity(repoDir: string): Promise<void> {
  await runCommand(gitBin, ['config', 'user.name', 'dotden tests'], { cwd: repoDir })
  await runCommand(gitBin, ['config', 'user.email', 'dotden@example.invalid'], { cwd: repoDir })
  await runCommand(gitBin, ['config', 'commit.gpgsign', 'false'], { cwd: repoDir })
}

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
