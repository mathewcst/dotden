/**
 * electron-builder `beforePack` hook (issue 3-19): guarantee the PINNED chezmoi + git
 * binaries for the target being packaged are present in resources/bin/<platform>/<arch>/
 * BEFORE electron-builder copies them in via `extraResources`.
 *
 * Without this, a clean checkout's resources/bin holds only docs + the lock file, so the
 * shipped app would resolve no bundled tools and fail loud at first use. The hook maps
 * electron-builder's target descriptor onto the lock's `<platform>/<arch>` key and shells
 * out to fetch-binaries.mjs for exactly that target (a no-op if already fetched).
 *
 * electron-builder loads this as an ESM default export because the file ends in `.mjs`.
 */
import { spawnSync } from 'node:child_process'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'

const here = dirname(fileURLToPath(import.meta.url))

/** electron-builder Arch enum (numeric) → Node `process.arch` string the lock keys on. */
const ARCH_TO_NODE = { 0: 'ia32', 1: 'x64', 2: 'armv7l', 3: 'arm64', 4: 'universal' }

/**
 * @param {{ electronPlatformName: string, arch: number }} context electron-builder's hook context.
 *   `electronPlatformName` is already Node's `process.platform` ('darwin'|'win32'|'linux');
 *   `arch` is the numeric `builder-util` Arch enum, mapped above.
 */
export default async function beforePack(context) {
  const platform = context.electronPlatformName
  const arch = ARCH_TO_NODE[context.arch]
  if (!arch) {
    throw new Error(`[before-pack] unsupported electron-builder arch enum: ${context.arch}`)
  }
  const targetKey = `${platform}/${arch}`

  console.log(`[before-pack] ensuring pinned chezmoi + git for ${targetKey}`)
  const result = spawnSync(
    process.execPath,
    [join(here, 'fetch-binaries.mjs'), `--target=${targetKey}`],
    { stdio: 'inherit' },
  )
  if (result.status !== 0) {
    // Fail the pack loudly: shipping an installer that resolves no bundled tools would
    // break every chezmoi/git verb at runtime (never fail silently).
    throw new Error(`[before-pack] failed to fetch pinned tools for ${targetKey}`)
  }
}
