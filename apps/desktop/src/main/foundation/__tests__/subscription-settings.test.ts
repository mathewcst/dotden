/**
 * subscription-settings — the environment-local "keep vs remove un-subscribed Files"
 * remembered default (issue 1-13). Round-trips through a tempdir, and proves the fail-safe
 * default never silently flips to `remove`.
 */
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  DEFAULT_UNSUBSCRIBE_DISPOSITION,
  readUnsubscribeDisposition,
  writeUnsubscribeDisposition,
} from '../subscription-settings.js'

let dir: string
beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dotden-subsettings-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('subscription-settings', () => {
  it('defaults to the safe `keep` when no file exists (never delete unless asked)', async () => {
    expect(await readUnsubscribeDisposition(dir)).toBe('keep')
    expect(DEFAULT_UNSUBSCRIBE_DISPOSITION).toBe('keep')
  })

  it('round-trips a remembered disposition', async () => {
    await writeUnsubscribeDisposition(dir, 'remove')
    expect(await readUnsubscribeDisposition(dir)).toBe('remove')
    await writeUnsubscribeDisposition(dir, 'keep')
    expect(await readUnsubscribeDisposition(dir)).toBe('keep')
  })

  it('falls back to `keep` (never `remove`) on a malformed/forward-incompatible file', async () => {
    await writeFile(join(dir, 'subscription-settings.json'), '{ not json', 'utf8')
    expect(await readUnsubscribeDisposition(dir)).toBe('keep')
    await writeFile(
      join(dir, 'subscription-settings.json'),
      JSON.stringify({ unsubscribeDisposition: 'nuke-everything' }),
      'utf8',
    )
    // An unrecognized value must degrade to the SAFE default, never to a destructive one.
    expect(await readUnsubscribeDisposition(dir)).toBe('keep')
  })

  it('refuses to persist an unknown disposition (never remember an unbuilt default)', async () => {
    await expect(
      // @ts-expect-error — intentionally invalid to prove the guard rejects it.
      writeUnsubscribeDisposition(dir, 'maybe'),
    ).rejects.toThrow(/unsupported/i)
  })
})
