/**
 * Privacy settings — the environment-local telemetry-consent store behind the Settings → Privacy
 * tab (issue 2-14, stories 43–44; ADR 0007/0001/0024).
 *
 * Round-trips through a real tempdir (the userData stand-in) to prove the three consent flags
 * (analytics · crash reports · diagnostic logs) persist LOCALLY, that they DEFAULT OFF, and that a
 * missing/corrupt/partial file always degrades to the SAFE all-off state — the consent gate must
 * fail CLOSED, never silently turn telemetry on, and (critically) NEVER write into the synced
 * `.myenv/` directory (ADR 0024 keeps consent environment-local: a per-machine decision, not
 * user-authored organization).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  DEFAULT_PRIVACY_SETTINGS,
  readPrivacySettings,
  writePrivacySettings,
} from '../privacy-settings.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dotden-privacy-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('privacy-settings (environment-local consent, ADR 0024)', () => {
  it('defaults ALL consents to OFF when nothing is persisted (privacy by default)', async () => {
    expect(await readPrivacySettings(dir)).toEqual(DEFAULT_PRIVACY_SETTINGS)
    expect(DEFAULT_PRIVACY_SETTINGS).toEqual({
      analyticsEnabled: false,
      crashReportsEnabled: false,
      diagnosticLogsEnabled: false,
    })
  })

  it('round-trips each consent flag independently', async () => {
    await writePrivacySettings(dir, {
      analyticsEnabled: true,
      crashReportsEnabled: false,
      diagnosticLogsEnabled: false,
    })
    expect(await readPrivacySettings(dir)).toEqual({
      analyticsEnabled: true,
      crashReportsEnabled: false,
      diagnosticLogsEnabled: false,
    })
    // The opt-ins are independent: each can be flipped on its own.
    await writePrivacySettings(dir, {
      analyticsEnabled: true,
      crashReportsEnabled: true,
      diagnosticLogsEnabled: true,
    })
    expect(await readPrivacySettings(dir)).toEqual({
      analyticsEnabled: true,
      crashReportsEnabled: true,
      diagnosticLogsEnabled: true,
    })
    // ...and the user can revoke them all back to off.
    await writePrivacySettings(dir, DEFAULT_PRIVACY_SETTINGS)
    expect(await readPrivacySettings(dir)).toEqual(DEFAULT_PRIVACY_SETTINGS)
  })

  it('persists to userData only — writes nothing into a synced .myenv/ tree', async () => {
    // The store is handed the userData dir; it must write its own file there and create NO
    // `.myenv/` directory (ADR 0024 — telemetry consent is a per-environment decision that must
    // never become synced state another machine inherits).
    await writePrivacySettings(dir, {
      analyticsEnabled: true,
      crashReportsEnabled: true,
      diagnosticLogsEnabled: true,
    })
    const entries = await readdir(dir)
    expect(entries).toContain('privacy-settings.json')
    expect(entries).not.toContain('.myenv')
  })

  it('fails CLOSED to all-off on corrupt JSON (never silently enable telemetry)', async () => {
    await writeFile(join(dir, 'privacy-settings.json'), '{ not json', 'utf8')
    expect(await readPrivacySettings(dir)).toEqual(DEFAULT_PRIVACY_SETTINGS)
  })

  it('fills each missing/invalid field with its safe OFF default independently', async () => {
    // A partially-written / forward-incompatible file must still yield a coherent object: honor
    // the valid flag, default the rest to off — never throw, never go all-on.
    await writeFile(
      join(dir, 'privacy-settings.json'),
      JSON.stringify({ analyticsEnabled: true, crashReportsEnabled: 'yes-please' }),
      'utf8',
    )
    expect(await readPrivacySettings(dir)).toEqual({
      analyticsEnabled: true, // honored (valid boolean)
      crashReportsEnabled: false, // non-boolean → safe off default (fail closed)
      diagnosticLogsEnabled: false, // absent → safe off default
    })
  })
})
