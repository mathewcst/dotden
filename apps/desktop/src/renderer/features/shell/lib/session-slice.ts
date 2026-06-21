/**
 * The `session` slice — the spine of the scoped `den-session` store (ADR 0027, Phase 2).
 *
 * This holds the cross-pane session state every other slice and pane reads: the managed File
 * tree, the Workspace/Group model, the selected File/Workspace/Group inspector target, the
 * center-pane diff + tab, this environment's automation level, and the shared `busy`/`error`
 * channel. It also owns the lifecycle verbs (Track, organize, the right-click row verbs +
 * their confirm), because those drive selection + tree reloads that the whole window follows.
 *
 * Every action here is a faithful 1:1 port of the corresponding `useCallback` from the old
 * 1377-line `Workspace.tsx` — the tangled `useState` web becomes pure, node-testable store
 * decisions (the PRD's whole point). Cross-slice calls go through `get()` (it is one combined
 * store), so e.g. a row-verb Commit reaches `get().commitWithScan` in the commit slice.
 *
 * The IPC surface is INJECTED (`api`) rather than read off `window.dotden`, so the slice runs
 * in vitest's node environment with a fake API — no DOM, no `window` (see the slice tests).
 */
import type { DotdenApi } from '@shared/ipc-api'
import type { AffectedEnvironment, FileTreeEntry } from '@shared/den'
import type { RedactedCommandRecord } from '@shared/diagnostics'
import type { Workspace as WorkspaceModel } from '@shared/workspace'
import type { Scope } from '@shared/scope'
import type { AutomationLevel } from '@shared/apply'
import type { RowVerb } from '../../workspace/components/RowContextMenu'
import type { DotdenTreeNode } from '../../workspace/lib/tree-node-model'
import type { DenSessionGet, DenSessionSet } from './den-session-store'
import { operationError, type OperationError } from './operation-error'
import { toast } from '../../../ui/toast-store'

/** Discriminates which environment's role this session is driving (A vs B copy/actions). */
export type Role = 'a' | 'b'

/**
 * The in-flight Operation kind that owns the shared `busy` channel — the exact union the old
 * Workspace tracked, so every pane's `disabled={busy !== null}` and per-kind spinner is preserved.
 */
export type Busy =
  | 'load'
  | 'track'
  | 'commit'
  | 'push'
  | 'list'
  | 'apply'
  | 'diff'
  | 'untrack'
  | 'delete'
  | 'organize'
  | 'convert'
  | 'discard'

/**
 * The pending destructive/lifecycle confirm (issue 1-08): which row verb is awaiting
 * confirmation, on which File, and — for Delete everywhere — the affected environments the
 * confirm must name. `apply-deletion` is an incoming **deletion** the user must confirm before
 * Apply removes the real file (invariant #4, ADR 0008).
 */
export interface PendingConfirm {
  readonly verb: 'untrack' | 'delete-everywhere' | 'apply-deletion' | 'discard' | 'move-workspace'
  readonly path: string
  readonly affected: readonly AffectedEnvironment[]
  readonly workspaceId?: string
}

