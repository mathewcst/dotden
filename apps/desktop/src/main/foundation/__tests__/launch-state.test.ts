/**
 * Launch-gate tests (ADR 0026) — the predicate that decides the boot screen.
 *
 * These prove the load-bearing rules: `ready` only when THIS environment is in the synced
 * registry, `incomplete` when the Den is cloned but this environment is not registered, and
 * `fresh` when nothing is cloned here — and that the gate reads from disk WITHOUT minting an
 * identity (it relies on the side-effect-free `readLocalIdentity`).
 */
import { mkdtemp, mkdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { computeLaunchState, sourceExists } from '../launch-state.js'

describe('computeLaunchState (ADR 0026 launch gate)', () => {
  let root: string
  let sourceDir: string
  let userDataDir: string

  beforeEach(async () => {
    root = await mkdtemp(join(tmpdir(), 'dotden-launch-'))
    sourceDir = join(root, 'source')
    userDataDir = join(root, 'userData')
    await mkdir(sourceDir, { recursive: true })
    await mkdir(userDataDir, { recursive: true })
  })
  afterEach(async () => {
    await rm(root, { recursive: true, force: true })
  })

  /** Mark sourceDir as a clone by creating its `.git` entry (what `chezmoi init` leaves). */
  async function seedClone(): Promise<void> {
    await mkdir(join(sourceDir, '.git'), { recursive: true })
  }
  /** Persist a local environment id, mirroring the on-disk identity file shape. */
  async function seedLocalId(id: string): Promise<void> {
    await writeFile(join(userDataDir, 'environment-identity.json'), JSON.stringify({ id }), 'utf8')
  }
  /** Write the synced registry with the given environment ids. */
  async function seedRegistry(ids: readonly string[]): Promise<void> {
    await mkdir(join(sourceDir, '.myenv'), { recursive: true })
    await writeFile(
      join(sourceDir, '.myenv', 'environments.json'),
      JSON.stringify({
        environments: ids.map((id) => ({
          id,
          label: id,
          os: 'linux',
          subscribedWorkspaces: [],
        })),
      }),
      'utf8',
    )
  }

  it('is fresh when nothing is cloned here', async () => {
    expect(await computeLaunchState({ sourceDir, userDataDir })).toEqual({ status: 'fresh' })
  })

  it('is fresh even if a local id was minted but no clone exists', async () => {
    await seedLocalId('env-1')
    expect(await computeLaunchState({ sourceDir, userDataDir })).toEqual({ status: 'fresh' })
  })

  it('is incomplete when the Den is cloned but this environment is not registered', async () => {
    await seedClone()
    await seedLocalId('env-1')
    await seedRegistry(['someone-else']) // a registry exists, but not THIS id
    expect(await computeLaunchState({ sourceDir, userDataDir })).toEqual({ status: 'incomplete' })
  })

  it('is incomplete when cloned with a local id but an absent registry', async () => {
    await seedClone()
    await seedLocalId('env-1')
    expect(await computeLaunchState({ sourceDir, userDataDir })).toEqual({ status: 'incomplete' })
  })

  it('is ready when cloned and this environment is in the synced registry', async () => {
    await seedClone()
    await seedLocalId('env-1')
    await seedRegistry(['env-1', 'env-2'])
    expect(await computeLaunchState({ sourceDir, userDataDir })).toEqual({ status: 'ready' })
  })

  it('is incomplete (not ready) when the registry lists the id but there is no local id', async () => {
    // Without a local id this install cannot be "self", even though the entry exists — the
    // returning fork must still claim it (ADR 0026 keeps that an explicit landing re-choice).
    await seedClone()
    await seedRegistry(['env-1'])
    expect(await computeLaunchState({ sourceDir, userDataDir })).toEqual({ status: 'incomplete' })
  })
})

describe('sourceExists', () => {
  it('is false for a missing / non-clone dir and true once .git exists', async () => {
    const root = await mkdtemp(join(tmpdir(), 'dotden-src-'))
    try {
      expect(await sourceExists(join(root, 'nope'))).toBe(false)
      expect(await sourceExists(root)).toBe(false)
      await mkdir(join(root, '.git'), { recursive: true })
      expect(await sourceExists(root)).toBe(true)
    } finally {
      await rm(root, { recursive: true, force: true })
    }
  })
})
