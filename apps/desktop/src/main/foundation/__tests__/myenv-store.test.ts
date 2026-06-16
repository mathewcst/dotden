/**
 * MyenvStore unit tests — the synced `.myenv/` metadata seam (ADR 0024).
 *
 * Asserts the store seeds a default Workspace + this environment's registry entry,
 * records File placements idempotently, upserts environments by stable id, and keeps
 * `.myenv/` chezmoi-ignored. Uses a real tempdir (no mocking of fs) since the whole
 * point is the on-disk JSON a second environment will clone and read.
 */
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_WORKSPACE_ID, MyenvStore } from '../myenv-store.js'

let source: string

beforeEach(async () => {
  source = await mkdtemp(join(tmpdir(), 'dotden-myenv-'))
})

afterEach(async () => {
  await rm(source, { recursive: true, force: true })
})

describe('MyenvStore', () => {
  it('seeds a default Workspace + this environment, and chezmoi-ignores .myenv/', async () => {
    const store = new MyenvStore(source)

    await store.seedDefault({ id: 'env-1', label: 'laptop', os: 'linux' })

    const workspaces = await store.readWorkspaces()
    expect(workspaces.workspaces).toEqual([{ id: DEFAULT_WORKSPACE_ID, label: 'Personal' }])

    const registry = await store.readEnvironments()
    expect(registry.environments).toEqual([
      {
        id: 'env-1',
        label: 'laptop',
        os: 'linux',
        subscribedWorkspaces: [DEFAULT_WORKSPACE_ID],
      },
    ])

    const ignore = await readFile(join(source, '.chezmoiignore'), 'utf8')
    expect(ignore).toContain('.myenv/')
  })

  it('records File placements idempotently', async () => {
    const store = new MyenvStore(source)
    await store.seedDefault({ id: 'env-1', label: 'laptop', os: 'linux' })

    await store.placeFile('.zshrc')
    await store.placeFile('.zshrc') // re-Track should not duplicate
    await store.placeFile('.gitconfig')

    const { placements } = await store.readWorkspaces()
    expect(placements).toEqual([
      { targetPath: '.zshrc', workspaceId: DEFAULT_WORKSPACE_ID },
      { targetPath: '.gitconfig', workspaceId: DEFAULT_WORKSPACE_ID },
    ])
  })

  it('upserts environments by stable id without duplicating', async () => {
    const store = new MyenvStore(source)
    await store.seedDefault({ id: 'env-1', label: 'old-label', os: 'linux' })

    await store.registerEnvironment({
      id: 'env-1',
      label: 'new-label',
      os: 'linux',
      subscribedWorkspaces: [DEFAULT_WORKSPACE_ID],
    })
    await store.registerEnvironment({
      id: 'env-2',
      label: 'second',
      os: 'darwin',
      subscribedWorkspaces: [DEFAULT_WORKSPACE_ID],
    })

    const { environments } = await store.readEnvironments()
    expect(environments.map((e) => e.id)).toEqual(['env-1', 'env-2'])
    expect(environments.find((e) => e.id === 'env-1')?.label).toBe('new-label')
  })

  it('does not duplicate the .myenv/ ignore rule across seeds', async () => {
    const store = new MyenvStore(source)
    await store.seedDefault({ id: 'env-1', label: 'laptop', os: 'linux' })
    await store.seedDefault({ id: 'env-1', label: 'laptop', os: 'linux' })

    const ignore = await readFile(join(source, '.chezmoiignore'), 'utf8')
    const occurrences = ignore.split(/\r?\n/).filter((line) => line === '.myenv/').length
    expect(occurrences).toBe(1)
  })
})
