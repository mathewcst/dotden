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
import { createDenSessionStore, type Role } from '../../store'
import type { DotdenApi } from '@shared/ipc-api'
import type { FileTreeEntry } from '@shared/den'

/** A managed File tree entry — only the fields the session actions read are load-bearing. */
function entry(targetPath: string, over: Partial<FileTreeEntry> = {}): FileTreeEntry {
  return {
    targetPath,
    status: 'modified',
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
      subscriptionState: vi.fn(async () => ({
        workspaces: [],
        registered: true,
        emptyDenWarning: null,
      })),
      track: vi.fn(async () => undefined),
      untrack: vi.fn(async () => undefined),
      discardLocalChange: vi.fn(async () => undefined),
      deleteEverywhere: vi.fn(async () => undefined),
      affectedEnvironments: vi.fn(async () => [{ id: 'e1', label: 'desktop', isSelf: true }]),
      apply: vi.fn(async () => ({ results: [] })),
      createWorkspace: vi.fn(async () => ({ id: 'w2', label: 'Work', groups: [] })),
      createGroup: vi.fn(async () => ({ id: 'g1', label: 'Shell', parentId: null, scope: null })),
      renameWorkspace: vi.fn(async () => undefined),
      renameGroup: vi.fn(async () => undefined),
      setGroupParent: vi.fn(async () => undefined),
      deleteWorkspace: vi.fn(async () => undefined),
      deleteGroup: vi.fn(async () => undefined),
      moveFileToGroup: vi.fn(async () => undefined),
      setFileWorkspace: vi.fn(async () => undefined),
      setFileScope: vi.fn(async () => null),
      setGroupScope: vi.fn(async () => null),
      ...(over.den ?? {}),
    },
    diagnostics: {
      recordsFor: vi.fn(async () => []),
      openLogLocation: vi.fn(async () => undefined),
      copyDiagnostics: vi.fn(async () => ({ recordCount: 0 })),
      getSettings: vi.fn(async () => ({ consoleEnabled: false })),
      setSettings: vi.fn(async (settings) => settings),
      ...(over.diagnostics ?? {}),
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
    expect(s.selectedGroup).toBeNull()
    expect(s.selectedWorkspace).toBeNull()
    expect(s.diff).toBeNull()
    expect(s.centerTab).toBe('changes')
    expect(s.busy).toBeNull()
    expect(s.error).toBeNull()
    expect(s.confirm).toBeNull()
    expect(s.diagnosticsPanelOpen).toBe(false)
    expect(s.diagnosticsPanelMode).toBe('console')
    expect(s.diagnosticsPanelTraceId).toBeNull()
    expect(s.diagnosticsRecords).toEqual([])
    expect(s.diagnosticsClearedAt).toBeNull()
    expect(s.emptyDenWarning).toBeNull()
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
    const error = Object.assign(new Error('boom'), { traceId: 'trace-failed' })
    let attempts = 0
    await store.getState().run('track', async () => {
      attempts += 1
      throw error
    })
    expect(store.getState().error?.message).toBe('boom')
    expect(store.getState().error?.traceId).toBe('trace-failed')
    expect(store.getState().busy).toBeNull()

    await store.getState().error?.retry?.()
    expect(attempts).toBe(2)
  })

  it('clears any prior error when a new action starts', async () => {
    const store = freshStore()
    await store.getState().run('track', async () => {
      throw new Error('first')
    })
    expect(store.getState().error?.message).toBe('first')
    await store.getState().run('load', async () => {})
    expect(store.getState().error).toBeNull()
  })
})

