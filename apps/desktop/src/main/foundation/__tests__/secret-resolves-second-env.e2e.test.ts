/**
 * Secret reference resolves on a SECOND environment — issue 2-06, with REAL chezmoi/git.
 *
 * This closes the cross-environment loop that 2-05 only proved on a single environment. A Secret
 * reference (CONTEXT.md) is the whole point of "the same Den works everywhere without ever sharing
 * the secret": a File that carries an `op://…` reference, when Applied on a *different* environment,
 * resolves against THAT environment's OWN vault — never against the env it was authored on, and
 * never by transmitting the value through the Den.
 *
 * The shape of the proof (the issue's Testing Decision — a faked second-environment vault):
 *
 *   1. env A Tracks a dotfile holding a RAW secret, converts it to a 1Password `.tmpl` reference,
 *      Commits, and PUSHES to a real bare remote — the one repo every environment shares.
 *   2. env B is a genuinely SEPARATE environment: its own HOME + its own source repo CLONED from
 *      that remote (not a shared directory). It never saw the raw secret — only the reference
 *      travelled through git.
 *   3. env B Applies, resolving the reference against ITS OWN faked `op` shim. To prove the value is
 *      the *second environment's* and never the first's, env B's fake vault returns a value DISTINCT
 *      from what env A's fake vault would return: the applied bytes on B match B's vault, so the
 *      resolution is genuinely local to B (each environment uses its own CLI + credentials).
 *
 * Why this can only be proven at the ChezmoiAdapter/DenService integration seam: the security
 * invariant is *what chezmoi renders against a real (faked) CLI on a real cloned repo*. A unit test
 * can pin the template string (2-05 does), but only a real `chezmoi apply` against a real `op` shim,
 * on a repo that actually travelled through `git push`/`git clone`, can show the reference round-trips
 * cross-environment while the raw secret never followed it.
 */
/* eslint-disable turbo/no-undeclared-env-vars -- integration test discovers local chezmoi/git binaries. */
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { cloneRepo, GitTransport } from '../chezmoi/git-transport.js'
import { DenService } from '../den-service.js'
import { EnvironmentRegistry } from '../environment-registry.js'
import { runCommand } from '../platform/process.js'

let root: string
let chezmoiBin: string
let gitBin: string
let originalPath: string | undefined

/** The raw secret env A holds BEFORE converting — it must never enter the Den or reach env B. */
const RAW_SECRET = 'ghp_0123456789abcdefghijklmnopqrstuvwxyzABCD'
/**
 * What env A's OWN vault would resolve the reference to. It must NEVER appear on env B: B resolves
 * against its own vault, so seeing this value on B would mean A's resolved secret somehow travelled
 * (the exact leak this issue forbids). It is asserted-absent on B, never applied on B.
 */
const ENV_A_VAULT_VALUE = 'value-from-env-A-vault'
/**
 * What env B's OWN (faked) vault resolves the reference to — DISTINCT from env A's. env B's applied
 * bytes must equal THIS, proving the resolution happened against the second environment's own
 * credentials, locally, at Apply time.
 */
const ENV_B_VAULT_VALUE = 'value-from-env-B-vault'

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dotden-secret-2env-'))
  chezmoiBin = await requireTool('chezmoi', 'DOTDEN_CHEZMOI_BIN')
  gitBin = await requireTool('git', 'DOTDEN_GIT_BIN')
  originalPath = process.env.PATH
})

afterEach(async () => {
  // Restore PATH so neither env's fake `op` shim leaks into other tests.
  process.env.PATH = originalPath
  await rm(root, { recursive: true, force: true })
})