/** The `session` slice's state + actions (combined into {@link DenSession}). */
export interface SessionSlice {
  /** This session's role (env A drives Track/Commit/Sync; env B drives Detect/Apply). */
  readonly role: Role
  /** env A: the managed File tree read from the main process (the real chezmoi view). */
  files: readonly FileTreeEntry[]
  /** The Workspace/Group tree (issue 1-14), read from the synced `.dotden/` over `den:tree`. */
  workspaces: readonly WorkspaceModel[]
  /** The single source of truth for the selected File — the tree, diff, and inspector follow it. */
  selected: string | null
  /** Selected Group inspector target, or null when a File/Workspace/nothing is active. */
  selectedGroup: { workspaceId: string; groupId: string } | null
  /** Selected Workspace inspector target, or null when a File/Group/nothing is active. */
  selectedWorkspace: string | null
  /** The selected File's real `chezmoi diff` for the center pane (null when none/incoming-clean). */
  diff: string | null
  /** Which center-pane tab is active. Reset to `changes` whenever selection clears (see selectFile). */
  centerTab: 'changes' | 'history'
  /** This environment's automation level (issue 1-12) — drives Commit/Sync copy + the last-commit callout. */
  automationLevel: AutomationLevel
  /** The in-flight Operation, or null. Every pane reads it to disable controls + show spinners. */
  busy: Busy | null
  /** The current soft error to surface globally/inspector (never fail silently), or null. */
  error: OperationError | null
  /** Monotonic guard so an out-of-order diff response can't clobber a newer selection (last wins). */
  diffToken: number
  /** The open confirm dialog's pending verb, or null while none is open. */
  confirm: PendingConfirm | null
  /** Whether the global Diagnostics bottom panel is open. */
  diagnosticsPanelOpen: boolean
  /** The Diagnostics panel presentation: standing Console or trace-scoped failure Details. */
  diagnosticsPanelMode: 'console' | 'details'
  /** Trace currently loaded in Details mode, or null for the standing Console. */
  diagnosticsPanelTraceId: string | null
  /** Completed, already-redacted Command records shown in the bottom panel. */
  diagnosticsRecords: readonly RedactedCommandRecord[]
  /** Console-only view cutoff set by Clear; persisted records are not deleted. */
  diagnosticsClearedAt: number | null
  /** Failure count from the persisted Command log, independent of the current panel view. */
  diagnosticsErrorCount: number
  /** Whether the standing Console is enabled. Full Settings control lands in issue 4-07. */
  diagnosticsConsoleEnabled: boolean
  /** Human reason/fix when this environment would materialize an empty Den from subscriptions. */
  emptyDenWarning: string | null

  /** Run an IPC action with consistent busy/error handling — never fail silently. */
  run(kind: Busy, fn: () => Promise<void>): Promise<void>
  /** Select a File AND fetch its real diff (guarded so the last selection wins). */
  selectFile(path: string | null): Promise<void>
  /** Select a Workspace as the active inspector target. */
  selectWorkspace(workspaceId: string | null): void
  /** Select a Group as the active inspector target. */
  selectGroup(workspaceId: string, groupId: string): void
  /** Refresh the managed File tree from the main process (the real chezmoi view). */
  reloadTree(): Promise<void>
  /** Switch the active center-pane tab. */
  setCenterTab(tab: 'changes' | 'history'): void
  /** Track a File by path; `onTracked` fires the moment the Track lands (so the caller clears its input). */
  track(targetPath: string, onTracked?: () => void): Promise<void>
  /** Create a Workspace (the access boundary); the SECOND one reveals the concept (issue 1-14). */
  createWorkspace(label: string): Promise<void>
  /** Create a nested Group inside a Workspace (pure organization, never changes access/path). */
  createGroup(workspaceId: string, label: string, parentId: string | null): Promise<void>
  /** Rename a Workspace label without changing access semantics. */
  renameWorkspace(workspaceId: string, label: string): void
  /** Rename a Group label without moving Files. */
  renameGroup(workspaceId: string, groupId: string, label: string): void
  /** Delete an empty Workspace; backend refuses non-empty/last Workspace. */
  deleteWorkspace(workspaceId: string): void
  /** Delete an empty Group; backend refuses child Groups or filed Files. */
  deleteGroup(workspaceId: string, groupId: string): void
  /** File the selected File under a Group (or back to its Workspace root). Organization only. */
  moveSelectedToGroup(groupId: string | null): void
  /** Move the selected File into a Workspace. Changes access and resets its Group. */
  moveSelectedToWorkspace(workspaceId: string): void
  /** Apply an organize-only tree drop. Rejects folders/files and Workspace-crossing drags. */
  organizeTreeDrop(dragged: DotdenTreeNode, target: DotdenTreeNode): void
  /** Scope the selected File to specific OSes (issue 1-15); the main process clamps + recompiles. */
  scopeSelectedFile(scope: Scope): void
  /** Scope the selected Group to specific OSes; Files and child Groups inherit it. */
  scopeSelectedGroup(scope: Scope): void
  /** Route a right-click row verb (Commit/Apply run; Untrack/Delete open a confirm first). */
  onRowVerb(path: string, verb: RowVerb): void
  /** Carry out the verb the user CONFIRMED in the dialog (faithful chezmoi forget/destroy/apply). */
  runConfirmedVerb(): void
  /** Open/close the confirm dialog (the dialog layer calls this on dismiss). */
  setConfirm(confirm: PendingConfirm | null): void
  /** Open the Diagnostics bottom panel and load recent redacted Command records. */
  openDiagnosticsPanel(traceId?: string): Promise<void>
  /** Collapse the Diagnostics bottom panel. */
  closeDiagnosticsPanel(): void
  /** Toggle the Diagnostics bottom panel from the status-bar badge. */
  toggleDiagnosticsPanel(): Promise<void>
  /** Clear the current panel view without deleting the persisted Command log. */
  clearDiagnosticsView(): void
  /** Refresh the Diagnostics badge state from the persisted Command log. */
  refreshDiagnosticsStatus(): Promise<void>
  /** Load the persisted standing Console setting and open the Console if enabled. */
  loadDiagnosticsConsoleSetting(): Promise<void>
  /** Refresh Console records without changing Details mode. */
  refreshDiagnosticsConsole(): Promise<void>
  /** env A boot load: automation level, offline-queue state, the tree, and incoming (issue 1-04/09). */
  init(): Promise<void>
}

