import { contextBridge, ipcRenderer } from 'electron'
import type {
  ConnectResult,
  PreflightResult,
  TraceEnvelope,
} from '../main/foundation/remote-client.js'

function trace(): TraceEnvelope {
  return { traceId: crypto.randomUUID() }
}

const api = {
  platform: process.platform,
  versions: {
    node: process.versions.node,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
  remote: {
    preflight(url: string): Promise<PreflightResult> {
      return ipcRenderer.invoke('remote:preflight', {
        url,
        _trace: trace(),
      }) as Promise<PreflightResult>
    },
    connect(url: string): Promise<ConnectResult> {
      return ipcRenderer.invoke('remote:connect', {
        url,
        _trace: trace(),
      }) as Promise<ConnectResult>
    },
    latestSha(url: string, branch = 'main'): Promise<string | null> {
      return ipcRenderer.invoke('remote:latest-sha', { url, branch, _trace: trace() }) as Promise<
        string | null
      >
    },
  },
}

contextBridge.exposeInMainWorld('dotden', api)
