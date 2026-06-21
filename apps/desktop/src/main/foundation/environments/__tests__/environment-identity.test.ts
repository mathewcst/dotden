/**
 * EnvironmentIdentity unit tests — the stable, environment-local id (issue 1-05, ADR 0024).
 *
 * Asserts the identity invariants the registry rides on: the id is a generated stable
 * token written once at setup (survives relaunches and is decoupled from hostname); a
 * missing id is the new-or-returning signal ({@link readLocalIdentity} returns null
 * without minting); the "returning" branch adopts an existing id via
 * {@link claimLocalIdentity}; and the setup-time hostname is frozen as the claim hint
 * so a later hostname change does not lose it. Uses a real tempdir (no fs mocking).
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import {
  claimLocalIdentity,
  loadEnvironmentIdentity,
  readLocalIdentity,
} from '../environment-identity.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dotden-identity-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('EnvironmentIdentity', () => {
  it('mints a stable id on first run and reuses it on the next load', async () => {
    const first = await loadEnvironmentIdentity(dir)
    expect(first.id).toMatch(/[0-9a-f-]{36}/i)
    expect(first.label.length).toBeGreaterThan(0)
    expect(first.os).toBe(process.platform)

    const second = await loadEnvironmentIdentity(dir)
    // Stable: the id is read back, not re-minted — identity survives a relaunch.
    expect(second.id).toBe(first.id)
  })

  it('writes only an id + hostnameAtSetup (no attribution) to local state', async () => {
    const identity = await loadEnvironmentIdentity(dir)
    const raw = JSON.parse(await readFile(join(dir, 'environment-identity.json'), 'utf8'))
    // The persisted local file carries exactly the id + the claim hint — nothing else,
    // and notably no label (the label is derived from the live hostname on every load).
    expect(Object.keys(raw).sort()).toEqual(['hostnameAtSetup', 'id'])
    expect(raw.id).toBe(identity.id)
  })

  it('readLocalIdentity returns null for a fresh install WITHOUT minting (the fork signal)', async () => {
    // A missing local id is exactly what routes to the new-or-returning fork (#13).
    expect(await readLocalIdentity(dir)).toBeNull()
    // Crucially, probing must not have created an identity file (no side effect).
    expect(await readLocalIdentity(dir)).toBeNull()
  })

  it('claimLocalIdentity adopts an existing registry id (the "returning" branch)', async () => {
    const claimed = await claimLocalIdentity(dir, 'existing-registry-id')
    expect(claimed.id).toBe('existing-registry-id')
    // The claim is durable: the next load reads the adopted id back.
    expect(await readLocalIdentity(dir)).toBe('existing-registry-id')
    expect((await loadEnvironmentIdentity(dir)).id).toBe('existing-registry-id')
  })

  it('refuses to claim an empty id', async () => {
    await expect(claimLocalIdentity(dir, '')).rejects.toThrow()
  })

  it('preserves the setup-time hostname hint even when the live hostname changes', async () => {
    // Simulate a machine that was set up under a different hostname than it has now.
    await writeFile(
      join(dir, 'environment-identity.json'),
      `${JSON.stringify({ id: 'id-1', hostnameAtSetup: 'old-host' }, null, 2)}\n`,
      'utf8',
    )
    const identity = await loadEnvironmentIdentity(dir)
    expect(identity.id).toBe('id-1')
    // The claim hint stays the ORIGINAL hostname (used by #13 to suggest a match),
    // while the live label tracks the current hostname.
    expect(identity.hostnameAtSetup).toBe('old-host')
  })
})
