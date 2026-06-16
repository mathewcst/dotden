/**
 * Preload — the single trusted main↔renderer bridge.
 *
 * Runs in the isolated preload world with `contextIsolation` on and the renderer
 * sandboxed (ADR 0004). It is the ONLY code that may hand the renderer a handle
 * onto privileged IPC, so the exposed surface is kept deliberately narrow: it
 * forwards a small, fixed set of `remote:*` operations to the main process and
 * exposes read-only environment info — nothing else.
 *
 * The exposed object is typed against {@link DotdenApi}, the shared contract the
 * renderer also consumes, so preload and renderer can never silently drift.
 */
import { contextBridge, ipcRenderer } from 'electron'
import type { TraceEnvelope } from '../main/foundation/remote-client.js'
import type { DotdenApi } from '../shared/ipc-api.js'

/** Mint a fresh correlation id per user action so each operation is independently traceable. */
function trace(): TraceEnvelope {
  return { traceId: crypto.randomUUID() }
}

const api: DotdenApi = {
  platform: process.platform,
  versions: {
    node: process.versions.node,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
  remote: {
    // → IPC channel 'remote:preflight'
    preflight(url) {
      return ipcRenderer.invoke('remote:preflight', {
        url,
        _trace: trace(),
      }) as ReturnType<DotdenApi['remote']['preflight']>
    },
    // → IPC channel 'remote:connect'
    connect(url) {
      return ipcRenderer.invoke('remote:connect', {
        url,
        _trace: trace(),
      }) as ReturnType<DotdenApi['remote']['connect']>
    },
    // → IPC channel 'remote:latest-sha'
    latestSha(url, branch = 'main') {
      return ipcRenderer.invoke('remote:latest-sha', {
        url,
        branch,
        _trace: trace(),
      }) as ReturnType<DotdenApi['remote']['latestSha']>
    },
  },
  den: {
    // → IPC channel 'den:track'
    track(targetPath) {
      return ipcRenderer.invoke('den:track', {
        targetPath,
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['track']>
    },
    // → IPC channel 'den:commit'
    commit(targetPaths) {
      return ipcRenderer.invoke('den:commit', {
        targetPaths,
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['commit']>
    },
    // → IPC channel 'den:sync-push'
    syncPush() {
      return ipcRenderer.invoke('den:sync-push', {
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['syncPush']>
    },
    // → IPC channel 'den:list-incoming'
    listIncoming() {
      return ipcRenderer.invoke('den:list-incoming', {
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['listIncoming']>
    },
    // → IPC channel 'den:apply'
    apply(targetPaths) {
      return ipcRenderer.invoke('den:apply', {
        targetPaths,
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['apply']>
    },
    // → IPC channel 'den:tree'
    tree() {
      return ipcRenderer.invoke('den:tree', {
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['tree']>
    },
    // → IPC channel 'den:diff'
    diff(targetPath) {
      return ipcRenderer.invoke('den:diff', {
        targetPath,
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['diff']>
    },
  },
  discover: {
    // → IPC channel 'discover:scan'
    scan() {
      return ipcRenderer.invoke('discover:scan', {
        _trace: trace(),
      }) as ReturnType<DotdenApi['discover']['scan']>
    },
    // → IPC channel 'discover:inspect-path'
    inspectPath(targetPath) {
      return ipcRenderer.invoke('discover:inspect-path', {
        targetPath,
        _trace: trace(),
      }) as ReturnType<DotdenApi['discover']['inspectPath']>
    },
  },
  environment: {
    // → IPC channel 'env:list'
    list() {
      return ipcRenderer.invoke('env:list', {
        _trace: trace(),
      }) as ReturnType<DotdenApi['environment']['list']>
    },
    // → IPC channel 'env:rename'
    rename(label) {
      return ipcRenderer.invoke('env:rename', {
        label,
        _trace: trace(),
      }) as ReturnType<DotdenApi['environment']['rename']>
    },
    // → IPC channel 'env:suggest-claims'
    suggestClaims() {
      return ipcRenderer.invoke('env:suggest-claims', {
        _trace: trace(),
      }) as ReturnType<DotdenApi['environment']['suggestClaims']>
    },
  },
}

contextBridge.exposeInMainWorld('dotden', api)
