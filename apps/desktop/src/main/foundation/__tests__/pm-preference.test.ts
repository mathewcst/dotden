/**
 * pm-preference unit tests — the environment-local "Remember my choice" store (issue 2-05).
 *
 * The preferred password manager is environment-LOCAL, never synced (acceptance criterion 10): it
 * lives under Electron `userData` exactly like the automation level, so the round-trip is unit-
 * testable in plain Node against a tempdir. A corrupt/forward-incompatible file falls back to
 * "no preference" (never a wrong manager).
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { readPmPreference, writePmPreference } from '../pm-preference.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dotden-pm-pref-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('pm-preference', () => {
  it('returns null when no preference has been written yet', async () => {
    expect(await readPmPreference(dir)).toBeNull()
  })

  it('round-trips a written preference', async () => {
    await writePmPreference(dir, { manager: 'op', account: 'my.1password.com' })
    expect(await readPmPreference(dir)).toEqual({ manager: 'op', account: 'my.1password.com' })
  })

  it('persists a manager without an account', async () => {
    await writePmPreference(dir, { manager: 'pass' })
    expect(await readPmPreference(dir)).toEqual({ manager: 'pass' })
  })

  it('overwrites a prior preference (the user changed their default manager)', async () => {
    await writePmPreference(dir, { manager: 'op' })
    await writePmPreference(dir, { manager: 'bw' })
    expect(await readPmPreference(dir)).toEqual({ manager: 'bw' })
  })

  it('falls back to null on malformed JSON rather than throwing', async () => {
    await writeFile(join(dir, 'pm-preference.json'), '{ not json', 'utf8')
    expect(await readPmPreference(dir)).toBeNull()
  })

  it('falls back to null when the stored manager is not a known v1 manager', async () => {
    await writeFile(
      join(dir, 'pm-preference.json'),
      JSON.stringify({ manager: 'lastpass' }),
      'utf8',
    )
    // A forward-incompatible manager id must NOT resolve to a wrong/unsupported manager.
    expect(await readPmPreference(dir)).toBeNull()
  })

  it('rejects writing an unsupported manager (never persist an unbuilt manager)', async () => {
    await expect(
      // @ts-expect-error — exercising the runtime guard against an off-enum id.
      writePmPreference(dir, { manager: 'lastpass' }),
    ).rejects.toThrow(/manager/i)
  })
})
