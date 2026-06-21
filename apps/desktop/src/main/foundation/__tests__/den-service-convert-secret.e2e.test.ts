/**
 * DenService.convertSecret integration thread — the issue 2-05 orchestration, with REAL chezmoi/git.
 *
 * Proves the convert flow end-to-end above the adapter seam: Track a File holding a raw secret →
 * convert it to a chezmoi `.tmpl` Secret reference → ONLY the reference enters the Den (the
 * committed source bytes never contain the raw secret) → the "Remember my choice" preference
 * persists environment-locally → an Apply whose password-manager CLI is missing surfaces a clean,
 * provider-agnostic error (acceptance criterion 9), and an Apply with a FAKED op resolves the value.
 */
/* eslint-disable turbo/no-undeclared-env-vars -- integration test discovers local chezmoi/git binaries. */
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DenService } from '../den-service.js'
import { GitTransport } from '../chezmoi/git-transport.js'
import { readPmPreference } from '../secrets/pm-preference.js'
import { runCommand } from '../platform/process.js'

let root: string
let chezmoiBin: string
let gitBin: string
let originalPath: string | undefined

const RAW_SECRET = 'ghp_0123456789abcdefghijklmnopqrstuvwxyzABCD'
const RESOLVED_VALUE = 'resolved-from-vault'

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dotden-ds-convert-'))
  chezmoiBin = await requireTool('chezmoi', 'DOTDEN_CHEZMOI_BIN')
  gitBin = await requireTool('git', 'DOTDEN_GIT_BIN')
  originalPath = process.env.PATH
})

afterEach(async () => {
  process.env.PATH = originalPath
  await rm(root, { recursive: true, force: true })
})

describe('DenService.convertSecret (real chezmoi/git)', () => {
  it('commits ONLY the reference (raw secret never in the committed source) + remembers the choice', async () => {
    const home = join(root, 'home')
    const source = join(root, 'source')
    const userData = join(root, 'userdata')
    await mkdir(home, { recursive: true })
    await initSourceRepo(source)

    const env = new DenService({
      chezmoiBin,
      gitBin,
      sourceDir: source,
      destinationDir: home,
      environment: { id: 'env-a', label: 'this-mac', os: process.platform },
      userDataDir: userData,
    })

    // Track a real dotfile holding a raw GitHub token.
    await writeFile(join(home, '.netrc'), `password ${RAW_SECRET}\n`)
    await env.trackFile('.netrc', 'trace-track')

    // Convert it to a 1Password reference, remembering the choice for the future.
    const result = await env.convertSecret(
      {
        targetPath: '.netrc',
        manager: 'op',
        reference: 'op://Private/netrc/password',
        remember: true,
      },
      'trace-convert',
    )

    // The result reports the reference that now lives in the Den (never the raw secret).
    expect(result.template).toBe('{{ onepasswordRead "op://Private/netrc/password" }}')
    expect(result.template).not.toContain(RAW_SECRET)
    expect(result.commit.committedFiles).toEqual(['.netrc'])
    expect(result.commit.pushed).toBe(false) // LOCAL until pushed (ADR 0006).

    // SECURITY: scan the COMMITTED source bytes — the raw secret is nowhere in the Den's HEAD tree.
    const git = new GitTransport({ gitBin, repoDir: source })
    const headTree = await runCommand(gitBin, ['grep', '-r', RAW_SECRET, 'HEAD'], {
      cwd: source,
    }).catch((error: unknown) => error)
    // `git grep` exits non-zero (no match) when the secret is absent — that is the pass condition.
    expect(headTree).toBeInstanceOf(Error)
    // And the source File that travels is the `.tmpl` reference.
    const tmplContent = await readFile(result.sourceTemplatePath, 'utf8')
    expect(tmplContent.trim()).toBe('{{ onepasswordRead "op://Private/netrc/password" }}')

    // The "Remember my choice" preference persisted ENVIRONMENT-LOCALLY (userData, never synced).
    expect(await readPmPreference(userData)).toEqual({ manager: 'op' })
    void git
  })

  it('surfaces a clean provider-agnostic error when the PM CLI is missing at Apply (criterion 9)', async () => {
    const home = join(root, 'home')
    const source = join(root, 'source')
    await mkdir(home, { recursive: true })
    await initSourceRepo(source)

    const env = new DenService({
      chezmoiBin,
      gitBin,
      sourceDir: source,
      destinationDir: home,
      environment: { id: 'env-a', label: 'this-mac', os: process.platform },
    })

    await writeFile(join(home, '.netrc'), `password ${RAW_SECRET}\n`)
    await env.trackFile('.netrc', 'trace-track')
    await env.convertSecret(
      { targetPath: '.netrc', manager: 'op', reference: 'op://Private/netrc/password' },
      'trace-convert',
    )

    // Apply with NO `op` on PATH → chezmoi's onepasswordRead fails. Strip op from PATH for this call.
    process.env.PATH = join(root, 'empty-bin')
    await mkdir(join(root, 'empty-bin'), { recursive: true })
    const applyResult = await env.applyIncoming(['.netrc'], 'trace-apply')

    const failed = applyResult.results.find((r) => r.targetPath === '.netrc')
    expect(failed?.outcome).toBe('error')
    // The provider-agnostic refusal — points at unlock/sign-in or fixing the reference, retryable.
    expect(failed?.refusal).toBe('secret-reference-unresolved')
    expect(failed?.retryable).toBe(true)
    expect(failed?.reason).toMatch(/password manager/i)
    // The clean message does NOT leak chezmoi's internal template error verbatim.
    expect(failed?.reason).not.toMatch(/onepasswordRead/i)
  })

  it('resolves the reference at Apply against a faked op (criterion 8)', async () => {
    const home = join(root, 'home')
    const source = join(root, 'source')
    await mkdir(home, { recursive: true })
    await initSourceRepo(source)

    const env = new DenService({
      chezmoiBin,
      gitBin,
      sourceDir: source,
      destinationDir: home,
      environment: { id: 'env-a', label: 'this-mac', os: process.platform },
    })

    await writeFile(join(home, '.netrc'), `password ${RAW_SECRET}\n`)
    await env.trackFile('.netrc', 'trace-track')
    await env.convertSecret(
      { targetPath: '.netrc', manager: 'op', reference: 'op://Private/netrc/password' },
      'trace-convert',
    )

    const fakeBin = await writeFakeOp(root, RESOLVED_VALUE)
    process.env.PATH = `${fakeBin}${delimiter}${originalPath ?? ''}`
    const applyResult = await env.applyIncoming(['.netrc'], 'trace-apply')

    expect(applyResult.results.find((r) => r.targetPath === '.netrc')?.outcome).toBe('ok')
    const applied = await readFile(join(home, '.netrc'), 'utf8')
    expect(applied.trim()).toBe(RESOLVED_VALUE)
    expect(applied).not.toContain(RAW_SECRET)
  })
})

async function writeFakeOp(dir: string, resolvedValue: string): Promise<string> {
  const binDir = join(dir, 'fakebin')
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

async function initSourceRepo(sourceDir: string): Promise<void> {
  await mkdir(sourceDir, { recursive: true })
  const git = new GitTransport({ gitBin, repoDir: sourceDir })
  await git.init()
  await runCommand(gitBin, ['config', 'user.name', 'dotden tests'], { cwd: sourceDir })
  await runCommand(gitBin, ['config', 'user.email', 'dotden@example.invalid'], { cwd: sourceDir })
  await runCommand(gitBin, ['config', 'commit.gpgsign', 'false'], { cwd: sourceDir })
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
