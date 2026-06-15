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
}

contextBridge.exposeInMainWorld('dotden', api)
