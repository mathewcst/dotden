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

  it('round-trips the Auto-apply opt-in (issue 2-12)', async () => {
    await writeAutomationLevel(dir, 'auto-apply')
    expect(await readAutomationLevel(dir)).toBe('auto-apply')
  })

  it('round-trips the YOLO opt-in (issue 2-13 — now a built, selectable rung)', async () => {
    // yolo's full hands-off path ships in 2-13, so it is selectable and must persist; it is
    // still OFF until explicitly chosen, but once chosen it round-trips like any rung.
    await writeAutomationLevel(dir, 'yolo')
    expect(await readAutomationLevel(dir)).toBe('yolo')
  })

  it('refuses to persist a non-selectable level (an unknown future rung)', async () => {
    // An unbuilt/unknown level must throw, never leave a level on disk a later read might act on.
    await expect(
      writeAutomationLevel(dir, 'turbo' as Parameters<typeof writeAutomationLevel>[1]),
    ).rejects.toThrow(/unsupported/)
  })

  it('falls back to Manual on corrupt JSON (never silently more automated)', async () => {
    await writeFile(join(dir, 'automation-settings.json'), '{ not json', 'utf8')
    expect(await readAutomationLevel(dir)).toBe('manual')
  })

  it('falls back to Manual when an unknown level is somehow on disk', async () => {
    // A forward-incompatible file (e.g. written by a newer build) must not turn on a
    // mode this build cannot run — an unrecognized level reads as the safe Manual default.
    await writeFile(
      join(dir, 'automation-settings.json'),
      JSON.stringify({ level: 'turbo' }),
      'utf8',
    )
    expect(await readAutomationLevel(dir)).toBe('manual')
  })
})
