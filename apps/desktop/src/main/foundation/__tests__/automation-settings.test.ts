/**
 * Automation settings — the environment-local automation-level store (issue 1-12, ADR 0024).
 *
 * Round-trips through a real tempdir (the userData stand-in) to prove the level persists
 * locally and that a missing/corrupt/unbuilt level always falls back to the SAFE Manual
 * default — never silently into a more-automated rung.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readAutomationLevel, writeAutomationLevel } from '../automation-settings.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dotden-automation-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('automation-settings (environment-local, ADR 0024)', () => {
  it('defaults to Manual when nothing is persisted yet', async () => {
    expect(await readAutomationLevel(dir)).toBe('manual')
  })

  it('round-trips the Auto-sync opt-in', async () => {
    await writeAutomationLevel(dir, 'auto-sync')
    expect(await readAutomationLevel(dir)).toBe('auto-sync')
    // And the user can turn it back off.
    await writeAutomationLevel(dir, 'manual')
    expect(await readAutomationLevel(dir)).toBe('manual')
  })

  it('refuses to persist a level the MVP does not expose', async () => {
    // auto-apply / yolo are valid AutomationLevels but NOT built yet (issue 2-12); writing
    // one must throw, never leave an unbuilt level on disk that a later read might act on.
    await expect(writeAutomationLevel(dir, 'yolo')).rejects.toThrow(/unsupported/)
  })

  it('falls back to Manual on corrupt JSON (never silently more automated)', async () => {
    await writeFile(join(dir, 'automation-settings.json'), '{ not json', 'utf8')
    expect(await readAutomationLevel(dir)).toBe('manual')
  })

  it('falls back to Manual when an unbuilt level is somehow on disk', async () => {
    // A forward-incompatible file (e.g. written by a newer build) must not turn on a
    // mode this MVP cannot run — it reads as the safe Manual default.
    await writeFile(
      join(dir, 'automation-settings.json'),
      JSON.stringify({ level: 'yolo' }),
      'utf8',
    )
    expect(await readAutomationLevel(dir)).toBe('manual')
  })
})
