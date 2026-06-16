/**
 * Appearance local override — the environment-local store for THIS environment's override of the
 * SYNCED appearance defaults (issue 2-17, ADR 0024).
 *
 * Round-trips through a real tempdir (the userData stand-in) to prove the per-environment override
 * persists LOCALLY (sparse — only pinned fields), that a missing/corrupt file degrades to the EMPTY
 * override (follow synced defaults), that clearing all pins removes the file, and (critically) that
 * the store NEVER writes into the synced `.myenv/` directory — so pinning a local override never
 * mutates the synced value other environments read (ADR 0024's local-shadows-synced guarantee).
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { readAppearanceOverride, writeAppearanceOverride } from '../appearance-override.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dotden-appearance-override-'))
})
afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('appearance-override (environment-local pin over the synced default, ADR 0024)', () => {
  it('defaults to the EMPTY override when nothing is persisted (follow synced defaults)', async () => {
    expect(await readAppearanceOverride(dir)).toEqual({})
  })

  it('round-trips a sparse override — only the pinned fields persist', async () => {
    await writeAppearanceOverride(dir, { theme: 'blue' })
    expect(await readAppearanceOverride(dir)).toEqual({ theme: 'blue' })

    // Pin more fields independently.
    await writeAppearanceOverride(dir, {
      theme: 'green',
      defaultApply: 'apply-all',
      notifyOn: { incoming: false, conflict: false, applied: true },
    })
    expect(await readAppearanceOverride(dir)).toEqual({
      theme: 'green',
      defaultApply: 'apply-all',
      notifyOn: { incoming: false, conflict: false, applied: true },
    })
  })

  it('clearing all pins (empty override) REMOVES the file (back to following synced defaults)', async () => {
    await writeAppearanceOverride(dir, { theme: 'blue' })
    expect(await readdir(dir)).toContain('appearance-override.json')

    await writeAppearanceOverride(dir, {})
    expect(await readdir(dir)).not.toContain('appearance-override.json')
    expect(await readAppearanceOverride(dir)).toEqual({})
  })

  it('persists to userData only — writes nothing into a synced .myenv/ tree', async () => {
    await writeAppearanceOverride(dir, { theme: 'blue' })
    const entries = await readdir(dir)
    expect(entries).toContain('appearance-override.json')
    expect(entries).not.toContain('.myenv')
  })

  it('degrades to the EMPTY override on corrupt JSON (never a surprising local pin)', async () => {
    await writeFile(join(dir, 'appearance-override.json'), '{ not json', 'utf8')
    expect(await readAppearanceOverride(dir)).toEqual({})
  })

  it('drops invalid fields on read — keeps only validly-pinned ones (sparse, never throws)', async () => {
    await writeFile(
      join(dir, 'appearance-override.json'),
      JSON.stringify({ theme: 'rainbow', defaultApply: 'apply-all', notifyOn: { applied: true } }),
      'utf8',
    )
    // bad theme dropped (inherit synced), valid defaultApply kept, half notifyOn dropped (inherit).
    expect(await readAppearanceOverride(dir)).toEqual({ defaultApply: 'apply-all' })
  })
})
