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
    // → IPC channel 'den:scan-commit' (commit-time secret scan + warn step, issue 2-03)
    scanCommit(targetPaths) {
      return ipcRenderer.invoke('den:scan-commit', {
        targetPaths,
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['scanCommit']>
    },
    // → IPC channel 'den:allowlist-secret' (synced "don't warn me about this File again", issue 2-04)
    allowlistSecret(finding) {
      return ipcRenderer.invoke('den:allowlist-secret', {
        finding,
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['allowlistSecret']>
    },
    // → IPC channel 'den:get-commit-template' (Settings → Commit tab: synced template + preview facts, issue 2-09)
    commitTemplate() {
      return ipcRenderer.invoke('den:get-commit-template', {
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['commitTemplate']>
    },
    // → IPC channel 'den:set-commit-template' (persist synced template + Commit `.myenv/`, issue 2-09)
    setCommitTemplate(template) {
      return ipcRenderer.invoke('den:set-commit-template', {
        template,
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['setCommitTemplate']>
    },
    // → IPC channel 'den:get-appearance' (Settings → Appearance tab: synced theme + Apply/notify defaults, issue 2-10)
    appearanceSettings() {
      return ipcRenderer.invoke('den:get-appearance', {
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['appearanceSettings']>
    },
    // → IPC channel 'den:set-appearance' (persist synced appearance settings + Commit `.myenv/`, issue 2-10)
    setAppearanceSettings(settings) {
      return ipcRenderer.invoke('den:set-appearance', {
        settings,
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['setAppearanceSettings']>
    },
    // → IPC channel 'den:detect-password-managers' (PM picker detection, issue 2-05; env-local)
    detectPasswordManagers() {
      return ipcRenderer.invoke('den:detect-password-managers', {
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['detectPasswordManagers']>
    },
    // → IPC channel 'den:pm-preference' (env-local "Remember my choice" default, issue 2-05)
    pmPreference() {
      return ipcRenderer.invoke('den:pm-preference', {
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['pmPreference']>
    },
    // → IPC channel 'den:convert-secret' (write the `.tmpl` reference + Commit it, issue 2-05)
    convertSecret(request) {
      return ipcRenderer.invoke('den:convert-secret', {
        request,
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['convertSecret']>
    },
    // → IPC channel 'den:commit'
    commit(targetPaths) {
      return ipcRenderer.invoke('den:commit', {
        targetPaths,
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['commit']>
    },
    // → IPC channel 'den:sync-push' (push + flush any offline-queued push, issue 1-16)
    syncPush() {
      return ipcRenderer.invoke('den:sync-push', {
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['syncPush']>
    },
    // → IPC channel 'den:flush-push-queue' (retry a push queued while offline, issue 1-16)
    flushPushQueue() {
      return ipcRenderer.invoke('den:flush-push-queue', {
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['flushPushQueue']>
    },
    // → IPC channel 'den:push-pending' (offline-banner state: is a push queued?, issue 1-16)
    pushPending() {
      return ipcRenderer.invoke('den:push-pending', {
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['pushPending']>
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
    // → IPC channel 'den:file-history' (per-File version list from git log, issue 2-01)
    fileHistory(targetPath) {
      return ipcRenderer.invoke('den:file-history', {
        targetPath,
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['fileHistory']>
    },
    // → IPC channel 'den:file-version-diff' (read-only preview of one version, issue 2-01)
    fileVersionDiff(targetPath, sha) {
      return ipcRenderer.invoke('den:file-version-diff', {
        targetPath,
        sha,
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['fileVersionDiff']>
    },
    // → IPC channel 'den:restore-version' (restore-forward → new Commit, never rewrite, issue 2-02)
    restoreVersion(targetPath, sha) {
      return ipcRenderer.invoke('den:restore-version', {
        targetPath,
        sha,
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['restoreVersion']>
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
    // → IPC channel 'den:set-file-scope' (OS Scope: clamp+narrow to specific OSes, issue 1-15)
    setFileScope(targetPath, scope) {
      return ipcRenderer.invoke('den:set-file-scope', {
        targetPath,
        scope,
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['setFileScope']>
    },
    // → IPC channel 'den:set-group-scope' (OS Scope of a Folder/Group, inherited by children)
    setGroupScope(workspaceId, groupId, scope) {
      return ipcRenderer.invoke('den:set-group-scope', {
        workspaceId,
        groupId,
        scope,
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['setGroupScope']>
    },
    // → IPC channel 'den:subscription-state' (returning-flow subscription pick + empty-Den guard)
    subscriptionState() {
      return ipcRenderer.invoke('den:subscription-state', {
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['subscriptionState']>
    },
    // → IPC channel 'den:set-subscriptions' (pick which Workspaces this environment applies)
    setSubscriptions(workspaceIds) {
      return ipcRenderer.invoke('den:set-subscriptions', {
        workspaceIds,
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['setSubscriptions']>
    },
    // → IPC channel 'den:unsubscribe-workspace' (drop a Workspace + keep/remove its Files here)
    unsubscribeWorkspace(workspaceId, disposition) {
      return ipcRenderer.invoke('den:unsubscribe-workspace', {
        workspaceId,
        disposition,
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['unsubscribeWorkspace']>
    },
    // → IPC channel 'den:unsubscribe-disposition' (read the remembered keep/remove default)
    unsubscribeDisposition() {
      return ipcRenderer.invoke('den:unsubscribe-disposition', {
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['unsubscribeDisposition']>
    },
    // → IPC channel 'den:remember-unsubscribe-disposition' (persist "don't ask me again")
    rememberUnsubscribeDisposition(disposition) {
      return ipcRenderer.invoke('den:remember-unsubscribe-disposition', {
        disposition,
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['rememberUnsubscribeDisposition']>
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
    // → IPC channel 'env:register-new' (the "new" branch of the new-or-returning fork)
    registerNew(workspaceIds) {
      return ipcRenderer.invoke('env:register-new', {
        workspaceIds,
        _trace: trace(),
      }) as ReturnType<DotdenApi['environment']['registerNew']>
    },
    // → IPC channel 'env:claim' (the "returning" branch: adopt an existing entry's id + history)
    claim(envId, workspaceIds) {
      return ipcRenderer.invoke('env:claim', {
        envId,
        workspaceIds,
        _trace: trace(),
      }) as ReturnType<DotdenApi['environment']['claim']>
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
  sync: {
    // → IPC channel 'sync:get-settings' (env-local poller on/off · cadence · autostart, issue 2-08)
    getSettings() {
      return ipcRenderer.invoke('sync:get-settings', {
        _trace: trace(),
      }) as ReturnType<DotdenApi['sync']['getSettings']>
    },
    // → IPC channel 'sync:set-settings' (persist + re-arm poller + apply OS autostart, issue 2-08)
    setSettings(settings) {
      return ipcRenderer.invoke('sync:set-settings', {
        settings,
        _trace: trace(),
      }) as ReturnType<DotdenApi['sync']['setSettings']>
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
  net: {
    // ← main→renderer push: after a `powerMonitor` wake flushes queued pushes (issue 1-16),
    // the main process fires 'net:reconnected' so an open window re-reads pushPending() and
    // updates its offline banner. Wrapped so the renderer callback never sees the Electron
    // event object (narrow contract, ADR 0004); returns an unsubscribe for this listener.
    onReconnected(listener) {
      const handler = () => listener()
      ipcRenderer.on('net:reconnected', handler)
      return () => ipcRenderer.removeListener('net:reconnected', handler)
    },
  },
}

contextBridge.exposeInMainWorld('dotden', api)
