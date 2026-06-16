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
import type { SyncSettings } from '../sync-settings.js'

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
      scanCommit: vi.fn(async () => []),
      commitTracked: vi.fn(async () => ({
        message: 'm',
        templateId: 'default',
        templateLabel: 'Default',
        committedFiles: ['.zshrc'],
        pushed: false,
      })),
      syncPush: vi.fn(async () => ({ pushed: true, queued: false })),
      flushPushQueue: vi.fn(async () => ({ pushed: false, queued: false })),
      pushPending: vi.fn(async () => false),
      listIncomingClean: vi.fn(async () => []),
      incomingSummary: vi.fn(async () => ({ items: [], fromEnvironmentLabel: 'this-mac' })),
      incomingDiff: vi.fn(async () => ''),
      applyIncoming: vi.fn(async () => ({ results: [], applied: [], failed: [] })),
      fileTree: vi.fn(async () => ({ files: [], workspaces: [] })),
      fileDiff: vi.fn(async () => ''),
      // The History tab (issue 2-01): per-File version list + read-only version preview.
      fileHistory: vi.fn(async () => []),
      fileVersionDiff: vi.fn(async () => ''),
    }
    const { registrar, handlers } = fakeRegistrar()
    registerIpcBridge(registrar, {
      remoteClient: async () => ({}) as never,
      denService: async () => den as never,
      discoveryScanner: async () => ({}) as never,
      environmentRegistry: async () => ({}) as never,
      getAutomationLevel: async () => 'manual' as const,
      setAutomationLevel: async () => undefined,
      claimEnvironment: async () => undefined,
      getUnsubscribeDisposition: async () => 'keep' as const,
      setUnsubscribeDisposition: async () => undefined,
      getSyncSettings: async () => ({
        pollerEnabled: true,
        cadence: 'fast' as const,
        startOnLogin: false,
      }),
      setSyncSettings: async (settings) => settings,
    })

    await handlers.get('den:track')?.({}, {
      targetPath: '.zshrc',
      _trace: { traceId: 't1' },
    } as never)
    // Commit-time secret scan (issue 2-03): a read-but-Operation channel, _trace forwarded.
    await handlers.get('den:scan-commit')?.({}, {
      targetPaths: ['.zshrc'],
      _trace: { traceId: 't12' },
    } as never)
    await handlers.get('den:commit')?.({}, {
      targetPaths: ['.zshrc'],
      _trace: { traceId: 't2' },
    } as never)
    await handlers.get('den:sync-push')?.({}, { _trace: { traceId: 't3' } } as never)
    // The offline push queue (issue 1-16): flush MUTATES (forwards the id); push-pending is
    // read-only (asserts _trace, forwards no id).
    await handlers.get('den:flush-push-queue')?.({}, { _trace: { traceId: 't10' } } as never)
    await handlers.get('den:push-pending')?.({}, { _trace: { traceId: 't11' } } as never)
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
    // The History tab queries (issue 2-01): read-only, still _trace-correlated.
    await handlers.get('den:file-history')?.({}, {
      targetPath: '.zshrc',
      _trace: { traceId: 't13' },
    } as never)
    await handlers.get('den:file-version-diff')?.({}, {
      targetPath: '.zshrc',
      sha: 'abc1234',
      _trace: { traceId: 't14' },
    } as never)
    // The Review & Apply surface (issue 1-09): incoming-summary fetches (forwards the
    // trace id); incoming-diff is read-only (asserts _trace, forwards no id).
    await handlers.get('den:incoming-summary')?.({}, { _trace: { traceId: 't8' } } as never)
    await handlers.get('den:incoming-diff')?.({}, {
      targetPath: '.zshrc',
      _trace: { traceId: 't9' },
    } as never)

    expect(den.trackFile).toHaveBeenCalledWith('.zshrc', 't1')
    expect(den.scanCommit).toHaveBeenCalledWith(['.zshrc'], 't12')
    expect(den.commitTracked).toHaveBeenCalledWith(['.zshrc'], 't2')
    expect(den.syncPush).toHaveBeenCalledWith('t3')
    // flush-push-queue forwards the id (it pushes); push-pending is read-only (no id forwarded).
    expect(den.flushPushQueue).toHaveBeenCalledWith('t10')
    expect(den.pushPending).toHaveBeenCalledTimes(1)
    expect(den.listIncomingClean).toHaveBeenCalledWith('t4')
    expect(den.applyIncoming).toHaveBeenCalledWith(['.zshrc'], 't5', ['.bye'])
    // tree/diff are read-only: the bridge asserts _trace but does not forward an id.
    expect(den.fileTree).toHaveBeenCalledTimes(1)
    expect(den.fileDiff).toHaveBeenCalledWith('.zshrc')
    // file-history / file-version-diff are read-only (assert _trace, forward no id).
    expect(den.fileHistory).toHaveBeenCalledWith('.zshrc')
    expect(den.fileVersionDiff).toHaveBeenCalledWith('.zshrc', 'abc1234')
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
      getAutomationLevel: async () => 'manual' as const,
      setAutomationLevel: async () => undefined,
      claimEnvironment: async () => undefined,
      getUnsubscribeDisposition: async () => 'keep' as const,
      setUnsubscribeDisposition: async () => undefined,
      getSyncSettings: async () => ({
        pollerEnabled: true,
        cadence: 'fast' as const,
        startOnLogin: false,
      }),
      setSyncSettings: async (settings) => settings,
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
      createWorkspace: vi.fn(async () => ({ id: 'ws-1', label: 'Work', groups: [], scope: null })),
      createGroup: vi.fn(async () => ({
        id: 'grp-1',
        label: 'Shell',
        parentId: null,
        scope: null,
      })),
      moveFileToGroup: vi.fn(async () => undefined),
      setFileWorkspace: vi.fn(async () => undefined),
      setFileScope: vi.fn(async () => ['win32'] as const),
      setGroupScope: vi.fn(async () => ['darwin'] as const),
    }
    const { registrar, handlers } = fakeRegistrar()
    registerIpcBridge(registrar, {
      remoteClient: async () => ({}) as never,
      denService: async () => den as never,
      discoveryScanner: async () => ({}) as never,
      environmentRegistry: async () => ({}) as never,
      getAutomationLevel: async () => 'manual' as const,
      setAutomationLevel: async () => undefined,
      claimEnvironment: async () => undefined,
      getUnsubscribeDisposition: async () => 'keep' as const,
      setUnsubscribeDisposition: async () => undefined,
      getSyncSettings: async () => ({
        pollerEnabled: true,
        cadence: 'fast' as const,
        startOnLogin: false,
      }),
      setSyncSettings: async (settings) => settings,
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
    await handlers.get('den:set-file-scope')?.({}, {
      targetPath: '.config/powershell/profile.ps1',
      scope: ['win32'],
      _trace: { traceId: 'o5' },
    } as never)
    await handlers.get('den:set-group-scope')?.({}, {
      workspaceId: 'personal',
      groupId: 'grp-1',
      scope: ['darwin'],
      _trace: { traceId: 'o6' },
    } as never)

    // Each organize verb MUTATES `.myenv/`, so the bridge forwards its trace id.
    expect(den.createWorkspace).toHaveBeenCalledWith('Work', 'o1')
    expect(den.createGroup).toHaveBeenCalledWith('personal', 'Shell', null, 'o2')
    expect(den.moveFileToGroup).toHaveBeenCalledWith('.zshrc', 'grp-1', 'o3')
    expect(den.setFileWorkspace).toHaveBeenCalledWith('.zshrc', 'ws-1', 'o4')
    // The OS Scope verbs (issue 1-15) forward the trace id too and pass the requested Scope.
    expect(den.setFileScope).toHaveBeenCalledWith('.config/powershell/profile.ps1', ['win32'], 'o5')
    expect(den.setGroupScope).toHaveBeenCalledWith('personal', 'grp-1', ['darwin'], 'o6')

    // …and each still hard-fails without a _trace envelope (never an uncorrelated mutation).
    await expect(
      handlers.get('den:create-workspace')?.({}, { label: 'X' } as never),
    ).rejects.toThrow('without a _trace envelope')
  })

  it('routes the subscription + new-or-returning channels (issue 1-13)', async () => {
    const den = {
      subscriptionState: vi.fn(async () => ({
        workspaces: [],
        registered: false,
        emptyDenWarning: null,
      })),
      setSubscriptions: vi.fn(async () => ({
        workspaces: [],
        registered: true,
        emptyDenWarning: null,
      })),
      unsubscribeWorkspace: vi.fn(async () => ({
        workspaces: [],
        registered: true,
        emptyDenWarning: null,
      })),
    }
    const registry = {
      registerWithSubscription: vi.fn(async () => ({
        id: 'env-b',
        label: 'b',
        os: 'linux',
        subscribedWorkspaces: [],
      })),
      list: vi.fn(async () => []),
    }
    const claimEnvironment = vi.fn(async () => undefined)
    const getUnsubscribeDisposition = vi.fn(async () => 'keep' as const)
    const setUnsubscribeDisposition = vi.fn(async () => undefined)
    const { registrar, handlers } = fakeRegistrar()
    registerIpcBridge(registrar, {
      remoteClient: async () => ({}) as never,
      denService: async () => den as never,
      discoveryScanner: async () => ({}) as never,
      environmentRegistry: async () => registry as never,
      getAutomationLevel: async () => 'manual' as const,
      setAutomationLevel: async () => undefined,
      claimEnvironment,
      getUnsubscribeDisposition,
      setUnsubscribeDisposition,
      getSyncSettings: async () => ({
        pollerEnabled: true,
        cadence: 'fast' as const,
        startOnLogin: false,
      }),
      setSyncSettings: async (settings) => settings,
    })

    await handlers.get('den:subscription-state')?.({}, { _trace: { traceId: 's1' } } as never)
    await handlers.get('den:set-subscriptions')?.({}, {
      workspaceIds: ['personal'],
      _trace: { traceId: 's2' },
    } as never)
    await handlers.get('den:unsubscribe-workspace')?.({}, {
      workspaceId: 'ws-work',
      disposition: 'remove',
      _trace: { traceId: 's3' },
    } as never)
    await handlers.get('den:unsubscribe-disposition')?.({}, { _trace: { traceId: 's4' } } as never)
    await handlers.get('den:remember-unsubscribe-disposition')?.({}, {
      disposition: 'remove',
      _trace: { traceId: 's5' },
    } as never)
    // The new-or-returning fork: register a brand-new env, or claim an existing entry's id.
    await handlers.get('env:register-new')?.({}, {
      workspaceIds: ['personal'],
      _trace: { traceId: 's6' },
    } as never)
    await handlers.get('env:claim')?.({}, {
      envId: 'env-existing',
      workspaceIds: undefined,
      _trace: { traceId: 's7' },
    } as never)

    // set-subscriptions forwards the trace id (it mutates); subscription-state is read-only.
    expect(den.setSubscriptions).toHaveBeenCalledWith(['personal'], 's2')
    expect(den.subscriptionState).toHaveBeenCalledTimes(1) // just the direct s1 read
    expect(den.unsubscribeWorkspace).toHaveBeenCalledWith('ws-work', 'remove', 's3')
    expect(getUnsubscribeDisposition).toHaveBeenCalledTimes(1)
    expect(setUnsubscribeDisposition).toHaveBeenCalledWith('remove')
    // register-new writes the subscription then lists; claim adopts the id FIRST, then registers.
    expect(registry.registerWithSubscription).toHaveBeenCalledTimes(2)
    expect(claimEnvironment).toHaveBeenCalledWith('env-existing')

    // Each still hard-fails without a _trace envelope (never an uncorrelated call).
    await expect(
      handlers.get('den:set-subscriptions')?.({}, { workspaceIds: [] } as never),
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
      getAutomationLevel: async () => 'manual' as const,
      setAutomationLevel: async () => undefined,
      claimEnvironment: async () => undefined,
      getUnsubscribeDisposition: async () => 'keep' as const,
      setUnsubscribeDisposition: async () => undefined,
      getSyncSettings: async () => ({
        pollerEnabled: true,
        cadence: 'fast' as const,
        startOnLogin: false,
      }),
      setSyncSettings: async (settings) => settings,
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
      getAutomationLevel: async () => 'manual' as const,
      setAutomationLevel: async () => undefined,
      claimEnvironment: async () => undefined,
      getUnsubscribeDisposition: async () => 'keep' as const,
      setUnsubscribeDisposition: async () => undefined,
      getSyncSettings: async () => ({
        pollerEnabled: true,
        cadence: 'fast' as const,
        startOnLogin: false,
      }),
      setSyncSettings: async (settings) => settings,
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
      getAutomationLevel: async () => 'manual' as const,
      setAutomationLevel: async () => undefined,
      claimEnvironment: async () => undefined,
      getUnsubscribeDisposition: async () => 'keep' as const,
      setUnsubscribeDisposition: async () => undefined,
      getSyncSettings: async () => ({
        pollerEnabled: true,
        cadence: 'fast' as const,
        startOnLogin: false,
      }),
      setSyncSettings: async (settings) => settings,
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
      getAutomationLevel: async () => 'manual' as const,
      setAutomationLevel: async () => undefined,
      claimEnvironment: async () => undefined,
      getUnsubscribeDisposition: async () => 'keep' as const,
      setUnsubscribeDisposition: async () => undefined,
      getSyncSettings: async () => ({
        pollerEnabled: true,
        cadence: 'fast' as const,
        startOnLogin: false,
      }),
      setSyncSettings: async (settings) => settings,
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

  it('routes the automation:* channels and asserts _trace (issue 1-12)', async () => {
    const getAutomationLevel = vi.fn(async () => 'auto-sync' as const)
    const setAutomationLevel = vi.fn(async () => undefined)
    const { registrar, handlers } = fakeRegistrar()
    registerIpcBridge(registrar, {
      remoteClient: async () => ({}) as never,
      denService: async () => ({}) as never,
      discoveryScanner: async () => ({}) as never,
      environmentRegistry: async () => ({}) as never,
      getAutomationLevel,
      setAutomationLevel,
      claimEnvironment: async () => undefined,
      getUnsubscribeDisposition: async () => 'keep' as const,
      setUnsubscribeDisposition: async () => undefined,
      getSyncSettings: async () => ({
        pollerEnabled: true,
        cadence: 'fast' as const,
        startOnLogin: false,
      }),
      setSyncSettings: async (settings) => settings,
    })

    // get-level forwards the environment-local rung.
    await expect(
      handlers.get('automation:get-level')?.({}, { _trace: { traceId: 'a1' } } as never),
    ).resolves.toBe('auto-sync')
    // set-level forwards the chosen level so index.ts can persist + re-arm the services.
    await handlers.get('automation:set-level')?.({}, {
      level: 'manual',
      _trace: { traceId: 'a2' },
    } as never)
    expect(setAutomationLevel).toHaveBeenCalledWith('manual')

    // Both channels still hard-fail without a _trace envelope (uniform correlation).
    await expect(handlers.get('automation:get-level')?.({}, {} as never)).rejects.toThrow(
      'without a _trace envelope',
    )
  })

  it('routes the sync:* settings channels and asserts _trace (issue 2-08)', async () => {
    const getSyncSettings = vi.fn(async () => ({
      pollerEnabled: true,
      cadence: 'fast' as const,
      startOnLogin: false,
    }))
    // setSyncSettings echoes the persisted settings back (index.ts re-arms the poller + autostart).
    const setSyncSettings = vi.fn(async (settings: SyncSettings) => settings)
    const { registrar, handlers } = fakeRegistrar()
    registerIpcBridge(registrar, {
      remoteClient: async () => ({}) as never,
      denService: async () => ({}) as never,
      discoveryScanner: async () => ({}) as never,
      environmentRegistry: async () => ({}) as never,
      getAutomationLevel: async () => 'manual' as const,
      setAutomationLevel: async () => undefined,
      claimEnvironment: async () => undefined,
      getUnsubscribeDisposition: async () => 'keep' as const,
      setUnsubscribeDisposition: async () => undefined,
      getSyncSettings,
      setSyncSettings,
    })

    // get-settings forwards the environment-local Sync settings.
    await expect(
      handlers.get('sync:get-settings')?.({}, { _trace: { traceId: 'y1' } } as never),
    ).resolves.toEqual({ pollerEnabled: true, cadence: 'fast', startOnLogin: false })
    // set-settings forwards the chosen settings so index.ts can persist + re-arm the poller/autostart.
    const next: SyncSettings = { pollerEnabled: false, cadence: 'relaxed', startOnLogin: true }
    await handlers.get('sync:set-settings')?.({}, {
      settings: next,
      _trace: { traceId: 'y2' },
    } as never)
    expect(setSyncSettings).toHaveBeenCalledWith(next)

    // Both channels still hard-fail without a _trace envelope (uniform correlation).
    await expect(handlers.get('sync:get-settings')?.({}, {} as never)).rejects.toThrow(
      'without a _trace envelope',
    )
  })

  it('traceId() throws on a missing or empty id', () => {
    expect(() => traceId({ _trace: { traceId: '' } })).toThrow()
    expect(() => traceId({} as never)).toThrow()
    expect(traceId({ _trace: { traceId: 'ok' } })).toBe('ok')
  })
})
