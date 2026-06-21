/**
 * Tests for {@link resolveBundledTools} — how dotden locates the chezmoi/git
 * binaries it BUNDLES inside its app resources.
 *
 * Resolution must never depend on a host install: it probes
 * `bin/<platform>/<arch>/<name>` first, then a flat `bin/<name>` fallback, and
 * honours `DOTDEN_*_BIN` env overrides for dev/tests. These cases pin that
 * priority order, the throw-on-missing contract, and the env override — using
 * runnable executable stubs on disk rather than real tools.
 */
/* eslint-disable turbo/no-undeclared-env-vars -- exercising the DOTDEN_*_BIN dev/test overrides resolveBundledTools reads. */
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { resolveBundledTools } from '../tools.js'
import { createExecutableStub } from '../../__tests__/temp-git-repo.fixture.js'

// chezmoi/git carry the `.exe` suffix on Windows; mirror resolveBundledTools' naming.
const chezmoiName = process.platform === 'win32' ? 'chezmoi.exe' : 'chezmoi'
const gitName = process.platform === 'win32' ? 'git.exe' : 'git'

describe('resolveBundledTools', () => {
  let resources: string
  // Snapshot the env overrides so a test that sets them can't leak into the next.
  let savedChezmoiBin: string | undefined
  let savedGitBin: string | undefined

  beforeEach(async () => {
    resources = await mkdtemp(join(tmpdir(), 'dotden-tools-'))
    savedChezmoiBin = process.env.DOTDEN_CHEZMOI_BIN
    savedGitBin = process.env.DOTDEN_GIT_BIN
    // Start from a clean slate so the bin/ probing (not a stray override) is what's tested.
    delete process.env.DOTDEN_CHEZMOI_BIN
    delete process.env.DOTDEN_GIT_BIN
  })

  afterEach(async () => {
    // Restore exactly what was there before (including "was unset") so env mutation is contained.
    restoreEnv('DOTDEN_CHEZMOI_BIN', savedChezmoiBin)
    restoreEnv('DOTDEN_GIT_BIN', savedGitBin)
    await rm(resources, { recursive: true, force: true })
  })

  it('resolves arch-specific bin/<platform>/<arch>/<name> stubs', async () => {
    const archDir = join(resources, 'bin', process.platform, process.arch)
    await mkdir(archDir, { recursive: true })
    const chezmoi = join(archDir, chezmoiName)
    const git = join(archDir, gitName)
    await createExecutableStub(chezmoi)
    await createExecutableStub(git)

    await expect(resolveBundledTools(resources)).resolves.toEqual({ chezmoi, git })
  })

  it('rejects with a DOTDEN_*_BIN hint when neither binary can be found', async () => {
    // resources/ has no bin/ at all and no env overrides → nothing resolves.
    await expect(resolveBundledTools(resources)).rejects.toThrow(
      /DOTDEN_CHEZMOI_BIN.*DOTDEN_GIT_BIN/,
    )
  })

  it('falls back to flat bin/<name> stubs when no platform/arch layout exists', async () => {
    const binDir = join(resources, 'bin')
    await mkdir(binDir, { recursive: true })
    const chezmoi = join(binDir, chezmoiName)
    const git = join(binDir, gitName)
    await createExecutableStub(chezmoi)
    await createExecutableStub(git)

    await expect(resolveBundledTools(resources)).resolves.toEqual({ chezmoi, git })
  })

  it('prefers the platform/arch path over the flat fallback when both exist', async () => {
    const binDir = join(resources, 'bin')
    const archDir = join(binDir, process.platform, process.arch)
    await mkdir(archDir, { recursive: true })
    // Both layouts present; arch-specific must win.
    await createExecutableStub(join(binDir, chezmoiName))
    await createExecutableStub(join(binDir, gitName))
    const chezmoi = join(archDir, chezmoiName)
    const git = join(archDir, gitName)
    await createExecutableStub(chezmoi)
    await createExecutableStub(git)

    await expect(resolveBundledTools(resources)).resolves.toEqual({ chezmoi, git })
  })

  it('lets DOTDEN_*_BIN env overrides win even with no bin/ directory', async () => {
    const overrides = await mkdtemp(join(tmpdir(), 'dotden-tools-env-'))
    try {
      const chezmoi = join(overrides, chezmoiName)
      const git = join(overrides, gitName)
      await createExecutableStub(chezmoi)
      await createExecutableStub(git)
      process.env.DOTDEN_CHEZMOI_BIN = chezmoi
      process.env.DOTDEN_GIT_BIN = git

      // resources/ is empty (no bin/) — only the env overrides can satisfy this.
      await expect(resolveBundledTools(resources)).resolves.toEqual({ chezmoi, git })
    } finally {
      await rm(overrides, { recursive: true, force: true })
    }
  })
})

/** Restore an env var to a prior value, deleting it when it was originally unset. */
function restoreEnv(name: string, value: string | undefined): void {
  if (value === undefined) delete process.env[name]
  else process.env[name] = value
}
