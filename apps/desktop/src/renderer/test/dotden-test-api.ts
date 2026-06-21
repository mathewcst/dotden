import { vi } from 'vitest'
import type { DotdenApi } from '@shared/ipc-api'

type DeepPartial<T> = {
  [K in keyof T]?: T[K] extends (...args: never[]) => unknown ? T[K] : DeepPartial<T[K]>
}

function mergeDotdenApi(base: DotdenApi, overrides: DeepPartial<DotdenApi>): DotdenApi {
  return {
    ...base,
    ...overrides,
    versions: { ...base.versions, ...overrides.versions },
    window: { ...base.window, ...overrides.window },
    diagnostics: { ...base.diagnostics, ...overrides.diagnostics },
    remote: { ...base.remote, ...overrides.remote },
    den: { ...base.den, ...overrides.den },
    discover: { ...base.discover, ...overrides.discover },
    environment: { ...base.environment, ...overrides.environment },
    automation: { ...base.automation, ...overrides.automation },
    sync: { ...base.sync, ...overrides.sync },
    privacy: { ...base.privacy, ...overrides.privacy },
    app: { ...base.app, ...overrides.app },
    trayPoller: { ...base.trayPoller, ...overrides.trayPoller },
    net: { ...base.net, ...overrides.net },
  }
}

/**
 * Install a typed `window.dotden` stub for rendered-component tests. Tests override only the IPC
 * methods their component calls; every other method rejects loudly if reached.
 */
export function installDotdenTestApi(overrides: DeepPartial<DotdenApi> = {}): DotdenApi {
  const unimplemented = vi.fn(async () => {
    throw new Error('Unexpected window.dotden call in rendered-component test')
  })
  const base: DotdenApi = {
    platform: 'linux',
    versions: { node: 'test', electron: 'test', chrome: 'test' },
    window: {
      minimize: unimplemented,
      toggleMaximize: vi.fn(async () => false),
      close: unimplemented,
    },
    diagnostics: {
      openLogLocation: unimplemented,
      recordsFor: vi.fn(async () => []),
      copyDiagnostics: vi.fn(async () => ({ recordCount: 0 })),
      getSettings: vi.fn(async () => ({ consoleEnabled: false })),
      setSettings: vi.fn(async (settings) => settings),
      getUnredactedMode: vi.fn(async () => ({ enabled: false })),
      setUnredactedMode: vi.fn(async (enabled: boolean) => ({ enabled })),
    },
    remote: {
      preflight: vi.fn(async () => ({ reachable: true, gitCommand: 'git' })),
      connect: vi.fn(async () => ({
        gitCommand: 'git',
        sourceDir: '/tmp/source',
        repositoryKind: 'dotden' as const,
      })),
      cancel: vi.fn(async () => true),
      latestSha: vi.fn(async () => null),
    },
    den: {
      launchState: vi.fn(async () => ({ status: 'fresh' as const })),
      registerEnvironment: unimplemented,
      track: unimplemented,
      scanCommit: vi.fn(async () => []),
      allowlistSecret: unimplemented,
      commitTemplate: unimplemented,
      setCommitTemplate: unimplemented,
      appearanceSettings: unimplemented,
      appearanceState: unimplemented,
      setAppearanceSettings: unimplemented,
      setAppearanceOverride: unimplemented,
      detectPasswordManagers: vi.fn(async () => []),
      pmPreference: vi.fn(async () => null),
      convertSecret: unimplemented,
      commit: unimplemented,
      syncPush: unimplemented,
      flushPushQueue: unimplemented,
      pushPending: vi.fn(async () => false),
      listIncoming: vi.fn(async () => []),
      incomingSummary: unimplemented,
      incomingDiff: unimplemented,
      apply: unimplemented,
      autoApply: unimplemented,
      yoloSync: unimplemented,
      detectConflicts: unimplemented,
      resolveConflict: unimplemented,
      completeConflictResolution: unimplemented,
      abortConflicts: unimplemented,
      tree: unimplemented,
      diff: unimplemented,
      connectedRemote: unimplemented,
      fileHistory: vi.fn(async () => []),
      fileVersionDiff: unimplemented,
      restoreVersion: unimplemented,
      untrack: unimplemented,
      discardLocalChange: unimplemented,
      deleteEverywhere: unimplemented,
      affectedEnvironments: vi.fn(async () => []),
      createWorkspace: unimplemented,
      createGroup: unimplemented,
      moveFileToGroup: unimplemented,
      setFileWorkspace: unimplemented,
      setFileScope: unimplemented,
      setGroupScope: unimplemented,
      subscriptionState: vi.fn(async () => ({
        workspaces: [],
        registered: false,
        emptyDenWarning: null,
      })),
      setSubscriptions: unimplemented,
      unsubscribeWorkspace: unimplemented,
      unsubscribeDisposition: vi.fn(async () => 'keep' as const),
      rememberUnsubscribeDisposition: unimplemented,
    },
    discover: {
      scan: vi.fn(async () => ({ suggestions: [] })),
      inspectPath: vi.fn(async () => null),
      browse: vi.fn(async () => null),
      pathForFile: vi.fn(() => null),
    },
    environment: {
      list: vi.fn(async () => []),
      rename: unimplemented,
      suggestClaims: vi.fn(async () => []),
      registerNew: vi.fn(async () => []),
      claim: vi.fn(async () => []),
      reassign: vi.fn(async () => []),
      retire: vi.fn(async () => []),
    },
    automation: {
      getLevel: vi.fn(async () => 'manual' as const),
      setLevel: unimplemented,
    },
    sync: {
      getSettings: vi.fn(async () => ({
        pollerEnabled: true,
        cadence: 'fast' as const,
        startOnLogin: false,
      })),
      setSettings: vi.fn(async (settings) => settings),
    },
    privacy: {
      getSettings: vi.fn(async () => ({
        analyticsEnabled: false,
        crashReportsEnabled: false,
        diagnosticLogsEnabled: false,
      })),
      setSettings: vi.fn(async (settings) => settings),
    },
    app: {
      getInfo: vi.fn(async () => ({ version: '0.0.0', platform: 'linux' })),
      checkForUpdates: vi.fn(async () => ({
        status: 'unavailable' as const,
        currentVersion: '0.0.0',
        latestVersion: null,
        detail: 'No feed configured.',
        checkedAt: '2026-06-21T00:00:00.000Z',
      })),
      getUpdateSettings: vi.fn(async () => ({
        autoUpdateEnabled: true,
        channel: 'stable' as const,
        lastCheckedAt: null,
      })),
      setUpdateSettings: vi.fn(async (settings) => settings),
      onUpdateDownloaded: vi.fn(() => () => undefined),
      quitAndInstallUpdate: unimplemented,
    },
    trayPoller: {
      onIncoming: vi.fn(() => () => undefined),
      onAutomationAction: vi.fn(() => () => undefined),
    },
    net: {
      onReconnected: vi.fn(() => () => undefined),
    },
  }

  const api = mergeDotdenApi(base, overrides)
  Object.defineProperty(window, 'dotden', { configurable: true, value: api })
  return api
}
