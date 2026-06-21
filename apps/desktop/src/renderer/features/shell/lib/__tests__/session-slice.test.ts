/**
 * `session` slice tests — the den-session store's spine (ADR 0027, Phase 2).
 *
 * These exercise the store's EXTERNAL behavior through the public factory seam: build a store with
 * a fake injected API, dispatch an action, assert the observable state — never how the slice is
 * wired. This is where the old `Workspace.tsx`'s tangled `useState` becomes pure functions, so the
 * tests run in vitest's default node environment with no React and no DOM (like the foundation +
 * `remote-axis`/`pm-picker` prior-art tests).
 */
import { describe, expect, it, vi } from 'vitest'
import { createDenSessionStore, type Role } from '../den-session-store'
import type { DotdenApi } from '@shared/ipc-api'

/** A managed File tree entry — only the fields the session actions read are load-bearing. */
function entry(targetPath: string, over: Partial<Record<string, unknown>> = {}) {
  return {
    targetPath,
    status: 'M',
    muted: false,
    scope: null,
    workspaceId: 'w1',
    groupId: null,
    ...over,
  }
}

/**
 * A fake `window.dotden` exposing only the methods the exercised actions call, cast to the full
 * contract. Overrides let a test inject specific return values / spies.
 */
function makeApi(over: Record<string, unknown> = {}): DotdenApi {
  return {
    den: {
      diff: vi.fn(async (path: string) => `diff for ${path}`),
      tree: vi.fn(async () => ({ files: [entry('.zshrc')], workspaces: [] })),
      pushPending: vi.fn(async () => false),
      incomingSummary: vi.fn(async () => ({ items: [], fromEnvironmentLabel: 'laptop' })),
      track: vi.fn(async () => undefined),
      untrack: vi.fn(async () => undefined),
      deleteEverywhere: vi.fn(async () => undefined),
      affectedEnvironments: vi.fn(async () => [{ id: 'e1', label: 'desktop', isSelf: true }]),
      apply: vi.fn(async () => ({ results: [] })),
      createWorkspace: vi.fn(async () => ({ id: 'w2', label: 'Work', groups: [] })),
      ...(over.den ?? {}),
    },
    automation: {
      getLevel: vi.fn(async () => 'auto-sync'),
      ...(over.automation ?? {}),
    },
  } as unknown as DotdenApi
}

function freshStore(role: Role = 'a', api: DotdenApi = makeApi()) {
  return createDenSessionStore(role, api)
}

describe('session slice — the reset guarantee (key={role} remount proven at the store seam)', () => {
  it('a freshly-created store starts on a clean, empty session', () => {
    const s = freshStore().getState()
    expect(s.files).toEqual([])
    expect(s.workspaces).toEqual([])
    expect(s.selected).toBeNull()
    expect(s.diff).toBeNull()
    expect(s.centerTab).toBe('changes')
    expect(s.busy).toBeNull()
    expect(s.error).toBeNull()
    expect(s.confirm).toBeNull()
    // apply-slice session state is part of the same fresh store.
    expect(s.incoming).toEqual([])
    expect(s.remoteAxis.size).toBe(0)
    expect(s.reviewing).toBe(false)
    expect(s.resolving).toBe(false)
  })

  it("a second store does NOT inherit the first store's state (no A/B leak)", async () => {
    const a = freshStore('a')
    await a.getState().selectFile('.zshrc')
    a.getState().setConfirm({ verb: 'untrack', path: '.zshrc', affected: [] })
    expect(a.getState().selected).toBe('.zshrc')

    // A brand-new store (the role remount) is pristine, regardless of what `a` did.
    const b = freshStore('b')
    expect(b.getState().selected).toBeNull()
    expect(b.getState().confirm).toBeNull()
  })
})

describe('session slice — run()', () => {
  it('toggles busy to the kind during the action, then clears it', async () => {
    const store = freshStore()
    let busyDuring: unknown = 'unset'
    await store.getState().run('commit', async () => {
      busyDuring = store.getState().busy
    })
    expect(busyDuring).toBe('commit')
    expect(store.getState().busy).toBeNull()
  })

  it('surfaces a thrown error into the error channel and still clears busy', async () => {
    const store = freshStore()
    await store.getState().run('track', async () => {
      throw new Error('boom')
    })
    expect(store.getState().error).toBe('boom')
    expect(store.getState().busy).toBeNull()
  })

  it('clears any prior error when a new action starts', async () => {
    const store = freshStore()
    await store.getState().run('track', async () => {
      throw new Error('first')
    })
    expect(store.getState().error).toBe('first')
    await store.getState().run('load', async () => {})
    expect(store.getState().error).toBeNull()
  })
})

