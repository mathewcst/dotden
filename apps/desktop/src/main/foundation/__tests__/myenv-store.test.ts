/**
 * MyenvStore unit tests — the synced `.myenv/` metadata seam (ADR 0024).
 *
 * Asserts the store seeds a default Workspace + this environment's registry entry,
 * records File placements idempotently, upserts environments by stable id, and keeps
 * `.myenv/` chezmoi-ignored. Uses a real tempdir (no mocking of fs) since the whole
 * point is the on-disk JSON a second environment will clone and read.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
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
    expect(workspaces.workspaces).toEqual([
      { id: DEFAULT_WORKSPACE_ID, label: 'Personal', groups: [] },
    ])

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
      { targetPath: '.zshrc', workspaceId: DEFAULT_WORKSPACE_ID, groupId: null },
      { targetPath: '.gitconfig', workspaceId: DEFAULT_WORKSPACE_ID, groupId: null },
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

  it('forward-loads a legacy workspaces.json (no groups / no groupId) into the canonical shape', async () => {
    // A `.myenv/` written by a dotden from before the 1-14 Group slice has neither
    // `groups` on the Workspace nor `groupId` on placements. readWorkspaces must still
    // load it cleanly, defaulting both — the synced metadata is forward-compatible.
    const store = new MyenvStore(source)
    await store.seedDefault({ id: 'env-1', label: 'laptop', os: 'linux' })
    const legacy = JSON.stringify({
      workspaces: [{ id: DEFAULT_WORKSPACE_ID, label: 'Personal' }],
      placements: [{ targetPath: '.zshrc', workspaceId: DEFAULT_WORKSPACE_ID }],
    })
    await writeFile(join(source, '.myenv', 'workspaces.json'), legacy, 'utf8')

    const doc = await store.readWorkspaces()
    expect(doc.workspaces).toEqual([{ id: DEFAULT_WORKSPACE_ID, label: 'Personal', groups: [] }])
    expect(doc.placements).toEqual([
      { targetPath: '.zshrc', workspaceId: DEFAULT_WORKSPACE_ID, groupId: null },
    ])
  })
})

/**
 * Workspaces + nested Groups (issue 1-14, ADR 0005).
 *
 * These cover the user-authored organization layer this slice owns: creating a second
 * Workspace (the access boundary), nesting Groups inside a Workspace, and — the
 * load-bearing invariant — that Groups are PURE organization: moving a File between
 * Groups changes neither its access (`workspaceId`) nor its on-disk path (`targetPath`).
 */