/**
 * Build the `session` slice, closing over the injected {@link DotdenApi}. The `role` is fixed for
 * the life of the store (the provider is keyed by role, so switching environment remounts → a
 * fresh store), so it lives as immutable state rather than an action input.
 */
export function createSessionSlice(role: Role, api: DotdenApi) {
  return (set: DenSessionSet, get: DenSessionGet): SessionSlice => ({
    role,
    files: [],
    workspaces: [],
    selected: null,
    selectedGroup: null,
    selectedWorkspace: null,
    diff: null,
    centerTab: 'changes',
    automationLevel: 'manual',
    busy: null,
    error: null,
    diffToken: 0,
    confirm: null,
    diagnosticsPanelOpen: false,
    diagnosticsPanelMode: 'console',
    diagnosticsPanelTraceId: null,
    diagnosticsRecords: [],
    diagnosticsClearedAt: null,
    diagnosticsErrorCount: 0,
    diagnosticsConsoleEnabled: false,
    emptyDenWarning: null,

    run: async (kind, fn) => {
      set({ busy: kind, error: null })
      try {
        await fn()
      } catch (caught) {
        set({ error: operationError(caught, 'Operation failed.', () => get().run(kind, fn)) })
      } finally {
        set({ busy: null })
      }
    },

    // Select a File AND fetch its real `chezmoi diff` for the center pane (issue 1-07). A
    // monotonic token guards against an out-of-order response when the user clicks through rows
    // faster than the diff resolves (last selection wins). env B rows are incoming-clean (no local
    // copy yet), so they carry no local diff. Manages `busy`/`error` itself (not via `run`) because
    // the token guard must wrap the busy/error writes.
    selectFile: async (path) => {
      set({ selected: path, selectedGroup: null, selectedWorkspace: null })
      const token = get().diffToken + 1
      set({ diffToken: token })
      // A cleared selection can't have a History tab to show; snap back to Changes so the
      // active-tab highlight never disagrees with the body.
      if (path === null) set({ centerTab: 'changes' })
      if (path === null || get().role !== 'a') {
        set({ diff: null })
        return
      }
      set({ busy: 'diff' })
      try {
        const patch = await api.den.diff(path)
        if (token === get().diffToken) set({ diff: patch })
      } catch (caught) {
        if (token === get().diffToken) {
          set({
            error: operationError(caught, 'Could not load the diff.'),
            diff: null,
          })
        }
      } finally {
        if (token === get().diffToken) set((s) => ({ busy: s.busy === 'diff' ? null : s.busy }))
      }
    },

    selectWorkspace: (workspaceId) => {
      set({
        selected: null,
        selectedGroup: null,
        selectedWorkspace: workspaceId,
        diff: null,
        centerTab: 'changes',
      })
    },

    selectGroup: (workspaceId, groupId) => {
      set({
        selected: null,
        selectedGroup: { workspaceId, groupId },
        selectedWorkspace: null,
        diff: null,
        centerTab: 'changes',
      })
    },

    reloadTree: () =>
      get().run('load', async () => {
        const view = await api.den.tree()
        set({ files: view.files, workspaces: view.workspaces })
      }),

    setCenterTab: (centerTab) => set({ centerTab }),

    // Track a File then reload + select it. `onTracked` fires the instant the Track lands — BEFORE
    // the tree reload, inside the same `run('track')` span — so the center pane clears its (local,
    // ephemeral) input mid-flow exactly as the old Workspace did, and only on success (a failed
    // Track skips it inside `run`'s swallow, keeping the typed path for retry).
    track: (targetPath, onTracked) =>
      get().run('track', async () => {
        const path = targetPath.trim()
        if (!path) return
        await api.den.track(path)
        onTracked?.()
        await get().reloadTree()
        await get().selectFile(path)
      }),

    createWorkspace: (label) =>
      get().run('organize', async () => {
        await api.den.createWorkspace(label)
        await get().reloadTree()
      }),

    createGroup: (workspaceId, label, parentId) =>
      get().run('organize', async () => {
        await api.den.createGroup(workspaceId, label, parentId)
        await get().reloadTree()
      }),

    renameWorkspace: (workspaceId, label) => {
      void get().run('organize', async () => {
        await api.den.renameWorkspace(workspaceId, label)
        await get().reloadTree()
      })
    },

    renameGroup: (workspaceId, groupId, label) => {
      void get().run('organize', async () => {
        await api.den.renameGroup(workspaceId, groupId, label)
        await get().reloadTree()
      })
    },

    deleteWorkspace: (workspaceId) => {
      void get().run('organize', async () => {
        await api.den.deleteWorkspace(workspaceId)
        set((s) => ({
          selectedWorkspace: s.selectedWorkspace === workspaceId ? null : s.selectedWorkspace,
        }))
        await get().reloadTree()
      })
    },

    deleteGroup: (workspaceId, groupId) => {
      void get().run('organize', async () => {
        await api.den.deleteGroup(workspaceId, groupId)
        set((s) => ({
          selectedGroup:
            s.selectedGroup?.workspaceId === workspaceId && s.selectedGroup.groupId === groupId
              ? null
              : s.selectedGroup,
        }))
        await get().reloadTree()
      })
    },

    moveSelectedToGroup: (groupId) => {
      const selected = get().selected
      if (!selected) return
      void get().run('organize', async () => {
        await api.den.moveFileToGroup(selected, groupId)
        await get().reloadTree()
      })
    },

    moveSelectedToWorkspace: (workspaceId) => {
      const selected = get().selected
      const selectedFile = get().files.find((file) => file.targetPath === selected)
      if (!selected || selectedFile?.workspaceId === workspaceId) return
      set({ confirm: { verb: 'move-workspace', path: selected, affected: [], workspaceId } })
    },

    organizeTreeDrop: (dragged, target) => {
      // Folders and Files are never drop targets: Folders are derived from target paths and Files
      // are leaves. Workspaces are drag-sealed, so a Group/File can only land within its own
      // Workspace; cross-Workspace File moves stay an explicit, confirmed menu/inspector action.
      if (target.kind !== 'group') return
      if (dragged.workspaceId === undefined || target.workspaceId === undefined) return
      if (dragged.workspaceId !== target.workspaceId) return

      if (dragged.kind === 'file' && dragged.targetPath) {
        void get().run('organize', async () => {
          await api.den.moveFileToGroup(dragged.targetPath!, target.groupId ?? null)
          await get().reloadTree()
        })
        return
      }

      if (dragged.kind === 'group' && dragged.groupId && target.groupId) {
        if (dragged.groupId === target.groupId) return
        void get().run('organize', async () => {
          await api.den.setGroupParent(dragged.workspaceId!, dragged.groupId!, target.groupId!)
          await get().reloadTree()
        })
      }
    },

    scopeSelectedFile: (scope) => {
      const selected = get().selected
      if (!selected) return
      void get().run('organize', async () => {
        await api.den.setFileScope(selected, scope)
        await get().reloadTree()
      })
    },

    scopeSelectedGroup: (scope) => {
      const selectedGroup = get().selectedGroup
      if (!selectedGroup) return
      void get().run('organize', async () => {
        await api.den.setGroupScope(selectedGroup.workspaceId, selectedGroup.groupId, scope)
        await get().reloadTree()
      })
    },

    // The four row verbs (issue 1-08), routed by intent:
    // - Commit/Apply: everyday verbs, run immediately on the one right-clicked File.
    // - Untrack/Delete everywhere: destructive/lifecycle — never run on the click; OPEN a confirm
    //   first (Delete additionally fetches the affected environments to name the blast radius).
    onRowVerb: (path, verb) => {
      if (verb === 'commit') {
        // Scan-then-warn before recording this one File's Commit (issue 2-03).
        void get().commitWithScan([path])
        return
      }
      if (verb === 'apply') {
        // An incoming **deletion** is never applied without explicit confirmation (invariant #4).
        const incomingItem = get().incoming.find((i) => i.targetPath === path)
        if (incomingItem?.requiresConfirmation) {
          set({ confirm: { verb: 'apply-deletion', path, affected: [] } })
          return
        }
        void get().run('apply', async () => {
          const result = await api.den.apply([path])
          if (result.applied.length > 0) toast.success('Applied 1 file.')
          await get().reloadTree()
        })
        return
      }
      if (verb === 'untrack') {
        // Untrack is non-destructive (the File stays on disk), so it needs no blast radius.
        set({ confirm: { verb: 'untrack', path, affected: [] } })
        return
      }
      // Delete everywhere: load the affected environments BEFORE opening the confirm so the
      // destructive dialog can name every environment that loses the real path.
      void get().run('delete', async () => {
        const affected = await api.den.affectedEnvironments(path)
        set({ confirm: { verb: 'delete-everywhere', path, affected } })
      })
    },

    // Carry out the CONFIRMED verb. Each maps faithfully onto a chezmoi verb (Untrack→forget,
    // Delete everywhere→destroy, apply-deletion→a confirmed `chezmoi apply` of the removed File),
    // then refreshes the tree so the removed File disappears from the decorations. Does NOT close
    // the dialog itself — the dialog layer clears `confirm` via its own dismiss handler.
    runConfirmedVerb: () => {
      const confirm = get().confirm
      if (!confirm) return
      const { verb, path } = confirm
      if (verb === 'apply-deletion') {
        void get().run('apply', async () => {
          const result = await api.den.apply([path], [path])
          if (result.applied.length > 0) toast.success('Applied 1 file.')
          if (get().selected === path) await get().selectFile(null)
          await get().reloadTree()
        })
        return
      }
      if (verb === 'discard') {
        void get().run('discard', async () => {
          await api.den.discardLocalChange(path)
          toast.success('Discarded local changes.')
          await get().reloadTree()
          if (get().selected === path) await get().selectFile(path)
        })
        return
      }
      if (verb === 'move-workspace') {
        void get().run('organize', async () => {
          if (!confirm.workspaceId) return
          await api.den.setFileWorkspace(path, confirm.workspaceId)
          await get().reloadTree()
          if (get().selected === path) await get().selectFile(path)
        })
        return
      }
      void get().run(verb === 'untrack' ? 'untrack' : 'delete', async () => {
        if (verb === 'untrack') await api.den.untrack(path)
        else await api.den.deleteEverywhere(path)
        if (get().selected === path) await get().selectFile(null)
        await get().reloadTree()
      })
    },

    setConfirm: (confirm) => set({ confirm }),

    openDiagnosticsPanel: async (traceId) => {
      try {
        const records = await api.diagnostics.recordsFor(traceId)
        set({
          diagnosticsPanelOpen: true,
          diagnosticsPanelMode: traceId ? 'details' : 'console',
          diagnosticsPanelTraceId: traceId ?? null,
          diagnosticsClearedAt: traceId ? get().diagnosticsClearedAt : null,
          diagnosticsRecords:
            traceId || get().diagnosticsClearedAt === null
              ? records
              : records.filter((record) => record.timestamp > (get().diagnosticsClearedAt ?? 0)),
          diagnosticsErrorCount: traceId
            ? get().diagnosticsErrorCount
            : records.filter((record) => record.exitCode !== 0).length,
        })
      } catch (caught) {
        set({
          diagnosticsPanelOpen: true,
          diagnosticsPanelMode: traceId ? 'details' : 'console',
          diagnosticsPanelTraceId: traceId ?? null,
          error: operationError(caught, 'Could not load Diagnostics.'),
        })
      }
    },

    closeDiagnosticsPanel: () => set({ diagnosticsPanelOpen: false }),

    toggleDiagnosticsPanel: async () => {
      if (get().diagnosticsPanelOpen) {
        set({ diagnosticsPanelOpen: false })
        return
      }
      await get().openDiagnosticsPanel()
    },

    clearDiagnosticsView: () =>
      set({
        diagnosticsRecords: [],
        diagnosticsClearedAt: get().diagnosticsPanelMode === 'console' ? Date.now() : null,
      }),

    refreshDiagnosticsStatus: async () => {
      try {
        const records = await api.diagnostics.recordsFor()
        set({ diagnosticsErrorCount: records.filter((record) => record.exitCode !== 0).length })
      } catch {
        // The panel itself surfaces load failures. The status badge should not turn a
        // startup diagnostics read hiccup into a global app error.
      }
    },

    loadDiagnosticsConsoleSetting: async () => {
      try {
        const settings = await api.diagnostics.getSettings()
        set({ diagnosticsConsoleEnabled: settings.consoleEnabled })
        if (settings.consoleEnabled) await get().openDiagnosticsPanel()
      } catch {
        // Diagnostics settings are non-critical. The Settings tab surfaces write/read failures;
        // the shell keeps the default OFF state on a startup read hiccup.
      }
    },

    refreshDiagnosticsConsole: async () => {
      if (!get().diagnosticsConsoleEnabled || get().diagnosticsPanelMode !== 'console') return
      try {
        const records = await api.diagnostics.recordsFor()
        set({
          diagnosticsRecords:
            get().diagnosticsClearedAt === null
              ? records
              : records.filter((record) => record.timestamp > (get().diagnosticsClearedAt ?? 0)),
          diagnosticsErrorCount: records.filter((record) => record.exitCode !== 0).length,
        })
      } catch {
        // The explicit panel-open path surfaces failures. Background tail refresh should not
        // replace the user's current app error with a transient diagnostics read.
      }
    },

    // env A boot load (the old `loadInitial` effect, issue 1-04). No `active` unmount guard is
    // needed: a late reply writes to the store, not to React state, so it never warns after
    // unmount (the store is simply orphaned + GC'd when the provider remounts on role change).
    // Each piece is set progressively (so the UI fills in as each await resolves), inside one
    // try so any failure surfaces the single "Could not read your Files." error — matching the
    // old loadInitial exactly (incomingSummary failing here is NOT the softer refreshIncoming copy).
    init: async () => {
      if (get().role !== 'a') return
      try {
        const level = await api.automation.getLevel()
        set({ automationLevel: level })
        const queued = await api.den.pushPending()
        set({ pushQueued: queued })
        const view = await api.den.tree()
        set({ files: view.files, workspaces: view.workspaces })
        const subscriptions = await api.den.subscriptionState()
        set({ emptyDenWarning: subscriptions.emptyDenWarning })
        const summary = await api.den.incomingSummary()
        set({
          remoteAxis: new Map(summary.items.map((i) => [i.targetPath, i.marker])),
          incomingFrom: summary.fromEnvironmentLabel,
        })
      } catch (caught) {
        set({ error: operationError(caught, 'Could not read your Files.') })
      }
    },
  })
}