describe('session slice — selectFile', () => {
  it('selects a File and fetches its diff on env A', async () => {
    const api = makeApi()
    const store = createDenSessionStore('a', api)
    await store.getState().selectFile('.zshrc')
    expect(store.getState().selected).toBe('.zshrc')
    expect(store.getState().diff).toBe('diff for .zshrc')
    expect(api.den.diff).toHaveBeenCalledWith('.zshrc')
  })

  it('does not fetch a diff on env B (incoming rows are clean)', async () => {
    const api = makeApi()
    const store = createDenSessionStore('b', api)
    await store.getState().selectFile('.zshrc')
    expect(store.getState().selected).toBe('.zshrc')
    expect(store.getState().diff).toBeNull()
    expect(api.den.diff).not.toHaveBeenCalled()
  })

  it('clearing the selection snaps the center tab back to Changes', async () => {
    const store = freshStore('a')
    store.getState().setCenterTab('history')
    await store.getState().selectFile(null)
    expect(store.getState().selected).toBeNull()
    expect(store.getState().diff).toBeNull()
    expect(store.getState().centerTab).toBe('changes')
  })
})

describe('session slice — init() (env A boot load)', () => {
  it('populates automation level, tree, and incoming on env A', async () => {
    const api = makeApi({
      den: {
        tree: vi.fn(async () => ({ files: [entry('.zshrc'), entry('.vimrc')], workspaces: [] })),
        pushPending: vi.fn(async () => true),
        incomingSummary: vi.fn(async () => ({
          items: [{ targetPath: '.zshrc', marker: 'incoming' }],
          fromEnvironmentLabel: 'work-laptop',
        })),
        diff: vi.fn(async () => ''),
      },
    })
    const store = createDenSessionStore('a', api)
    await store.getState().init()
    const s = store.getState()
    expect(s.automationLevel).toBe('auto-sync')
    expect(s.files).toHaveLength(2)
    expect(s.pushQueued).toBe(true)
    expect(s.remoteAxis.get('.zshrc')).toBe('incoming')
    expect(s.incomingFrom).toBe('work-laptop')
  })

  it('is a no-op on env B (B drives its own explicit Detect)', async () => {
    const api = makeApi()
    const store = createDenSessionStore('b', api)
    await store.getState().init()
    expect(api.den.tree).not.toHaveBeenCalled()
    expect(store.getState().files).toEqual([])
  })

  it('surfaces a single read error if any boot read fails', async () => {
    const api = makeApi({
      den: {
        tree: vi.fn(async () => {
          throw new Error('no chezmoi')
        }),
      },
    })
    const store = createDenSessionStore('a', api)
    await store.getState().init()
    expect(store.getState().error).toBe('no chezmoi')
  })
})

describe('session slice — row verbs', () => {
  it('Untrack opens a default-tone confirm without touching disk', () => {
    const api = makeApi()
    const store = createDenSessionStore('a', api)
    store.getState().onRowVerb('.zshrc', 'untrack')
    expect(store.getState().confirm).toEqual({ verb: 'untrack', path: '.zshrc', affected: [] })
    expect(api.den.untrack).not.toHaveBeenCalled()
  })

  it('Delete everywhere loads the blast radius BEFORE opening the destructive confirm', async () => {
    const api = makeApi()
    const store = createDenSessionStore('a', api)
    store.getState().onRowVerb('.zshrc', 'delete-everywhere')
    // affectedEnvironments resolves async inside run(); flush microtasks.
    await vi.waitFor(() => expect(store.getState().confirm?.verb).toBe('delete-everywhere'))
    expect(api.den.affectedEnvironments).toHaveBeenCalledWith('.zshrc')
    expect(store.getState().confirm?.affected).toHaveLength(1)
  })

  it('a confirmed Untrack forgets the File and reloads the tree', async () => {
    const api = makeApi()
    const store = createDenSessionStore('a', api)
    store.getState().setConfirm({ verb: 'untrack', path: '.zshrc', affected: [] })
    store.getState().runConfirmedVerb()
    await vi.waitFor(() => expect(api.den.untrack).toHaveBeenCalledWith('.zshrc'))
    expect(api.den.tree).toHaveBeenCalled()
  })
})