describe('MyenvStore — Workspaces + nested Groups (1-14)', () => {
  it('createWorkspace adds a second, separate Workspace with a stable id and no Groups', async () => {
    const store = new MyenvStore(source)
    await store.seedDefault({ id: 'env-1', label: 'laptop', os: 'linux' })

    const work = await store.createWorkspace('Work')
    expect(work.label).toBe('Work')
    expect(work.id).not.toBe(DEFAULT_WORKSPACE_ID)
    expect(work.groups).toEqual([])

    const { workspaces } = await store.readWorkspaces()
    // The default Workspace is untouched; the new one is appended — now TWO exist, which
    // is what reveals the Workspace concept in the UI (1-14 "invisible until 2nd").
    expect(workspaces.map((w) => w.label)).toEqual(['Personal', 'Work'])
  })

  it('createGroup nests Groups inside a Workspace (top-level and child)', async () => {
    const store = new MyenvStore(source)
    await store.seedDefault({ id: 'env-1', label: 'laptop', os: 'linux' })

    const shell = await store.createGroup(DEFAULT_WORKSPACE_ID, 'Shell')
    expect(shell.parentId).toBeNull()
    const zsh = await store.createGroup(DEFAULT_WORKSPACE_ID, 'zsh', shell.id)
    expect(zsh.parentId).toBe(shell.id)

    const ws = (await store.readWorkspaces()).workspaces.find((w) => w.id === DEFAULT_WORKSPACE_ID)
    expect(ws?.groups.map((g) => g.label)).toEqual(['Shell', 'zsh'])
  })

  it('createGroup refuses a Workspace that does not exist, and a cross-Workspace parent', async () => {
    const store = new MyenvStore(source)
    await store.seedDefault({ id: 'env-1', label: 'laptop', os: 'linux' })
    const work = await store.createWorkspace('Work')
    const personalGroup = await store.createGroup(DEFAULT_WORKSPACE_ID, 'Shell')

    await expect(store.createGroup('no-such-ws', 'X')).rejects.toThrow(/does not exist/)
    // A Group in 'Work' may not nest under a Group that belongs to 'Personal' — Groups
    // never span Workspaces (a Group belongs to exactly one access boundary).
    await expect(store.createGroup(work.id, 'X', personalGroup.id)).rejects.toThrow(/not a Group/)
  })

  it('moveFileToGroup is organization-ONLY: access (workspaceId) and path (targetPath) are unchanged', async () => {
    const store = new MyenvStore(source)
    await store.seedDefault({ id: 'env-1', label: 'laptop', os: 'linux' })
    await store.placeFile('.zshrc')
    const shell = await store.createGroup(DEFAULT_WORKSPACE_ID, 'Shell')

    const before = (await store.readWorkspaces()).placements.find((p) => p.targetPath === '.zshrc')!

    await store.moveFileToGroup('.zshrc', shell.id)

    const after = (await store.readWorkspaces()).placements.find((p) => p.targetPath === '.zshrc')!
    // Only the Group changed…
    expect(after.groupId).toBe(shell.id)
    // …access boundary is byte-for-byte the SAME (this is the ADR 0005 invariant)…
    expect(after.workspaceId).toBe(before.workspaceId)
    // …and the on-disk path is byte-for-byte the SAME (Groups never move files on disk).
    expect(after.targetPath).toBe(before.targetPath)

    // Moving back to the Workspace root is the inverse, still touching neither axis.
    await store.moveFileToGroup('.zshrc', null)
    const root = (await store.readWorkspaces()).placements.find((p) => p.targetPath === '.zshrc')!
    expect(root.groupId).toBeNull()
    expect(root.workspaceId).toBe(before.workspaceId)
    expect(root.targetPath).toBe(before.targetPath)
  })

  it('moveFileToGroup refuses a Group from a DIFFERENT Workspace (no cross-boundary filing)', async () => {
    const store = new MyenvStore(source)
    await store.seedDefault({ id: 'env-1', label: 'laptop', os: 'linux' })
    await store.placeFile('.zshrc') // in 'personal'
    const work = await store.createWorkspace('Work')
    const workGroup = await store.createGroup(work.id, 'WorkShell')

    await expect(store.moveFileToGroup('.zshrc', workGroup.id)).rejects.toThrow(/not a Group/)
    await expect(store.moveFileToGroup('.nope', null)).rejects.toThrow(/not placed/)
  })

  it('setFileWorkspace DOES change access and resets the Group (a Group belongs to one Workspace)', async () => {
    const store = new MyenvStore(source)
    await store.seedDefault({ id: 'env-1', label: 'laptop', os: 'linux' })
    await store.placeFile('.zshrc')
    const shell = await store.createGroup(DEFAULT_WORKSPACE_ID, 'Shell')
    await store.moveFileToGroup('.zshrc', shell.id)
    const work = await store.createWorkspace('Work')

    await store.setFileWorkspace('.zshrc', work.id)

    const placement = (await store.readWorkspaces()).placements.find(
      (p) => p.targetPath === '.zshrc',
    )!
    // The access boundary changed (this DOES affect which environments apply it)…
    expect(placement.workspaceId).toBe(work.id)
    // …and the Group reset, because the old Group lived in the old Workspace.
    expect(placement.groupId).toBeNull()
    // The on-disk path is STILL unchanged — only Workspace/Group are organization metadata.
    expect(placement.targetPath).toBe('.zshrc')
  })

  it('re-Tracking a File keeps it in its Group (organization is sticky within a Workspace)', async () => {
    const store = new MyenvStore(source)
    await store.seedDefault({ id: 'env-1', label: 'laptop', os: 'linux' })
    await store.placeFile('.zshrc')
    const shell = await store.createGroup(DEFAULT_WORKSPACE_ID, 'Shell')
    await store.moveFileToGroup('.zshrc', shell.id)

    // Re-Track (idempotent placeFile) must NOT shuffle the File out of its Group.
    await store.placeFile('.zshrc')

    const placement = (await store.readWorkspaces()).placements.find(
      (p) => p.targetPath === '.zshrc',
    )!
    expect(placement.groupId).toBe(shell.id)
  })
})