describe('Secret reference resolves on a second environment (real chezmoi/git + faked per-env vaults)', () => {
  it('the same committed reference resolves on env B against B’s OWN vault — the value never travelled', async () => {
    const remote = join(root, 'remote.git')
    await runCommand(gitBin, ['init', '--bare', remote])

    // ── env A: Track a raw secret, convert to a reference, Commit, Push ─────────────────────────
    const a = await makeEnv('a', remote, 'env-a', 'desktop')
    await writeFile(join(a.home, '.netrc'), `password ${RAW_SECRET}\n`)
    await a.den.trackFile('.netrc', 'a-track')
    await a.registry.registerWithSubscription()
    const converted = await a.den.convertSecret(
      { targetPath: '.netrc', manager: 'op', reference: 'op://Private/netrc/password' },
      'a-convert',
    )
    // env A holds ONLY the reference now (this is what travels). Sanity-check before pushing.
    expect(converted.template).toBe('{{ onepasswordRead "op://Private/netrc/password" }}')
    expect(converted.template).not.toContain(RAW_SECRET)
    await a.den.syncPush('a-push')

    // ── env B: a genuinely separate environment — own HOME, own source CLONED from the remote ───
    const b = await makeEnv('b', remote, 'env-b', 'laptop', { clone: true })

    // SECURITY (acceptance criterion 2 + 3): the raw secret never travelled. Scan env B's WHOLE
    // git history (every commit, every blob), not just the working tree — if the secret were ever
    // committed it would be reachable here. `git grep` exits non-zero (Error) when there is no
    // match, which is the pass condition.
    await expectSecretAbsentFromHistory(b.source, RAW_SECRET)
    // And the value env A's vault would produce is likewise nowhere in B's Den (it never left A).
    await expectSecretAbsentFromHistory(b.source, ENV_A_VAULT_VALUE)
    // The source File that DID travel is the reference/template call — verified on B's own bytes.
    const bTmpl = await readFile(join(b.source, 'dot_netrc.tmpl'), 'utf8')
    expect(bTmpl.trim()).toBe('{{ onepasswordRead "op://Private/netrc/password" }}')
    expect(bTmpl).not.toContain(RAW_SECRET)

    // env B registers itself (subscribe to all, default) BEFORE any apply — this writes its
    // registry entry + mirrors its own `[data].dotden_env_id` so the templated `.chezmoiignore`
    // self-identifies as a real environment (issue 1-13's ordering guard), rather than the
    // ignore-everything fail-safe. This is the production second-environment onboarding step.
    await b.registry.registerWithSubscription()

    // ── env B Applies, resolving against ITS OWN faked vault (DISTINCT value from A's) ──────────
    const fakeBin = await writeFakeOp(b.home, ENV_B_VAULT_VALUE)
    process.env.PATH = `${fakeBin}${delimiter}${originalPath ?? ''}`

    // Review & Apply the incoming reference on B (the production path env B uses on first sync).
    const incoming = await b.den.listIncomingClean('b-list')
    const targets = incoming.map((i) => i.targetPath)
    expect(targets).toContain('.netrc')
    const applyResult = await b.den.applyIncoming(targets, 'b-apply')

    // It applied cleanly (the reference RESOLVED on the second environment).
    expect(applyResult.results.find((r) => r.targetPath === '.netrc')?.outcome).toBe('ok')

    // ACCEPTANCE CRITERION 1 + 4: the applied bytes hold env B's OWN vault value — the resolution
    // happened against the second environment's own CLI/credentials at Apply time.
    const applied = await readFile(join(b.home, '.netrc'), 'utf8')
    expect(applied.trim()).toBe(ENV_B_VAULT_VALUE)
    // And NEITHER the raw secret NOR env A's resolved value is present — the secret never travelled.
    expect(applied).not.toContain(RAW_SECRET)
    expect(applied).not.toContain(ENV_A_VAULT_VALUE)

    // env B's source state STILL holds only the reference after Apply — Applying resolves into the
    // destination File but never writes the resolved value back into the Den (it stays a reference,
    // so the next environment resolves against its own vault too).
    await expectSecretAbsentFromHistory(b.source, ENV_B_VAULT_VALUE)
    expect((await readFile(join(b.source, 'dot_netrc.tmpl'), 'utf8')).trim()).toBe(
      '{{ onepasswordRead "op://Private/netrc/password" }}',
    )
  })

  it('env A and env B resolve the SAME reference to DIFFERENT values — each from its own vault', async () => {
    // The cleanest demonstration that the value never travels: give A and B different faked vaults
    // for the identical reference and confirm each environment Applies its OWN value. If the value
    // travelled with the Den, both environments would resolve to the same bytes.
    const remote = join(root, 'remote.git')
    await runCommand(gitBin, ['init', '--bare', remote])

    const a = await makeEnv('a', remote, 'env-a', 'desktop')
    await writeFile(join(a.home, '.token'), `token = ${RAW_SECRET}\n`)
    await a.den.trackFile('.token', 'a-track')
    await a.registry.registerWithSubscription()
    // convertSecret Commits the reference AND stages the synced `.dotden/` (registry entry written
    // by registerWithSubscription above) in the same commit, so env B reconstructs the Den on clone.
    await a.den.convertSecret(
      { targetPath: '.token', manager: 'op', reference: 'op://Work/token/credential' },
      'a-convert',
    )
    await a.den.syncPush('a-push')

    // env A Applies against A's vault → A's value.
    const fakeA = await writeFakeOp(a.home, ENV_A_VAULT_VALUE)
    process.env.PATH = `${fakeA}${delimiter}${originalPath ?? ''}`
    await a.den.applyIncoming(['.token'], 'a-apply')
    expect((await readFile(join(a.home, '.token'), 'utf8')).trim()).toBe(ENV_A_VAULT_VALUE)

    // env B clones the SAME repo (same reference) and Applies against B's DIFFERENT vault → B's value.
    const b = await makeEnv('b', remote, 'env-b', 'laptop', { clone: true })
    await b.registry.registerWithSubscription() // second-env onboarding: own entry + env-id mirror.
    const fakeB = await writeFakeOp(b.home, ENV_B_VAULT_VALUE)
    process.env.PATH = `${fakeB}${delimiter}${originalPath ?? ''}`
    const bIncoming = await b.den.listIncomingClean('b-list')
    await b.den.applyIncoming(
      bIncoming.map((i) => i.targetPath),
      'b-apply',
    )

    // Same reference, two environments, TWO different resolved values — proof each resolves locally.
    const appliedA = (await readFile(join(a.home, '.token'), 'utf8')).trim()
    const appliedB = (await readFile(join(b.home, '.token'), 'utf8')).trim()
    expect(appliedA).toBe(ENV_A_VAULT_VALUE)
    expect(appliedB).toBe(ENV_B_VAULT_VALUE)
    expect(appliedA).not.toBe(appliedB)
    // Neither resolved value ever entered the shared Den (B's history has neither, A's has neither).
    await expectSecretAbsentFromHistory(b.source, ENV_A_VAULT_VALUE)
    await expectSecretAbsentFromHistory(b.source, ENV_B_VAULT_VALUE)
    await expectSecretAbsentFromHistory(a.source, ENV_B_VAULT_VALUE)
    await expectSecretAbsentFromHistory(a.source, RAW_SECRET)
  })
})

