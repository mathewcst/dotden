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
import { registerIpcBridge, traceId, type IpcRegistrar } from '../ipc-bridge.js'
import type { SyncSettings } from '../../../shared/settings.js'
import type { PrivacySettings } from '../../../shared/settings.js'

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
  it('routes diagnostics channels and exposes only redacted record DTOs (PRD4)', async () => {
    const openDiagnosticsLogLocation = vi.fn(async () => undefined)
    const diagnosticsRecordsFor = vi.fn(async () => [
      {
        command: 'git',
        args: ['push', 'https://user:[REDACTED]@github.com/dotden/den.git'],
        exitCode: 128,
        redactedStdout: '',
        redactedStderr: 'remote: token [REDACTED]',
        traceId: 'trace-a',
        timestamp: 1,
      },
    ])
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
      getSyncSettings: async () => ({
        pollerEnabled: true,
        cadence: 'fast' as const,
        startOnLogin: false,
      }),
      setSyncSettings: async (settings) => settings,
      getPrivacySettings: async () => ({
        analyticsEnabled: false,
        crashReportsEnabled: false,
        diagnosticLogsEnabled: false,
      }),
      setPrivacySettings: async (settings) => settings,
      launchState: async () => ({ status: 'ready' as const }),
      getAppInfo: async () => ({ version: '1.2.0', platform: 'linux' }),
      checkForUpdates: async () => ({
        status: 'unavailable' as const,
        currentVersion: '1.2.0',
        latestVersion: null,
        detail: 'No update feed is configured for this build yet.',
      }),
      openDiagnosticsLogLocation,
      diagnosticsRecordsFor,
    })

    await handlers.get('diagnostics:open-log-location')?.({}, {
      _trace: { traceId: 'diag-1' },
    } as never)

    expect(openDiagnosticsLogLocation).toHaveBeenCalledTimes(1)
    const records = (await handlers.get('diagnostics:records')?.({}, {
      traceId: 'trace-a',
      _trace: { traceId: 'diag-2' },
    } as never)) as readonly Record<string, unknown>[]
    expect(diagnosticsRecordsFor).toHaveBeenCalledWith('trace-a')
    expect(records[0]).toMatchObject({
      redactedStdout: '',
      redactedStderr: 'remote: token [REDACTED]',
    })
    expect(records[0]).not.toHaveProperty('stdout')
    expect(records[0]).not.toHaveProperty('stderr')
    await expect(handlers.get('diagnostics:open-log-location')?.({}, {} as never)).rejects.toThrow(
      'without a _trace envelope',
    )
  })

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
      // The Account tab (issue 2-11): the connected Remote URL + parsed Provider host/scheme.
      connectedRemote: vi.fn(async () => ({
        url: 'git@github.com:you/den.git',
        host: 'github.com',
        scheme: 'ssh',
      })),
      // The History tab (issue 2-01): per-File version list + read-only version preview.
      fileHistory: vi.fn(async () => []),
      fileVersionDiff: vi.fn(async () => ''),
      // Restore-forward (issue 2-02): a MUTATING Operation (records a new Commit).
      restoreFileVersion: vi.fn(async () => ({
        restoredShortSha: 'abc1234',
        targetPath: '.zshrc',
        committed: true,
      })),
      registerEnvironment: vi.fn(async () => undefined),
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
      getPrivacySettings: async () => ({
        analyticsEnabled: false,
        crashReportsEnabled: false,
        diagnosticLogsEnabled: false,
      }),
      setPrivacySettings: async (settings) => settings,
      launchState: async () => ({ status: 'ready' as const }),
      getAppInfo: async () => ({ version: '1.2.0', platform: 'linux' }),
      checkForUpdates: async () => ({
        status: 'unavailable' as const,
        currentVersion: '1.2.0',
        latestVersion: null,
        detail: 'No update feed is configured for this build yet.',
      }),
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
    // The Account tab's connected-Remote read (issue 2-11): read-only, still _trace-correlated.
    await handlers.get('den:connected-remote')?.({}, { _trace: { traceId: 't16' } } as never)
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
    // Restore-forward (issue 2-02): a MUTATING Operation — its trace id IS forwarded.
    await handlers.get('den:restore-version')?.({}, {
      targetPath: '.zshrc',
      sha: 'abc1234',
      _trace: { traceId: 't15' },
    } as never)
    // The Review & Apply surface (issue 1-09): incoming-summary fetches (forwards the
    // trace id); incoming-diff is read-only (asserts _trace, forwards no id).
    await handlers.get('den:incoming-summary')?.({}, { _trace: { traceId: 't8' } } as never)
    await handlers.get('den:incoming-diff')?.({}, {
      targetPath: '.zshrc',
      _trace: { traceId: 't9' },
    } as never)
    // The launch-routing gate (ADR 0026): read-only, asserts _trace, returns the gate status.
    const launch = await handlers.get('den:launch-state')?.({}, {
      _trace: { traceId: 't17' },
    } as never)
    // First-run setup with zero Tracked Files still registers the environment.
    await handlers.get('den:register-environment')?.({}, { _trace: { traceId: 't18' } } as never)

    expect(den.trackFile).toHaveBeenCalledWith('.zshrc', 't1')
    expect(den.registerEnvironment).toHaveBeenCalledWith('t18')
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
    // connected-remote is read-only too (asserts _trace, forwards no id).
    expect(den.connectedRemote).toHaveBeenCalledTimes(1)
    // launch-state routes to deps.launchState and passes its status straight back (ADR 0026).
    expect(launch).toEqual({ status: 'ready' })
    // file-history / file-version-diff are read-only (assert _trace, forward no id).
    expect(den.fileHistory).toHaveBeenCalledWith('.zshrc')
    expect(den.fileVersionDiff).toHaveBeenCalledWith('.zshrc', 'abc1234')
    // restore-version MUTATES (records a Commit), so the trace id IS forwarded.
    expect(den.restoreFileVersion).toHaveBeenCalledWith('.zshrc', 'abc1234', 't15')
    // incoming-summary is a sync Operation (id forwarded); incoming-diff is read-only.
    expect(den.incomingSummary).toHaveBeenCalledWith('t8')
    expect(den.incomingDiff).toHaveBeenCalledWith('.zshrc')
  })

  it('routes the commit-template channels and asserts _trace (issue 2-09)', async () => {
    const state = {
      template: '[$os-sync-$year-$month-$day]',
      data: { os: 'darwin', arch: 'arm64', hostname: 'work-laptop' },
      environment: 'this-mac',
    }
    const den = {
      // get-commit-template is a read Operation; set-commit-template MUTATES `.dotden/` + Commits.
      commitTemplate: vi.fn(async () => state),
      setCommitTemplate: vi.fn(async () => state),
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
      getPrivacySettings: async () => ({
        analyticsEnabled: false,
        crashReportsEnabled: false,
        diagnosticLogsEnabled: false,
      }),
      setPrivacySettings: async (settings) => settings,
      launchState: async () => ({ status: 'ready' as const }),
      getAppInfo: async () => ({ version: '1.2.0', platform: 'linux' }),
      checkForUpdates: async () => ({
        status: 'unavailable' as const,
        currentVersion: '1.2.0',
        latestVersion: null,
        detail: 'No update feed is configured for this build yet.',
      }),
    })

    // get forwards the read Operation's trace id.
    await expect(
      handlers.get('den:get-commit-template')?.({}, { _trace: { traceId: 'ct1' } } as never),
    ).resolves.toMatchObject({ template: '[$os-sync-$year-$month-$day]' })
    expect(den.commitTemplate).toHaveBeenCalledWith('ct1')
    // set forwards the new template + the trace id (it records a Commit).
    await handlers.get('den:set-commit-template')?.({}, {
      template: '$environment $date',
      _trace: { traceId: 'ct2' },
    } as never)
    expect(den.setCommitTemplate).toHaveBeenCalledWith('$environment $date', 'ct2')

    // Both channels still hard-fail without a _trace envelope.
    await expect(
      handlers.get('den:set-commit-template')?.({}, { template: 'x' } as never),
    ).rejects.toThrow('without a _trace envelope')
  })

  it('routes the appearance channels, forwards the settings/override + _trace (issues 2-10 + 2-17)', async () => {
    const settings = {
      theme: 'blue' as const,
      defaultApply: 'apply-all' as const,
      notifyOn: { incoming: false, conflict: true, applied: true },
    }
    const state = { effective: settings, synced: settings, override: { theme: 'blue' as const } }
    const den = {
      // get-appearance reads the EFFECTIVE value; get-appearance-state reads the synced·override·
      // effective triple. set-appearance MUTATES `.dotden/` (+ Commits); set-appearance-override
      // pins this env's LOCAL override in userData only (no Commit, never travels — issue 2-17).
      appearanceSettings: vi.fn(async () => settings),
      appearanceState: vi.fn(async () => state),
      setAppearanceSettings: vi.fn(async () => state),
      setAppearanceOverride: vi.fn(async () => state),
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
      setSyncSettings: async (s) => s,
      getPrivacySettings: async () => ({
        analyticsEnabled: false,
        crashReportsEnabled: false,
        diagnosticLogsEnabled: false,
      }),
      setPrivacySettings: async (s) => s,
      launchState: async () => ({ status: 'ready' as const }),
      getAppInfo: async () => ({ version: '1.2.0', platform: 'linux' }),
      checkForUpdates: async () => ({
        status: 'unavailable' as const,
        currentVersion: '1.2.0',
        latestVersion: null,
        detail: 'No update feed is configured for this build yet.',
      }),
    })

    // get forwards the read Operation's trace id.
    await expect(
      handlers.get('den:get-appearance')?.({}, { _trace: { traceId: 'ap1' } } as never),
    ).resolves.toMatchObject({ theme: 'blue' })
    expect(den.appearanceSettings).toHaveBeenCalledWith('ap1')
    // get-appearance-state forwards the read trace id + returns the synced·override·effective triple.
    await expect(
      handlers.get('den:get-appearance-state')?.({}, { _trace: { traceId: 'ap1s' } } as never),
    ).resolves.toMatchObject({ override: { theme: 'blue' } })
    expect(den.appearanceState).toHaveBeenCalledWith('ap1s')
    // set forwards the whole settings object + the trace id (it records a Commit).
    await handlers.get('den:set-appearance')?.({}, {
      settings,
      _trace: { traceId: 'ap2' },
    } as never)
    expect(den.setAppearanceSettings).toHaveBeenCalledWith(settings, 'ap2')
    // set-appearance-override forwards the sparse override + the trace id (env-local pin, no Commit).
    await handlers.get('den:set-appearance-override')?.({}, {
      override: { theme: 'green' },
      _trace: { traceId: 'ap3' },
    } as never)
    expect(den.setAppearanceOverride).toHaveBeenCalledWith({ theme: 'green' }, 'ap3')

    // The mutating channels still hard-fail without a _trace envelope.
    await expect(handlers.get('den:set-appearance')?.({}, { settings } as never)).rejects.toThrow(
      'without a _trace envelope',
    )
    await expect(
      handlers.get('den:set-appearance-override')?.({}, { override: {} } as never),
    ).rejects.toThrow('without a _trace envelope')
  })

  it('forwards the _trace id into the DenService on every conflict den:* channel (issue 1-11)', async () => {
    const den = {
      detectConflicts: vi.fn(async () => ({ conflicts: [], autoMerged: true })),
      resolveConflictFile: vi.fn(async () => undefined),
      completeConflictResolution: vi.fn(async () => undefined),
      abortConflictResolution: vi.fn(async () => undefined),
      // YOLO hands-off Sync (issue 2-13): a sync+commit+apply Operation; the bridge must
      // forward the _trace id like every other den:* channel.
      yoloSync: vi.fn(async () => ({
        autoCommitEnabled: true,
        autoCommit: { committedPaths: [], skipped: [], commit: null },
        push: null,
        conflicts: [],
        autoMerged: true,
        autoApplied: {
          autoApplyEnabled: true,
          applied: { results: [], applied: [], failed: [] },
          needsReview: [],
        },
      })),
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
      getPrivacySettings: async () => ({
        analyticsEnabled: false,
        crashReportsEnabled: false,
        diagnosticLogsEnabled: false,
      }),
      setPrivacySettings: async (settings) => settings,
      launchState: async () => ({ status: 'ready' as const }),
      getAppInfo: async () => ({ version: '1.2.0', platform: 'linux' }),
      checkForUpdates: async () => ({
        status: 'unavailable' as const,
        currentVersion: '1.2.0',
        latestVersion: null,
        detail: 'No update feed is configured for this build yet.',
      }),
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
    await handlers.get('den:yolo-sync')?.({}, { _trace: { traceId: 'c5' } } as never)

    // detect is a sync Operation; resolve/complete/abort MUTATE the merge — all forward the id.
    expect(den.detectConflicts).toHaveBeenCalledWith('c1')
    expect(den.resolveConflictFile).toHaveBeenCalledWith('dot_zshrc', 'incoming', 'c2')
    expect(den.completeConflictResolution).toHaveBeenCalledWith('c3')
    expect(den.abortConflictResolution).toHaveBeenCalledWith('c4')
    // YOLO hands-off Sync forwards its _trace id like every other den:* channel (2-13).
    expect(den.yoloSync).toHaveBeenCalledWith('c5')

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
      getPrivacySettings: async () => ({
        analyticsEnabled: false,
        crashReportsEnabled: false,
        diagnosticLogsEnabled: false,
      }),
      setPrivacySettings: async (settings) => settings,
      launchState: async () => ({ status: 'ready' as const }),
      getAppInfo: async () => ({ version: '1.2.0', platform: 'linux' }),
      checkForUpdates: async () => ({
        status: 'unavailable' as const,
        currentVersion: '1.2.0',
        latestVersion: null,
        detail: 'No update feed is configured for this build yet.',
      }),
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

    // Each organize verb MUTATES `.dotden/`, so the bridge forwards its trace id.
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
      getPrivacySettings: async () => ({
        analyticsEnabled: false,
        crashReportsEnabled: false,
        diagnosticLogsEnabled: false,
      }),
      setPrivacySettings: async (settings) => settings,
      launchState: async () => ({ status: 'ready' as const }),
      getAppInfo: async () => ({ version: '1.2.0', platform: 'linux' }),
      checkForUpdates: async () => ({
        status: 'unavailable' as const,
        currentVersion: '1.2.0',
        latestVersion: null,
        detail: 'No update feed is configured for this build yet.',
      }),
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
      getPrivacySettings: async () => ({
        analyticsEnabled: false,
        crashReportsEnabled: false,
        diagnosticLogsEnabled: false,
      }),
      setPrivacySettings: async (settings) => settings,
      launchState: async () => ({ status: 'ready' as const }),
      getAppInfo: async () => ({ version: '1.2.0', platform: 'linux' }),
      checkForUpdates: async () => ({
        status: 'unavailable' as const,
        currentVersion: '1.2.0',
        latestVersion: null,
        detail: 'No update feed is configured for this build yet.',
      }),
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
      getPrivacySettings: async () => ({
        analyticsEnabled: false,
        crashReportsEnabled: false,
        diagnosticLogsEnabled: false,
      }),
      setPrivacySettings: async (settings) => settings,
      launchState: async () => ({ status: 'ready' as const }),
      getAppInfo: async () => ({ version: '1.2.0', platform: 'linux' }),
      checkForUpdates: async () => ({
        status: 'unavailable' as const,
        currentVersion: '1.2.0',
        latestVersion: null,
        detail: 'No update feed is configured for this build yet.',
      }),
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
      getPrivacySettings: async () => ({
        analyticsEnabled: false,
        crashReportsEnabled: false,
        diagnosticLogsEnabled: false,
      }),
      setPrivacySettings: async (settings) => settings,
      launchState: async () => ({ status: 'ready' as const }),
      getAppInfo: async () => ({ version: '1.2.0', platform: 'linux' }),
      checkForUpdates: async () => ({
        status: 'unavailable' as const,
        currentVersion: '1.2.0',
        latestVersion: null,
        detail: 'No update feed is configured for this build yet.',
      }),
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
      reassign: vi.fn(async () => [selfEntry]),
      retire: vi.fn(async () => [selfEntry]),
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
      getPrivacySettings: async () => ({
        analyticsEnabled: false,
        crashReportsEnabled: false,
        diagnosticLogsEnabled: false,
      }),
      setPrivacySettings: async (settings) => settings,
      launchState: async () => ({ status: 'ready' as const }),
      getAppInfo: async () => ({ version: '1.2.0', platform: 'linux' }),
      checkForUpdates: async () => ({
        status: 'unavailable' as const,
        currentVersion: '1.2.0',
        latestVersion: null,
        detail: 'No update feed is configured for this build yet.',
      }),
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

    // Lifecycle (issue 2-15): reassign folds a duplicate into a keeper; retire drops an entry.
    // Both forward their ids verbatim to the registry owner (which holds the guards) and return
    // the refreshed list — the bridge never re-checks the never-auto-merge / self-protect rules.
    await expect(
      handlers.get('env:reassign')?.({}, {
        fromId: 'env-dup',
        intoId: 'env-self',
        _trace: { traceId: 'e4' },
      } as never),
    ).resolves.toEqual([selfEntry])
    expect(registry.reassign).toHaveBeenCalledWith('env-dup', 'env-self')
    await expect(
      handlers.get('env:retire')?.({}, { envId: 'env-old', _trace: { traceId: 'e5' } } as never),
    ).resolves.toEqual([selfEntry])
    expect(registry.retire).toHaveBeenCalledWith('env-old')

    // Every env:* channel still hard-fails without a _trace envelope.
    await expect(handlers.get('env:list')?.({}, {} as never)).rejects.toThrow(
      'without a _trace envelope',
    )
    await expect(handlers.get('env:reassign')?.({}, {} as never)).rejects.toThrow(
      'without a _trace envelope',
    )
    await expect(handlers.get('env:retire')?.({}, {} as never)).rejects.toThrow(
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
      getPrivacySettings: async () => ({
        analyticsEnabled: false,
        crashReportsEnabled: false,
        diagnosticLogsEnabled: false,
      }),
      setPrivacySettings: async (settings) => settings,
      launchState: async () => ({ status: 'ready' as const }),
      getAppInfo: async () => ({ version: '1.2.0', platform: 'linux' }),
      checkForUpdates: async () => ({
        status: 'unavailable' as const,
        currentVersion: '1.2.0',
        latestVersion: null,
        detail: 'No update feed is configured for this build yet.',
      }),
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
      getPrivacySettings: async () => ({
        analyticsEnabled: false,
        crashReportsEnabled: false,
        diagnosticLogsEnabled: false,
      }),
      setPrivacySettings: async (settings) => settings,
      launchState: async () => ({ status: 'ready' as const }),
      getAppInfo: async () => ({ version: '1.2.0', platform: 'linux' }),
      checkForUpdates: async () => ({
        status: 'unavailable' as const,
        currentVersion: '1.2.0',
        latestVersion: null,
        detail: 'No update feed is configured for this build yet.',
      }),
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

  it('routes the privacy:* consent channels and asserts _trace (issue 2-14)', async () => {
    const getPrivacySettings = vi.fn(async () => ({
      analyticsEnabled: false,
      crashReportsEnabled: false,
      diagnosticLogsEnabled: false,
    }))
    // setPrivacySettings echoes the persisted consent back (control surface only — NO egress).
    const setPrivacySettings = vi.fn(async (settings: PrivacySettings) => settings)
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
      getSyncSettings: async () => ({
        pollerEnabled: true,
        cadence: 'fast' as const,
        startOnLogin: false,
      }),
      setSyncSettings: async (settings) => settings,
      getPrivacySettings,
      setPrivacySettings,
      launchState: async () => ({ status: 'ready' as const }),
      getAppInfo: async () => ({ version: '1.2.0', platform: 'linux' }),
      checkForUpdates: async () => ({
        status: 'unavailable' as const,
        currentVersion: '1.2.0',
        latestVersion: null,
        detail: 'No update feed is configured for this build yet.',
      }),
    })

    // get-settings forwards this environment's telemetry consent — all off out of the box.
    await expect(
      handlers.get('privacy:get-settings')?.({}, { _trace: { traceId: 'p1' } } as never),
    ).resolves.toEqual({
      analyticsEnabled: false,
      crashReportsEnabled: false,
      diagnosticLogsEnabled: false,
    })
    // set-settings forwards the chosen consent so index.ts can persist it (no egress here).
    const next: PrivacySettings = {
      analyticsEnabled: true,
      crashReportsEnabled: false,
      diagnosticLogsEnabled: true,
    }
    await handlers.get('privacy:set-settings')?.({}, {
      settings: next,
      _trace: { traceId: 'p2' },
    } as never)
    expect(setPrivacySettings).toHaveBeenCalledWith(next)

    // Both channels still hard-fail without a _trace envelope (uniform correlation).
    await expect(handlers.get('privacy:set-settings')?.({}, {} as never)).rejects.toThrow(
      'without a _trace envelope',
    )
  })

  it('routes the app:* info + update-check channels and asserts _trace (issue 2-16)', async () => {
    const getAppInfo = vi.fn(async () => ({ version: '1.2.0', platform: 'linux' }))
    // The placeholder update check: honestly unavailable until the real feed lands (issue 3-20).
    const checkForUpdates = vi.fn(async () => ({
      status: 'unavailable' as const,
      currentVersion: '1.2.0',
      latestVersion: null,
      detail: 'No update feed is configured for this build yet.',
    }))
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
      getSyncSettings: async () => ({
        pollerEnabled: true,
        cadence: 'fast' as const,
        startOnLogin: false,
      }),
      setSyncSettings: async (settings) => settings,
      getPrivacySettings: async () => ({
        analyticsEnabled: false,
        crashReportsEnabled: false,
        diagnosticLogsEnabled: false,
      }),
      setPrivacySettings: async (settings) => settings,
      launchState: async () => ({ status: 'ready' as const }),
      getAppInfo,
      checkForUpdates,
    })

    // get-info forwards the running build's version + platform for the About tab.
    await expect(
      handlers.get('app:get-info')?.({}, { _trace: { traceId: 'i1' } } as never),
    ).resolves.toEqual({ version: '1.2.0', platform: 'linux' })
    expect(getAppInfo).toHaveBeenCalledTimes(1)
    // check-updates returns the honest result (unavailable until issue 3-20 wires a real feed).
    await expect(
      handlers.get('app:check-updates')?.({}, { _trace: { traceId: 'i2' } } as never),
    ).resolves.toMatchObject({ status: 'unavailable', detail: expect.any(String) })
    expect(checkForUpdates).toHaveBeenCalledTimes(1)

    // Both channels still hard-fail without a _trace envelope (uniform correlation).
    await expect(handlers.get('app:get-info')?.({}, {} as never)).rejects.toThrow(
      'without a _trace envelope',
    )
    await expect(handlers.get('app:check-updates')?.({}, {} as never)).rejects.toThrow(
      'without a _trace envelope',
    )
  })

  it('traceId() throws on a missing or empty id', () => {
    expect(() => traceId({ _trace: { traceId: '' } })).toThrow()
    expect(() => traceId({} as never)).toThrow()
    expect(traceId({ _trace: { traceId: 'ok' } })).toBe('ok')
  })
})
