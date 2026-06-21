/**
 * Sync settings — the environment-local store behind the Settings → Sync tab (issue 2-08,
 * ADR 0024).
 *
 * Round-trips through a real tempdir (the userData stand-in) to prove the three Sync
 * preferences (poller on/off · cadence profile · start-on-login) persist LOCALLY and that a
 * missing/corrupt/partial file always degrades to the SAFE defaults — never to a surprising
 * state, and (critically) NEVER into the synced `.dotden/` directory (ADR 0024 keeps these
 * environment-local: a per-machine override, not user-authored organization).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { DEFAULT_SYNC_SETTINGS, readSyncSettings, writeSyncSettings } from '../sync-settings.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dotden-sync-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('sync-settings (environment-local, ADR 0024)', () => {
  it('defaults to poller-on · fast cadence · autostart-off when nothing is persisted', async () => {
    expect(await readSyncSettings(dir)).toEqual(DEFAULT_SYNC_SETTINGS)
    expect(DEFAULT_SYNC_SETTINGS).toEqual({
      pollerEnabled: true,
      cadence: 'fast',
      startOnLogin: false,
    })
  })

  it('round-trips every Sync preference', async () => {
    await writeSyncSettings(dir, {
      pollerEnabled: false,
      cadence: 'relaxed',
      startOnLogin: true,
    })
    expect(await readSyncSettings(dir)).toEqual({
      pollerEnabled: false,
      cadence: 'relaxed',
      startOnLogin: true,
    })
    // ...and the user can flip them all back.
    await writeSyncSettings(dir, DEFAULT_SYNC_SETTINGS)
    expect(await readSyncSettings(dir)).toEqual(DEFAULT_SYNC_SETTINGS)
  })

  it('persists to userData only — writes nothing into a synced .dotden/ tree', async () => {
    // The store is handed the userData dir; it must write its own file there and create NO
    // `.dotden/` directory (that boundary is the whole point of ADR 0024 — poller/autostart
    // are per-environment facts that must never become merge-churning synced state).
    await writeSyncSettings(dir, { pollerEnabled: false, cadence: 'relaxed', startOnLogin: true })
    const entries = await readdir(dir)
    expect(entries).toContain('sync-settings.json')
    expect(entries).not.toContain('.dotden')
  })

  it('falls back to safe defaults on corrupt JSON (never fail silently)', async () => {
    await writeFile(join(dir, 'sync-settings.json'), '{ not json', 'utf8')
    expect(await readSyncSettings(dir)).toEqual(DEFAULT_SYNC_SETTINGS)
  })

  it('fills each missing/invalid field with its safe default independently', async () => {
    // A partially-written / forward-incompatible file must still yield a coherent object:
    // honor the valid field, default the rest — rather than throwing or going all-default.
    await writeFile(
      join(dir, 'sync-settings.json'),
      JSON.stringify({ pollerEnabled: false, cadence: 'lightspeed' }),
      'utf8',
    )
    expect(await readSyncSettings(dir)).toEqual({
      pollerEnabled: false, // honored (valid boolean)
      cadence: 'fast', // unknown profile → safe default
      startOnLogin: false, // absent → safe default
    })
  })
})