describe('session slice — Diagnostics panel', () => {
  it('opens the bottom panel with already-redacted records from IPC', async () => {
    const records = [
      {
        command: 'git',
        args: ['push', 'https://user:[REDACTED]@github.com/dotden/den.git'],
        exitCode: 128,
        redactedStdout: '',
        redactedStderr: 'remote: token [REDACTED]',
        traceId: 'trace-a',
        timestamp: 1,
      },
    ]
    const api = makeApi({
      diagnostics: {
        recordsFor: vi.fn(async () => records),
      },
    })
    const store = createDenSessionStore('a', api)

    await store.getState().openDiagnosticsPanel('trace-a')

    expect(api.diagnostics.recordsFor).toHaveBeenCalledWith('trace-a')
    expect(store.getState().diagnosticsPanelOpen).toBe(true)
    expect(store.getState().diagnosticsPanelMode).toBe('details')
    expect(store.getState().diagnosticsPanelTraceId).toBe('trace-a')
    expect(store.getState().diagnosticsRecords).toEqual(records)
    expect(store.getState().diagnosticsErrorCount).toBe(0)
  })

  it('opens the standing console mode when no trace filter is provided', async () => {
    const records = [
      {
        command: 'git',
        args: ['push'],
        exitCode: 128,
        redactedStdout: '',
        redactedStderr: 'failed',
        timestamp: 1,
      },
    ]
    const api = makeApi({
      diagnostics: {
        recordsFor: vi.fn(async () => records),
      },
    })
    const store = createDenSessionStore('a', api)

    await store.getState().openDiagnosticsPanel()

    expect(store.getState().diagnosticsPanelMode).toBe('console')
    expect(store.getState().diagnosticsPanelTraceId).toBeNull()
    expect(store.getState().diagnosticsErrorCount).toBe(1)
  })

  it('loads the persisted Console setting and opens the standing Console when enabled', async () => {
    const api = makeApi({
      diagnostics: {
        getSettings: vi.fn(async () => ({ consoleEnabled: true })),
        recordsFor: vi.fn(async () => []),
      },
    })
    const store = createDenSessionStore('a', api)

    await store.getState().loadDiagnosticsConsoleSetting()

    expect(store.getState().diagnosticsConsoleEnabled).toBe(true)
    expect(store.getState().diagnosticsPanelOpen).toBe(true)
    expect(store.getState().diagnosticsPanelMode).toBe('console')
  })

  it('re-clicking the Diagnostics badge collapses the panel', async () => {
    const store = freshStore('a')
    await store.getState().toggleDiagnosticsPanel()
    expect(store.getState().diagnosticsPanelOpen).toBe(true)

    await store.getState().toggleDiagnosticsPanel()
    expect(store.getState().diagnosticsPanelOpen).toBe(false)
  })

  it('clearing the panel view does not clear the persisted-log error badge count', async () => {
    const api = makeApi({
      diagnostics: {
        recordsFor: vi.fn(async () => [
          {
            command: 'git',
            args: ['push'],
            exitCode: 128,
            redactedStdout: '',
            redactedStderr: 'failed',
            timestamp: 1,
          },
        ]),
      },
    })
    const store = createDenSessionStore('a', api)

    await store.getState().openDiagnosticsPanel()
    store.getState().clearDiagnosticsView()

    expect(store.getState().diagnosticsRecords).toEqual([])
    expect(store.getState().diagnosticsErrorCount).toBe(1)
  })

  it('keeps Console clear as a view cutoff while preserving the persisted badge count', async () => {
    let now = 10
    const dateNow = vi.spyOn(Date, 'now').mockImplementation(() => now)
    const api = makeApi({
      diagnostics: {
        recordsFor: vi
          .fn()
          .mockResolvedValueOnce([
            {
              command: 'git',
              args: ['status'],
              exitCode: 0,
              redactedStdout: '',
              redactedStderr: '',
              timestamp: 5,
            },
          ])
          .mockResolvedValueOnce([
            {
              command: 'git',
              args: ['status'],
              exitCode: 0,
              redactedStdout: '',
              redactedStderr: '',
              timestamp: 5,
            },
            {
              command: 'git',
              args: ['push'],
              exitCode: 128,
              redactedStdout: '',
              redactedStderr: 'failed',
              timestamp: 11,
            },
          ]),
      },
    })
    const store = createDenSessionStore('a', api)

    await store.getState().openDiagnosticsPanel()
    now = 10
    store.getState().clearDiagnosticsView()
    await store.getState().refreshDiagnosticsConsole()
    expect(store.getState().diagnosticsRecords.map((record) => record.timestamp)).toEqual([])

    store.setState({ diagnosticsConsoleEnabled: true })
    await store.getState().refreshDiagnosticsConsole()
    expect(store.getState().diagnosticsRecords.map((record) => record.timestamp)).toEqual([11])
    expect(store.getState().diagnosticsErrorCount).toBe(1)
    dateNow.mockRestore()
  })
})

