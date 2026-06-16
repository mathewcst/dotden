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
    // → IPC channel 'den:incoming-summary' (Review & Apply: incoming + source env label)
    incomingSummary() {
      return ipcRenderer.invoke('den:incoming-summary', {
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['incomingSummary']>
    },
    // → IPC channel 'den:incoming-diff' (preview an incoming File before Apply)
    incomingDiff(targetPath) {
      return ipcRenderer.invoke('den:incoming-diff', {
        targetPath,
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['incomingDiff']>
    },
    // → IPC channel 'den:apply'
    apply(targetPaths, confirmedDeletions) {
      return ipcRenderer.invoke('den:apply', {
        targetPaths,
        // The deletions the user explicitly confirmed (invariant #4); omitted ⇒ none.
        confirmedDeletions: confirmedDeletions ?? [],
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['apply']>
    },
    // → IPC channel 'den:detect-conflicts' (fetch + merge; surface true Conflicts, 1-11)
    detectConflicts() {
      return ipcRenderer.invoke('den:detect-conflicts', {
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['detectConflicts']>
    },
    // → IPC channel 'den:resolve-conflict' (the user's explicit Keep mine/Take theirs/Open both)
    resolveConflict(targetPath, choice) {
      return ipcRenderer.invoke('den:resolve-conflict', {
        targetPath,
        choice,
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['resolveConflict']>
    },
    // → IPC channel 'den:complete-conflicts' (Apply resolution: commit the pending merge)
    completeConflictResolution() {
      return ipcRenderer.invoke('den:complete-conflicts', {
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['completeConflictResolution']>
    },
    // → IPC channel 'den:abort-conflicts' (Abort: git merge --abort, resolves nothing)
    abortConflicts() {
      return ipcRenderer.invoke('den:abort-conflicts', {
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['abortConflicts']>
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
    // → IPC channel 'den:untrack' (the Untrack verb → chezmoi forget)
    untrack(targetPath) {
      return ipcRenderer.invoke('den:untrack', {
        targetPath,
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['untrack']>
    },
    // → IPC channel 'den:delete-everywhere' (the Delete everywhere verb → chezmoi destroy)
    deleteEverywhere(targetPath) {
      return ipcRenderer.invoke('den:delete-everywhere', {
        targetPath,
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['deleteEverywhere']>
    },
    // → IPC channel 'den:affected-environments' (blast radius for the destructive confirm)
    affectedEnvironments(targetPath) {
      return ipcRenderer.invoke('den:affected-environments', {
        targetPath,
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['affectedEnvironments']>
    },
    // → IPC channel 'den:create-workspace' (new access boundary, issue 1-14)
    createWorkspace(label) {
      return ipcRenderer.invoke('den:create-workspace', {
        label,
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['createWorkspace']>
    },
    // → IPC channel 'den:create-group' (nested organization Group, issue 1-14)
    createGroup(workspaceId, label, parentId) {
      return ipcRenderer.invoke('den:create-group', {
        workspaceId,
        label,
        parentId,
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['createGroup']>
    },
    // → IPC channel 'den:move-to-group' (organize-only: never changes access or path)
    moveFileToGroup(targetPath, groupId) {
      return ipcRenderer.invoke('den:move-to-group', {
        targetPath,
        groupId,
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['moveFileToGroup']>
    },
    // → IPC channel 'den:set-file-workspace' (access-boundary move, issue 1-14)
    setFileWorkspace(targetPath, workspaceId) {
      return ipcRenderer.invoke('den:set-file-workspace', {
        targetPath,
        workspaceId,
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['setFileWorkspace']>
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
  automation: {
    // → IPC channel 'automation:get-level' (environment-local automation rung, issue 1-12)
    getLevel() {
      return ipcRenderer.invoke('automation:get-level', {
        _trace: trace(),
      }) as ReturnType<DotdenApi['automation']['getLevel']>
    },
    // → IPC channel 'automation:set-level' (the onboarding opt-in + Settings toggle)
    setLevel(level) {
      return ipcRenderer.invoke('automation:set-level', {
        level,
        _trace: trace(),
      }) as ReturnType<DotdenApi['automation']['setLevel']>
    },
  },
  trayPoller: {
    // ← main→renderer push: the TrayPoller fires 'tray-poller:incoming' when the Remote
    // moved (issue 1-12). We wrap the raw IPC listener so the renderer callback never sees
    // the Electron event object (keeping the contract narrow, ADR 0004) and return an
    // unsubscribe that removes exactly this listener.
    onIncoming(listener) {
      const handler = () => listener()
      ipcRenderer.on('tray-poller:incoming', handler)
      return () => ipcRenderer.removeListener('tray-poller:incoming', handler)
    },
  },
}

contextBridge.exposeInMainWorld('dotden', api)
