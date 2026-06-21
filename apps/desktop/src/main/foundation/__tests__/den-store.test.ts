/**
 * DenStore unit tests — the synced `.dotden/` metadata seam (ADR 0024).
 *
 * Asserts the store seeds a default Workspace + this environment's registry entry,
 * records File placements idempotently, upserts environments by stable id, and keeps
 * `.dotden/` chezmoi-ignored. Uses a real tempdir (no mocking of fs) since the whole
 * point is the on-disk JSON a second environment will clone and read.
 */
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { DEFAULT_WORKSPACE_ID, DenStore } from '../den-store.js'
import { DEFAULT_COMMIT_MESSAGE_TEMPLATE } from '../../../shared/commit-template.js'
import { DEFAULT_APPEARANCE_SETTINGS } from '../../../shared/appearance-settings.js'

let source: string

beforeEach(async () => {
  source = await mkdtemp(join(tmpdir(), 'dotden-den-'))
})

afterEach(async () => {
  await rm(source, { recursive: true, force: true })
})

describe('DenStore', () => {
  it('seeds a default Workspace + this environment, and chezmoi-ignores .dotden/', async () => {
    const store = new DenStore(source)

    await store.seedDefault({ id: 'env-1', label: 'laptop', os: 'linux' })

    const workspaces = await store.readWorkspaces()
    expect(workspaces.workspaces).toEqual([
      { id: DEFAULT_WORKSPACE_ID, label: 'Personal', groups: [], scope: null },
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
    expect(ignore).toContain('.dotden/')
  })

  it('records File placements idempotently', async () => {
    const store = new DenStore(source)
    await store.seedDefault({ id: 'env-1', label: 'laptop', os: 'linux' })

    await store.placeFile('.zshrc')
    await store.placeFile('.zshrc') // re-Track should not duplicate
    await store.placeFile('.gitconfig')

    const { placements } = await store.readWorkspaces()
    expect(placements).toEqual([
      { targetPath: '.zshrc', workspaceId: DEFAULT_WORKSPACE_ID, groupId: null, scope: null },
      { targetPath: '.gitconfig', workspaceId: DEFAULT_WORKSPACE_ID, groupId: null, scope: null },
    ])
  })

  it('upserts environments by stable id without duplicating', async () => {
    const store = new DenStore(source)
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

  it('does not duplicate the .dotden/ ignore rule across seeds', async () => {
    const store = new DenStore(source)
    await store.seedDefault({ id: 'env-1', label: 'laptop', os: 'linux' })
    await store.seedDefault({ id: 'env-1', label: 'laptop', os: 'linux' })

    const ignore = await readFile(join(source, '.chezmoiignore'), 'utf8')
    const occurrences = ignore.split(/\r?\n/).filter((line) => line === '.dotden/').length
    expect(occurrences).toBe(1)
  })

  it('forward-loads a legacy workspaces.json (no groups / no groupId / no scope) into the canonical shape', async () => {
    // A `.dotden/` written by a dotden from before the 1-14 Group / 1-15 Scope slices has
    // neither `groups`/`scope` on the Workspace nor `groupId`/`scope` on placements.
    // readWorkspaces must still load it cleanly, defaulting all of them — the synced
    // metadata is forward-compatible, and a missing Scope is the universal Scope (`null`,
    // "applies everywhere") so an old File is never silently scoped out (issue 1-15).
    const store = new DenStore(source)
    await store.seedDefault({ id: 'env-1', label: 'laptop', os: 'linux' })
    const legacy = JSON.stringify({
      workspaces: [{ id: DEFAULT_WORKSPACE_ID, label: 'Personal' }],
      placements: [{ targetPath: '.zshrc', workspaceId: DEFAULT_WORKSPACE_ID }],
    })
    await writeFile(join(source, '.dotden', 'workspaces.json'), legacy, 'utf8')

    const doc = await store.readWorkspaces()
    expect(doc.workspaces).toEqual([
      { id: DEFAULT_WORKSPACE_ID, label: 'Personal', groups: [], scope: null },
    ])
    expect(doc.placements).toEqual([
      { targetPath: '.zshrc', workspaceId: DEFAULT_WORKSPACE_ID, groupId: null, scope: null },
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
describe('DenStore — Workspaces + nested Groups (1-14)', () => {
  it('createWorkspace adds a second, separate Workspace with a stable id and no Groups', async () => {
    const store = new DenStore(source)
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
    const store = new DenStore(source)
    await store.seedDefault({ id: 'env-1', label: 'laptop', os: 'linux' })

    const shell = await store.createGroup(DEFAULT_WORKSPACE_ID, 'Shell')
    expect(shell.parentId).toBeNull()
    const zsh = await store.createGroup(DEFAULT_WORKSPACE_ID, 'zsh', shell.id)
    expect(zsh.parentId).toBe(shell.id)

    const ws = (await store.readWorkspaces()).workspaces.find((w) => w.id === DEFAULT_WORKSPACE_ID)
    expect(ws?.groups.map((g) => g.label)).toEqual(['Shell', 'zsh'])
  })

  it('createGroup refuses a Workspace that does not exist, and a cross-Workspace parent', async () => {
    const store = new DenStore(source)
    await store.seedDefault({ id: 'env-1', label: 'laptop', os: 'linux' })
    const work = await store.createWorkspace('Work')
    const personalGroup = await store.createGroup(DEFAULT_WORKSPACE_ID, 'Shell')

    await expect(store.createGroup('no-such-ws', 'X')).rejects.toThrow(/does not exist/)
    // A Group in 'Work' may not nest under a Group that belongs to 'Personal' — Groups
    // never span Workspaces (a Group belongs to exactly one access boundary).
    await expect(store.createGroup(work.id, 'X', personalGroup.id)).rejects.toThrow(/not a Group/)
  })

  it('moveFileToGroup is organization-ONLY: access (workspaceId) and path (targetPath) are unchanged', async () => {
    const store = new DenStore(source)
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
    const store = new DenStore(source)
    await store.seedDefault({ id: 'env-1', label: 'laptop', os: 'linux' })
    await store.placeFile('.zshrc') // in 'personal'
    const work = await store.createWorkspace('Work')
    const workGroup = await store.createGroup(work.id, 'WorkShell')

    await expect(store.moveFileToGroup('.zshrc', workGroup.id)).rejects.toThrow(/not a Group/)
    await expect(store.moveFileToGroup('.nope', null)).rejects.toThrow(/not placed/)
  })

  it('setFileWorkspace DOES change access and resets the Group (a Group belongs to one Workspace)', async () => {
    const store = new DenStore(source)
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
    const store = new DenStore(source)
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

/**
 * OS Scope + inheritance (issue 1-15, CONTEXT.md "Scope").
 *
 * Scope is the OS-applicability axis stored in the synced `.dotden/` (intent) and realized
 * as native `.chezmoiignore` by the adapter. These cover the store half: a File can declare
 * an own Scope, a Folder (Group) Scope is inherited by its Files, and the load-bearing
 * invariant — a child narrows but NEVER broadens past its parent's Scope (clamped by the
 * store, not just the pure math).
 */
describe('DenStore — OS Scope + inheritance (1-15)', () => {
  it('a freshly placed File is universally scoped (null = applies everywhere)', async () => {
    const store = new DenStore(source)
    await store.seedDefault({ id: 'env-1', label: 'laptop', os: 'linux' })
    await store.placeFile('.zshrc')

    const doc = await store.readWorkspaces()
    // dotden never silently scopes a freshly Tracked File out.
    expect(doc.placements[0]?.scope).toBeNull()
    expect(store.effectiveScopeOf(doc, '.zshrc')).toBeNull()
  })

  it('setFileScope narrows a File to specific OSes', async () => {
    const store = new DenStore(source)
    await store.seedDefault({ id: 'env-1', label: 'laptop', os: 'linux' })
    await store.placeFile('.config/powershell/profile.ps1')

    const effective = await store.setFileScope('.config/powershell/profile.ps1', ['win32'])
    expect(effective).toEqual(['win32'])

    const doc = await store.readWorkspaces()
    expect(store.effectiveScopeOf(doc, '.config/powershell/profile.ps1')).toEqual(['win32'])
  })

  it("a File inherits its Group's (Folder's) Scope", async () => {
    const store = new DenStore(source)
    await store.seedDefault({ id: 'env-1', label: 'laptop', os: 'linux' })
    await store.placeFile('.zshrc')
    const macOnly = await store.createGroup(DEFAULT_WORKSPACE_ID, 'macOS')
    await store.moveFileToGroup('.zshrc', macOnly.id)
    await store.setGroupScope(DEFAULT_WORKSPACE_ID, macOnly.id, ['darwin'])

    // The File declares no own Scope, so its effective Scope is its Group's: mac-only.
    const doc = await store.readWorkspaces()
    expect(store.effectiveScopeOf(doc, '.zshrc')).toEqual(['darwin'])
  })

  it('a File can NARROW within its Group but can NEVER broaden past it (clamped by the store)', async () => {
    const store = new DenStore(source)
    await store.seedDefault({ id: 'env-1', label: 'laptop', os: 'linux' })
    await store.placeFile('.zshrc')
    const desktop = await store.createGroup(DEFAULT_WORKSPACE_ID, 'Desktop')
    await store.moveFileToGroup('.zshrc', desktop.id)
    // Folder applies on mac + linux.
    await store.setGroupScope(DEFAULT_WORKSPACE_ID, desktop.id, ['darwin', 'linux'])

    // Narrow the File to linux only (within the Folder) → linux.
    expect(await store.setFileScope('.zshrc', ['linux'])).toEqual(['linux'])

    // Try to BROADEN the File to include win32 (NOT in the Folder) → win32 is clamped away;
    // the File can only end up with OSes the Folder already allows (the invariant).
    const broadened = await store.setFileScope('.zshrc', ['linux', 'win32'])
    expect(broadened).toEqual(['linux'])
    expect(broadened).not.toContain('win32')
  })

  it('narrowing a Group narrows every File under it (Folder Scope inherited by children)', async () => {
    const store = new DenStore(source)
    await store.seedDefault({ id: 'env-1', label: 'laptop', os: 'linux' })
    await store.placeFile('.a')
    await store.placeFile('.b')
    const grp = await store.createGroup(DEFAULT_WORKSPACE_ID, 'Folder')
    await store.moveFileToGroup('.a', grp.id)
    await store.moveFileToGroup('.b', grp.id)

    // Narrow the Folder to mac-only AFTER the Files are in it.
    await store.setGroupScope(DEFAULT_WORKSPACE_ID, grp.id, ['darwin'])

    const doc = await store.readWorkspaces()
    // Both Files (declaring no own Scope) now inherit the Folder's mac-only Scope.
    expect(store.effectiveScopeOf(doc, '.a')).toEqual(['darwin'])
    expect(store.effectiveScopeOf(doc, '.b')).toEqual(['darwin'])
  })

  it('a Group cannot broaden past its parent Group (deep inheritance is clamped)', async () => {
    const store = new DenStore(source)
    await store.seedDefault({ id: 'env-1', label: 'laptop', os: 'linux' })
    const outer = await store.createGroup(DEFAULT_WORKSPACE_ID, 'Outer')
    await store.setGroupScope(DEFAULT_WORKSPACE_ID, outer.id, ['darwin'])
    const inner = await store.createGroup(DEFAULT_WORKSPACE_ID, 'Inner', outer.id)

    // The inner Group "requests" mac + linux, but its parent is mac-only → linux is clamped.
    const effective = await store.setGroupScope(DEFAULT_WORKSPACE_ID, inner.id, ['darwin', 'linux'])
    expect(effective).toEqual(['darwin'])
  })

  it('setFileScope refuses an unplaced File (never fail silently)', async () => {
    const store = new DenStore(source)
    await store.seedDefault({ id: 'env-1', label: 'laptop', os: 'linux' })
    await expect(store.setFileScope('.nope', ['linux'])).rejects.toThrow(/not placed/)
  })

  // ── Per-environment Workspace subscription (issue 1-13) ──

  it('setSubscriptions creates this env entry if absent (the registry-entry ordering guard)', async () => {
    const store = new DenStore(source)
    await store.seedDefault({ id: 'env-a', label: 'this-mac', os: 'darwin' })
    const work = await store.createWorkspace('Work')

    // A second environment (no entry yet) subscribes to a subset — the entry is CREATED.
    const entry = await store.setSubscriptions({ id: 'env-b', label: 'work-laptop', os: 'linux' }, [
      work.id,
    ])
    expect(entry).toEqual({
      id: 'env-b',
      label: 'work-laptop',
      os: 'linux',
      subscribedWorkspaces: [work.id],
    })
    const reg = await store.readEnvironments()
    expect(reg.environments.find((e) => e.id === 'env-b')?.subscribedWorkspaces).toEqual([work.id])
  })

  it('setSubscriptions dedupes + drops non-existent Workspaces (no stale ids linger)', async () => {
    const store = new DenStore(source)
    await store.seedDefault({ id: 'env-a', label: 'mac', os: 'darwin' })
    const entry = await store.setSubscriptions(
      { id: 'env-a', label: 'mac', os: 'darwin' },
      // Duplicate default id + a Workspace that does not exist.
      [DEFAULT_WORKSPACE_ID, DEFAULT_WORKSPACE_ID, 'ws-ghost'],
    )
    expect(entry.subscribedWorkspaces).toEqual([DEFAULT_WORKSPACE_ID])
  })

  it('setSubscriptions preserves a user-edited label when the entry already exists', async () => {
    const store = new DenStore(source)
    await store.seedDefault({ id: 'env-a', label: 'mac', os: 'darwin' })
    // Rename, then change subscription using the ORIGINAL default label — the rename survives.
    await store.registerEnvironment({
      id: 'env-a',
      label: 'renamed-mac',
      os: 'darwin',
      subscribedWorkspaces: [DEFAULT_WORKSPACE_ID],
    })
    const entry = await store.setSubscriptions({ id: 'env-a', label: 'mac', os: 'darwin' }, [
      DEFAULT_WORKSPACE_ID,
    ])
    expect(entry.label).toBe('renamed-mac')
  })

  // ── Secret-scan "don't warn" allowlist (issue 2-04) ──
  // The allowlist is user-authored organization-of-trust, so it SYNCS through `.dotden/`
  // (ADR 0024). These tests pin the write/read seam the acceptance criteria name: the
  // decision lands in `.dotden/secret-allowlist.json`, scoped per File+match, never raw.

  it('reads an empty allowlist before any finding is dismissed', async () => {
    const store = new DenStore(source)
    await store.seedDefault({ id: 'env-a', label: 'mac', os: 'darwin' })
    expect(await store.readSecretAllowlist()).toEqual({ entries: [] })
  })

  it('persists a dismissed finding to .dotden/secret-allowlist.json (synced), scoped per File+match', async () => {
    const store = new DenStore(source)
    await store.seedDefault({ id: 'env-a', label: 'mac', os: 'darwin' })

    const list = await store.addSecretAllowlistEntry({
      file: '.aws/credentials',
      kind: 'AWS Access Key ID',
      line: 2,
      maskedValue: 'AKIA••••••••N7QX',
    })

    // The returned + persisted entry carries the human-auditable fields + a derived fingerprint,
    // and NEVER the raw secret (only the masked preview is stored, so nothing leaks into sync).
    expect(list.entries).toHaveLength(1)
    expect(list.entries[0]).toMatchObject({
      file: '.aws/credentials',
      kind: 'AWS Access Key ID',
      maskedValue: 'AKIA••••••••N7QX',
    })
    expect(list.entries[0]?.fingerprint).toBeTruthy()

    // It landed in the SYNCED .dotden/ directory — the file a second environment clones + reads.
    const raw = await readFile(join(source, '.dotden', 'secret-allowlist.json'), 'utf8')
    expect(JSON.parse(raw).entries).toHaveLength(1)
    // And it is re-read identically through the store (round-trip).
    expect(await store.readSecretAllowlist()).toEqual(list)
  })

  it('de-duplicates a re-dismissed finding (idempotent write, no git churn)', async () => {
    const store = new DenStore(source)
    await store.seedDefault({ id: 'env-a', label: 'mac', os: 'darwin' })
    const finding = {
      file: '.aws/credentials',
      kind: 'AWS Access Key ID' as const,
      line: 2,
      maskedValue: 'AKIA••••••••N7QX',
    }
    await store.addSecretAllowlistEntry(finding)
    const list = await store.addSecretAllowlistEntry(finding)
    expect(list.entries).toHaveLength(1)
  })
})

describe('DenStore — commit-message template (2-09)', () => {
  it('returns the built-in default before anything is written', async () => {
    const store = new DenStore(source)
    expect(await store.readCommitTemplate()).toBe(DEFAULT_COMMIT_MESSAGE_TEMPLATE)
  })

  it('round-trips a written template through the synced .dotden/ file', async () => {
    const store = new DenStore(source)
    await store.writeCommitTemplate('$environment · $date')
    expect(await store.readCommitTemplate()).toBe('$environment · $date')
    // It lives in the chezmoi-ignored synced metadata dir (so it travels with the Den).
    const raw = await readFile(join(source, '.dotden', 'commit-template.json'), 'utf8')
    expect(JSON.parse(raw)).toEqual({ template: '$environment · $date' })
  })

  it('falls back to the default for an empty or malformed file (never a blank message)', async () => {
    const store = new DenStore(source)
    // An empty string is meaningless as a commit message → default.
    await store.writeCommitTemplate('')
    expect(await store.readCommitTemplate()).toBe(DEFAULT_COMMIT_MESSAGE_TEMPLATE)
  })
})

describe('DenStore — appearance + Apply/notification preferences (2-10)', () => {
  it('returns the safe defaults before anything is written', async () => {
    const store = new DenStore(source)
    expect(await store.readAppearanceSettings()).toEqual(DEFAULT_APPEARANCE_SETTINGS)
  })

  it('round-trips written settings through the synced .dotden/ file', async () => {
    const store = new DenStore(source)
    const next = {
      theme: 'blue' as const,
      defaultApply: 'apply-all' as const,
      notifyOn: { incoming: false, conflict: true, applied: true },
    }
    await store.writeAppearanceSettings(next)
    expect(await store.readAppearanceSettings()).toEqual(next)
    // It lives in the chezmoi-ignored synced metadata dir (so it travels with the Den).
    const raw = await readFile(join(source, '.dotden', 'appearance-settings.json'), 'utf8')
    expect(JSON.parse(raw)).toEqual(next)
  })

  it('normalizes a partial/forward-incompatible file to coherent settings on read', async () => {
    const store = new DenStore(source)
    // Create `.dotden/` first (via the store), then overwrite the file with a partial /
    // older-or-newer-schema payload: only some fields, and a bad theme.
    await store.writeAppearanceSettings(DEFAULT_APPEARANCE_SETTINGS)
    await writeFile(
      join(source, '.dotden', 'appearance-settings.json'),
      JSON.stringify({ theme: 'rainbow', notifyOn: { applied: true } }),
      'utf8',
    )
    expect(await store.readAppearanceSettings()).toEqual({
      theme: 'ember', // bad theme → default
      defaultApply: 'review', // absent → default
      notifyOn: { incoming: true, conflict: true, applied: true }, // merged with defaults
    })
  })

  it('ensures .dotden/ is chezmoi-ignored when it writes (so the file never applies to home)', async () => {
    const store = new DenStore(source)
    await store.writeAppearanceSettings(DEFAULT_APPEARANCE_SETTINGS)
    const ignore = await readFile(join(source, '.chezmoiignore'), 'utf8')
    expect(ignore).toContain('.dotden/')
  })
})

/**
 * Environment-registry lifecycle at the registry-write seam (issue 2-15, ADR 0024):
 * retire/remove drops an entry, and reassign/merge folds a duplicate into the keeper
 * (unioning subscriptions) — the pure registry mutations the EnvironmentRegistry guards
 * sit on top of. "Who/when" is git-log-derived, so these never read or write attribution.
 */
describe('DenStore — environment lifecycle (2-15)', () => {
  /** Seed a registry with three environments for the lifecycle tests. */
  async function seedThree(store: DenStore): Promise<void> {
    await store.seedDefault({ id: 'env-a', label: 'a', os: 'linux' })
    await store.createWorkspace('Work') // a 2nd Workspace so the union has something to union
    await store.registerEnvironment({
      id: 'env-b',
      label: 'b',
      os: 'darwin',
      subscribedWorkspaces: [DEFAULT_WORKSPACE_ID],
    })
    await store.registerEnvironment({
      id: 'env-dup',
      label: 'b-duplicate',
      os: 'darwin',
      // The duplicate subscribed to a Workspace the keeper had not — the union must inherit it.
      subscribedWorkspaces: ['ws-extra'],
    })
  }

  it('removeEnvironment drops exactly the named entry, leaving the rest intact', async () => {
    const store = new DenStore(source)
    await seedThree(store)

    const remaining = await store.removeEnvironment('env-b')
    expect(remaining.map((e) => e.id).sort()).toEqual(['env-a', 'env-dup'])

    const { environments } = await store.readEnvironments()
    expect(environments.map((e) => e.id).sort()).toEqual(['env-a', 'env-dup'])
  })

  it('removeEnvironment is an idempotent no-op for an absent id', async () => {
    const store = new DenStore(source)
    await seedThree(store)
    const before = (await store.readEnvironments()).environments
    const remaining = await store.removeEnvironment('env-does-not-exist')
    expect(remaining.map((e) => e.id).sort()).toEqual(before.map((e) => e.id).sort())
  })

  it('reassignEnvironment folds the duplicate into the keeper, UNIONing subscriptions', async () => {
    const store = new DenStore(source)
    await seedThree(store)
    // Give the keeper a real Workspace subscription so the union is observable.
    const work = (await store.readWorkspaces()).workspaces.find((w) => w.label === 'Work')
    await store.setSubscriptions({ id: 'env-b', label: 'b', os: 'darwin' }, [
      DEFAULT_WORKSPACE_ID,
      work!.id,
    ])

    const kept = await store.reassignEnvironment('env-dup', 'env-b')

    // Keeper id/label/os preserved; subscriptions = union of both (no narrowing).
    expect(kept.id).toBe('env-b')
    expect(kept.label).toBe('b')
    expect([...kept.subscribedWorkspaces].sort()).toEqual(
      [DEFAULT_WORKSPACE_ID, work!.id, 'ws-extra'].sort(),
    )

    // The duplicate is gone; the keeper remains.
    const { environments } = await store.readEnvironments()
    expect(environments.map((e) => e.id).sort()).toEqual(['env-a', 'env-b'])
  })

  it('reassignEnvironment rejects a missing from/into id and a self-merge', async () => {
    const store = new DenStore(source)
    await seedThree(store)
    await expect(store.reassignEnvironment('env-missing', 'env-b')).rejects.toThrow()
    await expect(store.reassignEnvironment('env-dup', 'env-missing')).rejects.toThrow()
    await expect(store.reassignEnvironment('env-b', 'env-b')).rejects.toThrow()
  })

  it('never writes attribution fields into the registry (git-log-derived only, ADR 0024)', async () => {
    const store = new DenStore(source)
    await seedThree(store)
    await store.reassignEnvironment('env-dup', 'env-b')
    await store.removeEnvironment('env-a')
    const fileText = await readFile(join(source, '.dotden', 'environments.json'), 'utf8')
    expect(fileText).not.toMatch(/lastAuthor|lastActivity|commitCount|lastSubject/)
    // Each surviving entry still holds exactly the four registry keys.
    const { environments } = await store.readEnvironments()
    for (const entry of environments) {
      expect(Object.keys(entry).sort()).toEqual(['id', 'label', 'os', 'subscribedWorkspaces'])
    }
  })
})