describe('session slice — selectFile', () => {
  it('selects a File and fetches its diff on env A', async () => {
    const api = makeApi()
    const store = createDenSessionStore('a', api)
    await store.getState().selectFile('.zshrc')
    expect(store.getState().selected).toBe('.zshrc')
    expect(store.getState().selectedGroup).toBeNull()
    expect(store.getState().selectedWorkspace).toBeNull()
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

  it('selects a Workspace as the active inspector target and clears File state', async () => {
    const store = freshStore('a')
    await store.getState().selectFile('.zshrc')
    store.getState().setCenterTab('history')

    store.getState().selectWorkspace('w1')

    expect(store.getState().selected).toBeNull()
    expect(store.getState().selectedWorkspace).toBe('w1')
    expect(store.getState().selectedGroup).toBeNull()
    expect(store.getState().diff).toBeNull()
    expect(store.getState().centerTab).toBe('changes')
  })

  it('selects a Group as the active inspector target and clears File state', async () => {
    const store = freshStore('a')
    await store.getState().selectFile('.zshrc')

    store.getState().selectGroup('w1', 'g1')

    expect(store.getState().selected).toBeNull()
    expect(store.getState().selectedWorkspace).toBeNull()
    expect(store.getState().selectedGroup).toEqual({ workspaceId: 'w1', groupId: 'g1' })
    expect(store.getState().diff).toBeNull()
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

  it('loads the empty Den warning during app boot', async () => {
    const api = makeApi({
      den: {
        subscriptionState: vi.fn(async () => ({
          workspaces: [],
          registered: false,
          emptyDenWarning:
            "This environment isn't registered yet. Finish setup to choose Workspaces.",
        })),
      },
    })
    const store = createDenSessionStore('a', api)

    await store.getState().init()

    expect(store.getState().emptyDenWarning).toMatch(/isn't registered/i)
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
    expect(store.getState().error?.message).toBe('no chezmoi')
  })
})

describe('session slice — inspector organize/scope actions', () => {
  it('opens a confirm before moving the selected File to another Workspace', async () => {
    const api = makeApi()
    const store = createDenSessionStore('a', api)
    store.setState({
      selected: '.zshrc',
      files: [entry('.zshrc', { workspaceId: 'personal', groupId: 'shell' })],
      workspaces: [
        { id: 'personal', label: 'Personal', groups: [], scope: null },
        { id: 'work', label: 'Work', groups: [], scope: null },
      ],
    })

    store.getState().moveSelectedToWorkspace('work')

    expect(store.getState().confirm).toEqual({
      verb: 'move-workspace',
      path: '.zshrc',
      affected: [],
      workspaceId: 'work',
    })
    expect(api.den.setFileWorkspace).not.toHaveBeenCalled()

    store.getState().runConfirmedVerb()

    await vi.waitFor(() => expect(api.den.setFileWorkspace).toHaveBeenCalledWith('.zshrc', 'work'))
    expect(api.den.tree).toHaveBeenCalled()
  })

  it('does not call setFileWorkspace when the File is already in that Workspace', () => {
    const api = makeApi()
    const store = createDenSessionStore('a', api)
    store.setState({
      selected: '.zshrc',
      files: [entry('.zshrc', { workspaceId: 'personal' })],
    })

    store.getState().moveSelectedToWorkspace('personal')

    expect(api.den.setFileWorkspace).not.toHaveBeenCalled()
  })

  it('scopes the selected Group through setGroupScope', async () => {
    const api = makeApi()
    const store = createDenSessionStore('a', api)
    store.setState({ selectedGroup: { workspaceId: 'personal', groupId: 'shell' } })

    store.getState().scopeSelectedGroup(['darwin'])

    await vi.waitFor(() =>
      expect(api.den.setGroupScope).toHaveBeenCalledWith('personal', 'shell', ['darwin']),
    )
    expect(api.den.tree).toHaveBeenCalled()
  })

  it('renames Workspaces and Groups through organize actions', async () => {
    const api = makeApi()
    const store = createDenSessionStore('a', api)

    store.getState().renameWorkspace('personal', 'Home')
    store.getState().renameGroup('personal', 'shell', 'Terminals')

    await vi.waitFor(() => expect(api.den.renameWorkspace).toHaveBeenCalledWith('personal', 'Home'))
    await vi.waitFor(() =>
      expect(api.den.renameGroup).toHaveBeenCalledWith('personal', 'shell', 'Terminals'),
    )
    expect(api.den.tree).toHaveBeenCalled()
  })

  it('deletes empty Workspaces and Groups through organize actions', async () => {
    const api = makeApi()
    const store = createDenSessionStore('a', api)
    store.setState({
      selectedWorkspace: 'scratch',
      selectedGroup: { workspaceId: 'personal', groupId: 'empty' },
    })

    store.getState().deleteWorkspace('scratch')
    store.getState().deleteGroup('personal', 'empty')

    await vi.waitFor(() => expect(api.den.deleteWorkspace).toHaveBeenCalledWith('scratch'))
    await vi.waitFor(() => expect(api.den.deleteGroup).toHaveBeenCalledWith('personal', 'empty'))
    expect(api.den.tree).toHaveBeenCalled()
  })

  it('drop File → Group changes only the File groupId via moveFileToGroup', async () => {
    const api = makeApi()
    const store = createDenSessionStore('a', api)

    store
      .getState()
      .organizeTreeDrop(
        { id: 'file', kind: 'file', name: '.zshrc', workspaceId: 'personal', targetPath: '.zshrc' },
        { id: 'group', kind: 'group', name: 'Shell', workspaceId: 'personal', groupId: 'shell' },
      )

    await vi.waitFor(() => expect(api.den.moveFileToGroup).toHaveBeenCalledWith('.zshrc', 'shell'))
    expect(api.den.setFileWorkspace).not.toHaveBeenCalled()
  })

  it('drop Group → Group reparents the Group inside the same Workspace', async () => {
    const api = makeApi()
    const store = createDenSessionStore('a', api)

    store
      .getState()
      .organizeTreeDrop(
        { id: 'group:a', kind: 'group', name: 'A', workspaceId: 'personal', groupId: 'a' },
        { id: 'group:b', kind: 'group', name: 'B', workspaceId: 'personal', groupId: 'b' },
      )

    await vi.waitFor(() =>
      expect(api.den.setGroupParent).toHaveBeenCalledWith('personal', 'a', 'b'),
    )
  })

  it('rejects cross-Workspace drops and drops onto Folders', () => {
    const api = makeApi()
    const store = createDenSessionStore('a', api)

    store
      .getState()
      .organizeTreeDrop(
        { id: 'file', kind: 'file', name: '.zshrc', workspaceId: 'personal', targetPath: '.zshrc' },
        { id: 'group', kind: 'group', name: 'Work', workspaceId: 'work', groupId: 'work-shell' },
      )
    store
      .getState()
      .organizeTreeDrop(
        { id: 'group:a', kind: 'group', name: 'A', workspaceId: 'personal', groupId: 'a' },
        { id: 'folder', kind: 'folder', name: '.config', targetPath: '.config' },
      )

    expect(api.den.moveFileToGroup).not.toHaveBeenCalled()
    expect(api.den.setGroupParent).not.toHaveBeenCalled()
    expect(api.den.setFileWorkspace).not.toHaveBeenCalled()
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

  it('a confirmed Discard restores the File from the Den and reloads the tree', async () => {
    const api = makeApi()
    const store = createDenSessionStore('a', api)
    store.setState({ selected: '.zshrc' })
    store.getState().setConfirm({ verb: 'discard', path: '.zshrc', affected: [] })
    store.getState().runConfirmedVerb()
    await vi.waitFor(() => expect(api.den.discardLocalChange).toHaveBeenCalledWith('.zshrc'))
    expect(api.den.tree).toHaveBeenCalled()
  })
})
