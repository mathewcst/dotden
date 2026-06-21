import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { afterEach, describe, expect, it } from 'vitest'

import {
  DEFAULT_DIAGNOSTICS_SETTINGS,
  readDiagnosticsSettings,
  writeDiagnosticsSettings,
} from '../diagnostics-settings.js'

let dirs: string[] = []

async function tempDir(): Promise<string> {
  const dir = await mkdtemp(join(tmpdir(), 'dotden-diagnostics-settings-'))
  dirs.push(dir)
  return dir
}

afterEach(async () => {
  await Promise.all(dirs.map((dir) => rm(dir, { recursive: true, force: true })))
  dirs = []
})

describe('diagnostics settings', () => {
  it('defaults the standing Console off', async () => {
    await expect(readDiagnosticsSettings(await tempDir())).resolves.toEqual(
      DEFAULT_DIAGNOSTICS_SETTINGS,
    )
  })

  it('persists the Console preference', async () => {
    const dir = await tempDir()
    await writeDiagnosticsSettings(dir, { consoleEnabled: true })
    await expect(readDiagnosticsSettings(dir)).resolves.toEqual({ consoleEnabled: true })
  })

  it('falls back to off for corrupt settings', async () => {
    const dir = await tempDir()
    await writeFile(join(dir, 'diagnostics-settings.json'), '{nope', 'utf8')
    await expect(readDiagnosticsSettings(dir)).resolves.toEqual(DEFAULT_DIAGNOSTICS_SETTINGS)
  })
})
