/**
 * Secret-convert integration thread — the issue 2-05 Testing Decision, with REAL chezmoi.
 *
 * The acceptance criteria this slice must prove are inherently at the **ChezmoiAdapter integration
 * seam** (per the issue): converting a flagged value writes a chezmoi `.tmpl` Secret reference into
 * source state, the **raw secret never enters source state** (verified by scanning the written
 * bytes), and at **Apply time** chezmoi resolves the reference against a **faked** password manager
 * and produces a resolvable value. A unit test can't prove the last point — only real chezmoi
 * rendering the template against a real (faked) `op` CLI can.
 *
 * The fake resolver: a tiny `op` shim on PATH that answers `op read --no-newline op://…` with a
 * known value. chezmoi's `onepasswordRead` shells out to exactly that, so Apply produces the faked
 * value with NO real vault — keeping the test hermetic while exercising the genuine chezmoi
 * templating path.
 */
/* eslint-disable turbo/no-undeclared-env-vars -- integration test discovers local chezmoi/git binaries. */
import { chmod, mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { delimiter, join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { ChezmoiAdapter } from '../chezmoi-adapter.js'
import { runCommand } from '../process.js'

let root: string
let chezmoiBin: string
let originalPath: string | undefined

/** The known value our fake `op` resolves every reference to — distinct from the raw secret. */
const RESOLVED_VALUE = 'RESOLVED-SECRET-VALUE'
/** The raw secret the user committed before converting — must NEVER reach source state. */
const RAW_SECRET = 'AKIAIOSFODNN7EXAMPLE'

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dotden-secret-convert-'))
  chezmoiBin = await requireTool('chezmoi', 'DOTDEN_CHEZMOI_BIN')
  originalPath = process.env.PATH
})

afterEach(async () => {
  // Restore PATH so the fake `op` shim never leaks into other tests.
  process.env.PATH = originalPath
  await rm(root, { recursive: true, force: true })
})

describe('ChezmoiAdapter.convertToSecretReference (real chezmoi + faked op)', () => {
  it('writes a `.tmpl` reference, keeps the raw secret OUT of source state, and resolves at Apply', async () => {
    const home = join(root, 'home')
    const source = join(root, 'source')
    await mkdir(home, { recursive: true })
    const adapter = new ChezmoiAdapter({ chezmoiBin, sourceDir: source, destinationDir: home })

    // A user has a real dotfile holding a raw secret, and Tracks it (chezmoi add → dot_… source).
    await writeFile(join(home, '.awscreds'), `aws_access_key_id = ${RAW_SECRET}\n`)
    await adapter.track('.awscreds')

    // The Tracked source File holds the raw secret right now (this is what convert must replace).
    const beforeSource = await adapter.sourcePath('.awscreds')
    expect(await readFile(beforeSource, 'utf8')).toContain(RAW_SECRET)

    // CONVERT: write the 1Password reference. The raw secret value is NOT passed here — only the
    // vault coordinates. This is the seam where the secret leaves the Den.
    const tmplPath = await adapter.convertToSecretReference('.awscreds', {
      manager: 'op',
      reference: 'op://vault/aws/access-key-id',
    })

    // The `.tmpl` source File now exists and contains ONLY the reference/template call.
    expect(tmplPath).toMatch(/dot_awscreds\.tmpl$/)
    const writtenTemplate = await readFile(tmplPath, 'utf8')
    expect(writtenTemplate.trim()).toBe('{{ onepasswordRead "op://vault/aws/access-key-id" }}')

    // SECURITY INVARIANT (acceptance criterion 7): the raw secret is NOWHERE in source state — the
    // old non-template source File was removed and the new one carries only the reference.
    expect(writtenTemplate).not.toContain(RAW_SECRET)
    // The original non-template source entry is gone (single unambiguous source for the target).
    await expect(readFile(beforeSource, 'utf8')).rejects.toThrow()

    // APPLY with a FAKED `op` on PATH: chezmoi renders the template, calls our fake op, and writes
    // the resolved value (acceptance criterion 8). No real vault involved.
    const fakeBin = await writeFakeOp(root, RESOLVED_VALUE)
    process.env.PATH = `${fakeBin}${delimiter}${originalPath ?? ''}`
    await adapter.apply(['.awscreds'])

    // The applied File holds the RESOLVED value — the reference round-trips through chezmoi+op.
    // (chezmoi preserves the template File's own trailing newline; the resolved value is the line.)
    const applied = await readFile(join(home, '.awscreds'), 'utf8')
    expect(applied.trim()).toBe(RESOLVED_VALUE)
    // And the raw secret never came back either — it lives only in the (faked) vault.
    expect(applied).not.toContain(RAW_SECRET)
  })

  it('renders the account arg into the committed template when a non-default account is picked', async () => {
    const home = join(root, 'home')
    const source = join(root, 'source')
    await mkdir(home, { recursive: true })
    const adapter = new ChezmoiAdapter({ chezmoiBin, sourceDir: source, destinationDir: home })

    await writeFile(join(home, '.token'), `token = ${RAW_SECRET}\n`)
    await adapter.track('.token')

    const tmplPath = await adapter.convertToSecretReference('.token', {
      manager: 'op',
      reference: 'op://Work/GitHub/token',
      account: 'my.1password.com',
    })

    const written = await readFile(tmplPath, 'utf8')
    expect(written.trim()).toBe('{{ onepasswordRead "op://Work/GitHub/token" "my.1password.com" }}')
    expect(written).not.toContain(RAW_SECRET)
  })
})

/**
 * Write a fake `op` shim into a fresh bin dir and return that dir (to prepend to PATH).
 *
 * The shim answers `op read --no-newline <ref>` with `resolvedValue` (no trailing newline, like the
 * real op), and stubs `op account list` so any chezmoi preflight succeeds. It is the FAKED password
 * manager the issue's Testing Decision names — proving the reference resolves with no real vault.
 */
async function writeFakeOp(dir: string, resolvedValue: string): Promise<string> {
  const binDir = join(dir, 'fakebin')
  await mkdir(binDir, { recursive: true })
  const opPath = join(binDir, 'op')
  // POSIX shell shim. (The integration suite already assumes a POSIX dev/CI host, as the other
  // e2e tests do — they shell out to `which`/bash-style tooling.)
  const script = [
    '#!/usr/bin/env bash',
    'if [ "$1" = "read" ]; then',
    `  printf '%s' '${resolvedValue}'`,
    '  exit 0',
    'fi',
    'if [ "$1" = "account" ]; then echo "[]"; exit 0; fi',
    'exit 0',
    '',
  ].join('\n')
  await writeFile(opPath, script)
  await chmod(opPath, 0o755)
  return binDir
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
