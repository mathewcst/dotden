/**
 * IpcBridge unit tests — the `_trace`-on-every-call contract (ADR 0007, issue 1-04).
 *
 * The bridge's load-bearing guarantee is that EVERY IPC channel carries a `_trace`
 * envelope so one Operation is correlatable end to end. These tests drive the bridge
 * with a fake registrar + fake collaborators and assert: every registered channel
 * forwards the call's `traceId` into the foundation, and a payload that arrives
 * WITHOUT a `_trace` fails loudly (never silently emit an uncorrelated Operation).
 */
import { describe, expect, it, vi } from 'vitest'
import { registerIpcBridge, traceId, type IpcRegistrar } from '../../ipc/ipc-bridge.js'

/** A fake registrar that captures channel→handler so tests can invoke them directly. */
function fakeRegistrar() {
  const handlers = new Map<
    string,
    (event: unknown, payload: { _trace: { traceId: string } }) => Promise<unknown>
  >()
  const registrar: IpcRegistrar = {
    handle(channel, handler) {
      handlers.set(channel, handler)
    },
  }
  return { registrar, handlers }
}

describe('IpcBridge', () => {
  it('forwards the _trace id into the DenService on every den:* channel', async () => {
    const den = {
      trackFile: vi.fn(async () => undefined),
      commitTracked: vi.fn(async () => ({
        message: 'm',
        templateId: 'default',
        templateLabel: 'Default',
        committedFiles: ['.zshrc'],
        pushed: false,
      })),
      syncPush: vi.fn(async () => undefined),
      listIncomingClean: vi.fn(async () => []),
      incomingSummary: vi.fn(async () => ({ items: [], fromEnvironmentLabel: 'this-mac' })),
      incomingDiff: vi.fn(async () => ''),
      applyIncoming: vi.fn(async () => ({ results: [], applied: [], failed: [] })),
      fileTree: vi.fn(async () => ({ files: [], workspaces: [] })),
      fileDiff: vi.fn(async () => ''),
    }
    const { registrar, handlers } = fakeRegistrar()
    registerIpcBridge(registrar, {
      remoteClient: async () => ({}) as never,
      denService: async () => den as never,
      discoveryScanner: async () => ({}) as never,
      environmentRegistry: async () => ({}) as never,
    })

    await handlers.get('den:track')?.({}, {
      targetPath: '.zshrc',
      _trace: { traceId: 't1' },
    } as never)
    await handlers.get('den:commit')?.({}, {
      targetPaths: ['.zshrc'],
      _trace: { traceId: 't2' },
    } as never)
    await handlers.get('den:sync-push')?.({}, { _trace: { traceId: 't3' } } as never)
    await handlers.get('den:list-incoming')?.({}, { _trace: { traceId: 't4' } } as never)
    await handlers.get('den:apply')?.({}, {
      targetPaths: ['.zshrc'],
      // The user-confirmed incoming deletions (invariant #4) must be forwarded too.
      confirmedDeletions: ['.bye'],
      _trace: { traceId: 't5' },
    } as never)
    // The three-pane view queries (issue 1-07): read-only, still _trace-correlated.
    await handlers.get('den:tree')?.({}, { _trace: { traceId: 't6' } } as never)
    await handlers.get('den:diff')?.({}, {
      targetPath: '.zshrc',
      _trace: { traceId: 't7' },
    } as never)
    // The Review & Apply surface (issue 1-09): incoming-summary fetches (forwards the
    // trace id); incoming-diff is read-only (asserts _trace, forwards no id).
    await handlers.get('den:incoming-summary')?.({}, { _trace: { traceId: 't8' } } as never)
    await handlers.get('den:incoming-diff')?.({}, {
      targetPath: '.zshrc',
      _trace: { traceId: 't9' },
    } as never)

    expect(den.trackFile).toHaveBeenCalledWith('.zshrc', 't1')
    expect(den.commitTracked).toHaveBeenCalledWith(['.zshrc'], 't2')
    expect(den.syncPush).toHaveBeenCalledWith('t3')
    expect(den.listIncomingClean).toHaveBeenCalledWith('t4')
    expect(den.applyIncoming).toHaveBeenCalledWith(['.zshrc'], 't5', ['.bye'])
    // tree/diff are read-only: the bridge asserts _trace but does not forward an id.
    expect(den.fileTree).toHaveBeenCalledTimes(1)
    expect(den.fileDiff).toHaveBeenCalledWith('.zshrc')
    // incoming-summary is a sync Operation (id forwarded); incoming-diff is read-only.
    expect(den.incomingSummary).toHaveBeenCalledWith('t8')
    expect(den.incomingDiff).toHaveBeenCalledWith('.zshrc')
  })

  it('forwards the _trace id into the DenService on every conflict den:* channel (issue 1-11)', async () => {
    const den = {
      detectConflicts: vi.fn(async () => ({ conflicts: [], autoMerged: true })),
      resolveConflictFile: vi.fn(async () => undefined),
      completeConflictResolution: vi.fn(async () => undefined),
      abortConflictResolution: vi.fn(async () => undefined),
    }
    const { registrar, handlers } = fakeRegistrar()
    registerIpcBridge(registrar, {
      remoteClient: async () => ({}) as never,
      denService: async () => den as never,
      discoveryScanner: async () => ({}) as never,
      environmentRegistry: async () => ({}) as never,
    })

    await handlers.get('den:detect-conflicts')?.({}, { _trace: { traceId: 'c1' } } as never)
    await handlers.get('den:resolve-conflict')?.({}, {
      targetPath: 'dot_zshrc',
      // The user's explicit Keep mine/Take theirs/Open both choice is forwarded verbatim.
      choice: 'incoming',
      _trace: { traceId: 'c2' },
    } as never)
    await handlers.get('den:complete-conflicts')?.({}, { _trace: { traceId: 'c3' } } as never)
    await handlers.get('den:abort-conflicts')?.({}, { _trace: { traceId: 'c4' } } as never)

    // detect is a sync Operation; resolve/complete/abort MUTATE the merge — all forward the id.
    expect(den.detectConflicts).toHaveBeenCalledWith('c1')
    expect(den.resolveConflictFile).toHaveBeenCalledWith('dot_zshrc', 'incoming', 'c2')
    expect(den.completeConflictResolution).toHaveBeenCalledWith('c3')
    expect(den.abortConflictResolution).toHaveBeenCalledWith('c4')

    // …and each still hard-fails without a _trace envelope (never an uncorrelated mutation).
    await expect(
      handlers.get('den:resolve-conflict')?.({}, {
        targetPath: 'dot_zshrc',
        choice: 'current',
      } as never),
    ).rejects.toThrow('without a _trace envelope')
  })

  it('forwards the _trace id into the DenService on every organize den:* channel (issue 1-14)', async () => {
    const den = {
      createWorkspace: vi.fn(async () => ({ id: 'ws-1', label: 'Work', groups: [] })),
      createGroup: vi.fn(async () => ({ id: 'grp-1', label: 'Shell', parentId: null })),
      moveFileToGroup: vi.fn(async () => undefined),
      setFileWorkspace: vi.fn(async () => undefined),
    }
    const { registrar, handlers } = fakeRegistrar()
    registerIpcBridge(registrar, {
      remoteClient: async () => ({}) as never,
      denService: async () => den as never,
      discoveryScanner: async () => ({}) as never,
      environmentRegistry: async () => ({}) as never,
    })

    await handlers.get('den:create-workspace')?.({}, {
      label: 'Work',
      _trace: { traceId: 'o1' },
    } as never)
    await handlers.get('den:create-group')?.({}, {
      workspaceId: 'personal',
      label: 'Shell',
      parentId: null,
      _trace: { traceId: 'o2' },
    } as never)
    await handlers.get('den:move-to-group')?.({}, {
      targetPath: '.zshrc',
      groupId: 'grp-1',
      _trace: { traceId: 'o3' },
    } as never)
    await handlers.get('den:set-file-workspace')?.({}, {
      targetPath: '.zshrc',
      workspaceId: 'ws-1',
      _trace: { traceId: 'o4' },
    } as never)

    // Each organize verb MUTATES `.myenv/`, so the bridge forwards its trace id.
    expect(den.createWorkspace).toHaveBeenCalledWith('Work', 'o1')
    expect(den.createGroup).toHaveBeenCalledWith('personal', 'Shell', null, 'o2')
    expect(den.moveFileToGroup).toHaveBeenCalledWith('.zshrc', 'grp-1', 'o3')
    expect(den.setFileWorkspace).toHaveBeenCalledWith('.zshrc', 'ws-1', 'o4')

    // …and each still hard-fails without a _trace envelope (never an uncorrelated mutation).
    await expect(
      handlers.get('den:create-workspace')?.({}, { label: 'X' } as never),
    ).rejects.toThrow('without a _trace envelope')
  })

  it('forwards the _trace envelope into the RemoteClient on every remote:* channel', async () => {
    const remote = {
      preflightRemote: vi.fn(async () => ({ reachable: true, gitCommand: 'git' })),
      connectExistingRemote: vi.fn(async () => ({ gitCommand: 'git', sourceDir: '/s' })),
      latestRemoteSha: vi.fn(async () => null),
    }
    const { registrar, handlers } = fakeRegistrar()
    registerIpcBridge(registrar, {
      remoteClient: async () => remote as never,
      denService: async () => ({}) as never,
      discoveryScanner: async () => ({}) as never,
      environmentRegistry: async () => ({}) as never,
    })

    await handlers.get('remote:preflight')?.({}, {
      url: 'git@h:o/r.git',
      _trace: { traceId: 'r1' },
    } as never)

    expect(remote.preflightRemote).toHaveBeenCalledWith('git@h:o/r.git', {
      _trace: { traceId: 'r1' },
    })
  })

  it('rejects a call that reached the bridge without a _trace envelope', async () => {
    const { registrar, handlers } = fakeRegistrar()
    registerIpcBridge(registrar, {
      remoteClient: async () => ({}) as never,
      denService: async () => ({ syncPush: async () => undefined }) as never,
      discoveryScanner: async () => ({}) as never,
      environmentRegistry: async () => ({}) as never,
    })

    await expect(handlers.get('den:sync-push')?.({}, {} as never)).rejects.toThrow(
      'without a _trace envelope',
    )
  })

  it('routes discover:* channels to the DiscoveryScanner and asserts _trace', async () => {
    const scanner = {
      scan: vi.fn(async () => ({ suggestions: [{ targetPath: '.zshrc', toolId: 'zsh' }] })),
      inspectCustomPath: vi.fn(async () => ({ targetPath: '.foorc', toolId: 'custom' })),
    }
    const { registrar, handlers } = fakeRegistrar()
    registerIpcBridge(registrar, {
      remoteClient: async () => ({}) as never,
      denService: async () => ({}) as never,
      discoveryScanner: async () => scanner as never,
      environmentRegistry: async () => ({}) as never,
    })

    await expect(
      handlers.get('discover:scan')?.({}, { _trace: { traceId: 'd1' } } as never),
    ).resolves.toMatchObject({ suggestions: [{ targetPath: '.zshrc' }] })
    expect(scanner.scan).toHaveBeenCalledTimes(1)

    await handlers.get('discover:inspect-path')?.({}, {
      targetPath: '.foorc',
      _trace: { traceId: 'd2' },
    } as never)
    // The arbitrary drag-in path is forwarded verbatim to inspectCustomPath.
    expect(scanner.inspectCustomPath).toHaveBeenCalledWith('.foorc')

    // Both discover:* channels still hard-fail without a _trace envelope.
    await expect(handlers.get('discover:scan')?.({}, {} as never)).rejects.toThrow(
      'without a _trace envelope',
    )
  })

  it('routes env:* channels to the EnvironmentRegistry and asserts _trace', async () => {
    const selfEntry = {
      id: 'env-self',
      label: 'renamed',
      os: 'linux',
      subscribedWorkspaces: ['personal'],
      isSelf: true,
      attribution: { commitCount: 0 },
    }
    const registry = {
      setupIdentity: vi.fn(async () => ({ id: 'env-self', label: 'renamed' })),
      list: vi.fn(async () => [selfEntry]),
      renameLabel: vi.fn(async () => ({ id: 'env-self', label: 'renamed' })),
      suggestClaims: vi.fn(async () => []),
    }
    const { registrar, handlers } = fakeRegistrar()
    registerIpcBridge(registrar, {
      remoteClient: async () => ({}) as never,
      denService: async () => ({}) as never,
      discoveryScanner: async () => ({}) as never,
      environmentRegistry: async () => registry as never,
    })

    await expect(
      handlers.get('env:list')?.({}, { _trace: { traceId: 'e1' } } as never),
    ).resolves.toBeDefined()
    // rename returns the renamed self entry joined with attribution (one round-trip).
    await expect(
      handlers.get('env:rename')?.({}, { label: 'renamed', _trace: { traceId: 'e2' } } as never),
    ).resolves.toMatchObject({ isSelf: true, label: 'renamed' })
    expect(registry.renameLabel).toHaveBeenCalledWith('renamed')
    await expect(
      handlers.get('env:suggest-claims')?.({}, { _trace: { traceId: 'e3' } } as never),
    ).resolves.toEqual([])

    // Every env:* channel still hard-fails without a _trace envelope.
    await expect(handlers.get('env:list')?.({}, {} as never)).rejects.toThrow(
      'without a _trace envelope',
    )
  })

  it('traceId() throws on a missing or empty id', () => {
    expect(() => traceId({ _trace: { traceId: '' } })).toThrow()
    expect(() => traceId({} as never)).toThrow()
    expect(traceId({ _trace: { traceId: 'ok' } })).toBe('ok')
  })
})
