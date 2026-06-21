import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_UPDATE_SETTINGS,
  readUpdateSettings,
  writeUpdateSettings,
} from '../update-settings.js'

let root: string

beforeEach(async () => {
  root = await mkdtemp(join(tmpdir(), 'dotden-update-settings-'))
})

afterEach(async () => {
  await rm(root, { recursive: true, force: true })
})

describe('update settings', () => {
  it('defaults to automatic stable updates before the user edits it', async () => {
    await expect(readUpdateSettings(root)).resolves.toEqual(DEFAULT_UPDATE_SETTINGS)
  })

  it('persists update channel, auto-update switch, and last checked timestamp', async () => {
    const saved = await writeUpdateSettings(root, {
      autoUpdateEnabled: false,
      channel: 'beta',
      lastCheckedAt: '2026-06-21T10:00:00.000Z',
    })

    expect(saved).toEqual({
      autoUpdateEnabled: false,
      channel: 'beta',
      lastCheckedAt: '2026-06-21T10:00:00.000Z',
    })
    await expect(readUpdateSettings(root)).resolves.toEqual(saved)
  })
})
