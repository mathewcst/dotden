/**
 * Opt-in packaging smoke (issue 3-19): prove the PINNED bundle is real end-to-end —
 * fetch the host target's chezmoi + git via the same script electron-builder's beforePack
 * runs, then assert `resolveBundledTools` finds them AND each binary reports its pinned
 * version. This is the closest hermetic stand-in for "the packaged app boots": the runtime
 * tool-resolution path the app takes on first launch, against the actually-downloaded,
 * checksum-verified binaries.
 *
 * NETWORK + slow, so it is gated behind `DOTDEN_FETCH_SMOKE=1` (default `pnpm test` stays
 * offline + fast). The checksum-verification and lock↔resolver contract are covered
 * hermetically in tools-lock.test.ts; this adds the real-download leg when asked.
 *
 *   DOTDEN_FETCH_SMOKE=1 pnpm --filter @dotden/desktop test
 */
/* eslint-disable turbo/no-undeclared-env-vars -- DOTDEN_FETCH_SMOKE is the opt-in gate this smoke reads. */
import { spawnSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { join } from 'node:path'
import { describe, expect, it } from 'vitest'
import { resolveBundledTools } from '../../src/main/foundation/platform/tools.js'

// __dirname is valid here: vitest compiles these .ts test files as CommonJS (NodeNext, no
// package "type":"module"), where import.meta is disallowed.
const desktopRoot = join(__dirname, '..', '..')
const resourcesDir = join(desktopRoot, 'resources')
const fetchScript = join(desktopRoot, 'scripts', 'fetch-binaries.mjs')
const lockPath = join(resourcesDir, 'bin', 'tools.lock.json')

const ENABLED = process.env.DOTDEN_FETCH_SMOKE === '1'

interface Lock {
  chezmoi: { version: string }
  git: { version: string }
}
const lock = JSON.parse(readFileSync(lockPath, 'utf8')) as Lock

describe.runIf(ENABLED)('packaging smoke: fetched bundle boots the tool-resolution path', () => {
  it('fetches, checksum-verifies, resolves, and version-checks the host chezmoi + git', async () => {
    // 1. Fetch the host target into resources/bin/<platform>/<arch>/ (gitignored) —
    //    exactly what before-pack.mjs does for the packaged target.
    const fetched = spawnSync(process.execPath, [fetchScript], {
      cwd: desktopRoot,
      stdio: 'inherit',
    })
    expect(fetched.status, 'fetch-binaries.mjs exited non-zero').toBe(0)

    // 2. The runtime resolution path (the app's first-launch step) finds both bundled tools.
    const tools = await resolveBundledTools(resourcesDir)
    expect(tools.chezmoi).toContain(join('bin', process.platform, process.arch))
    expect(tools.git).toContain(join('bin', process.platform, process.arch))

    // 3. The resolved binaries actually run and report the PINNED versions — the real
    //    "it boots" check (a corrupt/wrong-arch binary would fail here, not silently ship).
    const chezmoiVersion = spawnSync(tools.chezmoi, ['--version'], { encoding: 'utf8' })
    expect(chezmoiVersion.status).toBe(0)
    expect(chezmoiVersion.stdout).toContain(lock.chezmoi.version)

    const gitVersion = spawnSync(tools.git, ['--version'], { encoding: 'utf8' })
    expect(gitVersion.status).toBe(0)
    expect(gitVersion.stdout).toContain(lock.git.version)
  }, 180_000) // Generous timeout: two GitHub release downloads + extraction.
})
