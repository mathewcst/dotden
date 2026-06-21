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
import type { TraceEnvelope } from '../shared/remote.js'
import type { DotdenApi } from '../shared/ipc-api.js'

/** Mint a fresh correlation id per user action so each operation is independently traceable. */
function trace(): TraceEnvelope {
  return { traceId: crypto.randomUUID() }
}

/**
 * Invoke an IPC route with a fresh trace and attach that trace to thrown renderer-side errors.
 * Electron preserves the message but the renderer still needs this id to open trace-filtered
 * Diagnostics after a failed Operation.
 */
function invokeWithTrace<T>(
  channel: string,
  payload: Record<string, unknown> = {},
): Promise<T> {
  const _trace = trace()
  return ipcRenderer
    .invoke(channel, {
      ...payload,
      _trace,
    })
    .catch((caught: unknown) => {
      if (typeof caught === 'object' && caught !== null) {
        ;(caught as { traceId?: string }).traceId = _trace.traceId
      }
      throw caught
    }) as Promise<T>
}

const api: DotdenApi = {
  platform: process.platform,
  versions: {
    node: process.versions.node,
    electron: process.versions.electron,
    chrome: process.versions.chrome,
  },
  window: {
    // → IPC channel 'window:minimize' (frameless titlebar minimize button)
    minimize() {
      return ipcRenderer.invoke('window:minimize', {
        _trace: trace(),
      }) as ReturnType<DotdenApi['window']['minimize']>
    },
    // → IPC channel 'window:toggle-maximize' (frameless titlebar maximize/restore button)
    toggleMaximize() {
      return ipcRenderer.invoke('window:toggle-maximize', {
        _trace: trace(),
      }) as ReturnType<DotdenApi['window']['toggleMaximize']>
    },
    // → IPC channel 'window:close' (frameless titlebar close button)
    close() {
      return ipcRenderer.invoke('window:close', {
        _trace: trace(),
      }) as ReturnType<DotdenApi['window']['close']>
    },
  },
  diagnostics: {
    // → IPC channel 'diagnostics:open-log-location' (reveal redacted log file under userData)
    openLogLocation() {
      return ipcRenderer.invoke('diagnostics:open-log-location', {
        _trace: trace(),
      }) as ReturnType<DotdenApi['diagnostics']['openLogLocation']>
    },
    // → IPC channel 'diagnostics:records' (read already-redacted Command records)
    recordsFor(traceId) {
      return ipcRenderer.invoke('diagnostics:records', {
        traceId,
        _trace: trace(),
      }) as ReturnType<DotdenApi['diagnostics']['recordsFor']>
    },
    // → IPC channel 'diagnostics:copy' (copy a redacted support bundle to the clipboard)
    copyDiagnostics(traceId) {
      return ipcRenderer.invoke('diagnostics:copy', {
        traceId,
        _trace: trace(),
      }) as ReturnType<DotdenApi['diagnostics']['copyDiagnostics']>
    },
    // → IPC channel 'diagnostics:get-settings' (standing Console preference)
    getSettings() {
      return ipcRenderer.invoke('diagnostics:get-settings', {
        _trace: trace(),
      }) as ReturnType<DotdenApi['diagnostics']['getSettings']>
    },
    // → IPC channel 'diagnostics:set-settings' (persist standing Console preference)
    setSettings(settings) {
      return ipcRenderer.invoke('diagnostics:set-settings', {
        settings,
        _trace: trace(),
      }) as ReturnType<DotdenApi['diagnostics']['setSettings']>
    },
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
    // → IPC channel 'den:launch-state' (boot gate: fresh|incomplete|ready, ADR 0026)
    launchState() {
      return ipcRenderer.invoke('den:launch-state', {
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['launchState']>
    },
    // → IPC channel 'den:register-environment' (first-run setup even with zero tracked Files)
    registerEnvironment() {
      return ipcRenderer.invoke('den:register-environment', {
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['registerEnvironment']>
    },
    // → IPC channel 'den:track'
    track(targetPath) {
      return invokeWithTrace('den:track', {
        targetPath,
      }) as ReturnType<DotdenApi['den']['track']>
    },
    // → IPC channel 'den:scan-commit' (commit-time secret scan + warn step, issue 2-03)
    scanCommit(targetPaths) {
      return invokeWithTrace('den:scan-commit', {
        targetPaths,
      }) as ReturnType<DotdenApi['den']['scanCommit']>
    },
    // → IPC channel 'den:allowlist-secret' (synced "don't warn me about this File again", issue 2-04)
    allowlistSecret(finding) {
      return invokeWithTrace('den:allowlist-secret', {
        finding,
      }) as ReturnType<DotdenApi['den']['allowlistSecret']>
    },
    // → IPC channel 'den:get-commit-template' (Settings → Commit tab: synced template + preview facts, issue 2-09)
    commitTemplate() {
      return ipcRenderer.invoke('den:get-commit-template', {
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['commitTemplate']>
    },
    // → IPC channel 'den:set-commit-template' (persist synced template + Commit `.dotden/`, issue 2-09)
    setCommitTemplate(template) {
      return ipcRenderer.invoke('den:set-commit-template', {
        template,
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['setCommitTemplate']>
    },
    // → IPC channel 'den:get-appearance' (EFFECTIVE theme + Apply/notify, synced overlaid by local override, issues 2-10/2-17)
    appearanceSettings() {
      return ipcRenderer.invoke('den:get-appearance', {
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['appearanceSettings']>
    },
    // → IPC channel 'den:get-appearance-state' (synced · override · effective triple for the tab, issue 2-17)
    appearanceState() {
      return ipcRenderer.invoke('den:get-appearance-state', {
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['appearanceState']>
    },
    // → IPC channel 'den:set-appearance' (persist SYNCED appearance defaults + Commit `.dotden/`, issue 2-10)
    setAppearanceSettings(settings) {
      return ipcRenderer.invoke('den:set-appearance', {
        settings,
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['setAppearanceSettings']>
    },
    // → IPC channel 'den:set-appearance-override' (pin/clear this env's LOCAL override in userData only, issue 2-17)
    setAppearanceOverride(override) {
      return ipcRenderer.invoke('den:set-appearance-override', {
        override,
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['setAppearanceOverride']>
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
      return invokeWithTrace('den:convert-secret', {
        request,
      }) as ReturnType<DotdenApi['den']['convertSecret']>
    },
    // → IPC channel 'den:commit'
    commit(targetPaths) {
      return invokeWithTrace('den:commit', {
        targetPaths,
      }) as ReturnType<DotdenApi['den']['commit']>
    },
    // → IPC channel 'den:sync-push' (push + flush any offline-queued push, issue 1-16)
    syncPush() {
      return invokeWithTrace('den:sync-push') as ReturnType<DotdenApi['den']['syncPush']>
    },
    // → IPC channel 'den:flush-push-queue' (retry a push queued while offline, issue 1-16)
    flushPushQueue() {
      return invokeWithTrace('den:flush-push-queue') as ReturnType<
        DotdenApi['den']['flushPushQueue']
      >
    },
    // → IPC channel 'den:push-pending' (offline-banner state: is a push queued?, issue 1-16)
    pushPending() {
      return ipcRenderer.invoke('den:push-pending', {
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['pushPending']>
    },
    // → IPC channel 'den:list-incoming'
    listIncoming() {
      return invokeWithTrace('den:list-incoming') as ReturnType<DotdenApi['den']['listIncoming']>
    },
    // → IPC channel 'den:incoming-summary' (Review & Apply: incoming + source env label)
    incomingSummary() {
      return invokeWithTrace('den:incoming-summary') as ReturnType<
        DotdenApi['den']['incomingSummary']
      >
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
      return invokeWithTrace('den:apply', {
        targetPaths,
        // The deletions the user explicitly confirmed (invariant #4); omitted ⇒ none.
        confirmedDeletions: confirmedDeletions ?? [],
      }) as ReturnType<DotdenApi['den']['apply']>
    },
    // → IPC channel 'den:auto-apply' (Auto-apply Sync: fetch + auto-apply clean changes, 2-12)
    autoApply() {
      return invokeWithTrace('den:auto-apply') as ReturnType<DotdenApi['den']['autoApply']>
    },
    // → IPC channel 'den:yolo-sync' (YOLO hands-off: auto-Commit before merge → push → merge →
    //   auto-apply clean; Conflicts still surfaced for the user, never auto-resolved, 2-13)
    yoloSync() {
      return invokeWithTrace('den:yolo-sync') as ReturnType<DotdenApi['den']['yoloSync']>
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
      return invokeWithTrace('den:tree') as ReturnType<DotdenApi['den']['tree']>
    },
    // → IPC channel 'den:diff'
    diff(targetPath) {
      return invokeWithTrace('den:diff', {
        targetPath,
      }) as ReturnType<DotdenApi['den']['diff']>
    },
    // → IPC channel 'den:connected-remote' (Account tab: git Remote URL + Provider, issue 2-11)
    connectedRemote() {
      return ipcRenderer.invoke('den:connected-remote', {
        _trace: trace(),
      }) as ReturnType<DotdenApi['den']['connectedRemote']>
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
      return invokeWithTrace('den:untrack', {
        targetPath,
      }) as ReturnType<DotdenApi['den']['untrack']>
    },
    // → IPC channel 'den:delete-everywhere' (the Delete everywhere verb → chezmoi destroy)
    deleteEverywhere(targetPath) {
      return invokeWithTrace('den:delete-everywhere', {
        targetPath,
      }) as ReturnType<DotdenApi['den']['deleteEverywhere']>
    },
    // → IPC channel 'den:affected-environments' (blast radius for the destructive confirm)
    affectedEnvironments(targetPath) {
      return invokeWithTrace('den:affected-environments', {
        targetPath,
      }) as ReturnType<DotdenApi['den']['affectedEnvironments']>
    },
    // → IPC channel 'den:create-workspace' (new access boundary, issue 1-14)
    createWorkspace(label) {
      return invokeWithTrace('den:create-workspace', {
        label,
      }) as ReturnType<DotdenApi['den']['createWorkspace']>
    },
    // → IPC channel 'den:create-group' (nested organization Group, issue 1-14)
    createGroup(workspaceId, label, parentId) {
      return invokeWithTrace('den:create-group', {
        workspaceId,
        label,
        parentId,
      }) as ReturnType<DotdenApi['den']['createGroup']>
    },
    // → IPC channel 'den:move-to-group' (organize-only: never changes access or path)
    moveFileToGroup(targetPath, groupId) {
      return invokeWithTrace('den:move-to-group', {
        targetPath,
        groupId,
      }) as ReturnType<DotdenApi['den']['moveFileToGroup']>
    },
    // → IPC channel 'den:set-file-workspace' (access-boundary move, issue 1-14)
    setFileWorkspace(targetPath, workspaceId) {
      return invokeWithTrace('den:set-file-workspace', {
        targetPath,
        workspaceId,
      }) as ReturnType<DotdenApi['den']['setFileWorkspace']>
    },
    // → IPC channel 'den:set-file-scope' (OS Scope: clamp+narrow to specific OSes, issue 1-15)
    setFileScope(targetPath, scope) {
      return invokeWithTrace('den:set-file-scope', {
        targetPath,
        scope,
      }) as ReturnType<DotdenApi['den']['setFileScope']>
    },
    // → IPC channel 'den:set-group-scope' (OS Scope of a Folder/Group, inherited by children)
    setGroupScope(workspaceId, groupId, scope) {
      return invokeWithTrace('den:set-group-scope', {
        workspaceId,
        groupId,
        scope,
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
    // → IPC channel 'env:reassign' (Environments-tab lifecycle: fold a duplicate into the keeper)
    reassign(fromId, intoId) {
      return ipcRenderer.invoke('env:reassign', {
        fromId,
        intoId,
        _trace: trace(),
      }) as ReturnType<DotdenApi['environment']['reassign']>
    },
    // → IPC channel 'env:retire' (Environments-tab lifecycle: drop a decommissioned environment)
    retire(envId) {
      return ipcRenderer.invoke('env:retire', {
        envId,
        _trace: trace(),
      }) as ReturnType<DotdenApi['environment']['retire']>
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
  privacy: {
    // → IPC channel 'privacy:get-settings' (env-local telemetry consent; both default off, 2-14)
    getSettings() {
      return ipcRenderer.invoke('privacy:get-settings', {
        _trace: trace(),
      }) as ReturnType<DotdenApi['privacy']['getSettings']>
    },
    // → IPC channel 'privacy:set-settings' (persist consent ONLY — no egress, control surface, 2-14)
    setSettings(settings) {
      return ipcRenderer.invoke('privacy:set-settings', {
        settings,
        _trace: trace(),
      }) as ReturnType<DotdenApi['privacy']['setSettings']>
    },
  },
  app: {
    // → IPC channel 'app:get-info' (running build version + platform for the About tab, issue 2-16)
    getInfo() {
      return ipcRenderer.invoke('app:get-info', {
        _trace: trace(),
      }) as ReturnType<DotdenApi['app']['getInfo']>
    },
    // → IPC channel 'app:check-updates' (honest update-check affordance; real feed is issue 3-20)
    checkForUpdates() {
      return ipcRenderer.invoke('app:check-updates', {
        _trace: trace(),
      }) as ReturnType<DotdenApi['app']['checkForUpdates']>
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