// ── Test fixture: an environment = source repo + home + DenService + EnvironmentRegistry ─────────

interface Env {
  readonly source: string
  readonly home: string
  readonly config: string
  readonly den: DenService
  readonly registry: EnvironmentRegistry
}

async function makeEnv(
  name: string,
  remote: string,
  id: string,
  label: string,
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
    environment: { id, label, os: process.platform },
  })
  const registry = new EnvironmentRegistry({
    sourceDir: source,
    gitBin,
    chezmoiBin,
    destinationDir: home,
    configPath: config,
    identity: { id, label, os: process.platform, hostnameAtSetup: label },
  })
  return { source, home, config, den, registry }
}

/**
 * Assert a secret/value is absent from a repo's ENTIRE history (not just the working tree).
 *
 * `git grep <needle> $(git rev-list --all)` scans every blob reachable from any commit, so a value
 * that was ever committed — even and then removed — would be found. `git grep` exits non-zero when
 * there is no match; `runCommand` rejects on non-zero, and that rejection is the pass condition.
 */
async function expectSecretAbsentFromHistory(repoDir: string, needle: string): Promise<void> {
  const revList = await runCommand(gitBin, ['rev-list', '--all'], { cwd: repoDir })
  const revs = revList.stdout.split('\n').filter((line) => line.trim().length > 0)
  const result = await runCommand(gitBin, ['grep', needle, ...revs], { cwd: repoDir }).catch(
    (error: unknown) => error,
  )
  expect(result).toBeInstanceOf(Error)
}

/**
 * Write a fake `op` shim into a fresh bin dir UNDER the given environment's home and return that dir
 * (to prepend to PATH). Each environment gets its OWN shim resolving to its OWN value, so the two
 * environments' vaults are genuinely distinct — the heart of this issue's proof.
 *
 * The shim answers `op read --no-newline <ref>` with `resolvedValue` (no trailing newline, like the
 * real op) and stubs `op account list` so any chezmoi preflight succeeds.
 */
async function writeFakeOp(envHome: string, resolvedValue: string): Promise<string> {
  const binDir = join(envHome, 'fakebin')
  await mkdir(binDir, { recursive: true })
  const opPath = join(binDir, 'op')
  await writeFile(
    opPath,
    [
      '#!/usr/bin/env bash',
      'if [ "$1" = "read" ]; then',
      `  printf '%s' '${resolvedValue}'`,
      '  exit 0',
      'fi',
      'if [ "$1" = "account" ]; then echo "[]"; exit 0; fi',
      'exit 0',
      '',
    ].join('\n'),
  )
  await chmod(opPath, 0o755)
  return binDir
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
  for (const directory of (originalPath ?? process.env.PATH ?? '').split(delimiter)) {
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
