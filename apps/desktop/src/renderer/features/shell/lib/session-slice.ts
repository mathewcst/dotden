/**
 * The `session` slice — the spine of the scoped `den-session` store (ADR 0027, Phase 2).
 *
 * This holds the cross-pane session state every other slice and pane reads: the managed File
 * tree, the Workspace/Group model, the single source of truth for "the selected File", the
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
import type { AffectedEnvironment, FileTreeEntry } from '../../../../main/foundation/den-service'
import type { Workspace as WorkspaceModel } from '../../../../main/foundation/den-store'
import type { Scope } from '@shared/scope'
import type { AutomationLevel } from '@shared/apply'
import type { FileTreeRenameEvent } from '@pierre/trees'
import type { RowVerb } from '../../workspace/components/RowContextMenu'
import type { DenSessionGet, DenSessionSet } from './den-session-store'

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

/**
 * The pending destructive/lifecycle confirm (issue 1-08): which row verb is awaiting
 * confirmation, on which File, and — for Delete everywhere — the affected environments the
 * confirm must name. `apply-deletion` is an incoming **deletion** the user must confirm before
 * Apply removes the real file (invariant #4, ADR 0008).
 */
export interface PendingConfirm {
  readonly verb: 'untrack' | 'delete-everywhere' | 'apply-deletion'
  readonly path: string
  readonly affected: readonly AffectedEnvironment[]
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
  /** The selected File's real `chezmoi diff` for the center pane (null when none/incoming-clean). */
  diff: string | null
  /** Which center-pane tab is active. Reset to `changes` whenever selection clears (see selectFile). */
  centerTab: 'changes' | 'history'
  /** This environment's automation level (issue 1-12) — drives Commit/Sync copy + the last-commit callout. */
  automationLevel: AutomationLevel
  /** The in-flight Operation, or null. Every pane reads it to disable controls + show spinners. */
  busy: Busy | null
  /** The current soft error to surface in the inspector (never fail silently), or null. */
  error: string | null
  /** Monotonic guard so an out-of-order diff response can't clobber a newer selection (last wins). */
  diffToken: number
  /** The open confirm dialog's pending verb, or null while none is open. */
  confirm: PendingConfirm | null

  /** Run an IPC action with consistent busy/error handling — never fail silently. */
  run(kind: Busy, fn: () => Promise<void>): Promise<void>
  /** Select a File AND fetch its real diff (guarded so the last selection wins). */
  selectFile(path: string | null): Promise<void>
  /** Refresh the managed File tree from the main process (the real chezmoi view). */
  reloadTree(): Promise<void>
  /** Switch the active center-pane tab. */
  setCenterTab(tab: 'changes' | 'history'): void
  /** Track a File by path; `onTracked` fires the moment the Track lands (so the caller clears its input). */
  track(targetPath: string, onTracked?: () => void): Promise<void>
  /** Inline-rename a File in the tree (optimistic; persistence lands with the row verbs, 1-08). */
  onRename(event: FileTreeRenameEvent): void
  /** Create a Workspace (the access boundary); the SECOND one reveals the concept (issue 1-14). */
  createWorkspace(label: string): Promise<void>
  /** Create a nested Group inside a Workspace (pure organization, never changes access/path). */
  createGroup(workspaceId: string, label: string, parentId: string | null): Promise<void>
  /** File the selected File under a Group (or back to its Workspace root). Organization only. */
  moveSelectedToGroup(groupId: string | null): void
  /** Scope the selected File to specific OSes (issue 1-15); the main process clamps + recompiles. */
  scopeSelectedFile(scope: Scope): void
  /** Route a right-click row verb (Commit/Apply run; Untrack/Delete open a confirm first). */
  onRowVerb(path: string, verb: RowVerb): void
  /** Carry out the verb the user CONFIRMED in the dialog (faithful chezmoi forget/destroy/apply). */
  runConfirmedVerb(): void
  /** Open/close the confirm dialog (the dialog layer calls this on dismiss). */
  setConfirm(confirm: PendingConfirm | null): void
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
    diff: null,
    centerTab: 'changes',
    automationLevel: 'manual',
    busy: null,
    error: null,
    diffToken: 0,
    confirm: null,

    run: async (kind, fn) => {
      set({ busy: kind, error: null })
      try {
        await fn()
      } catch (caught) {
        set({ error: caught instanceof Error ? caught.message : 'Operation failed.' })
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
      set({ selected: path })
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
            error: caught instanceof Error ? caught.message : 'Could not load the diff.',
            diff: null,
          })
        }
      } finally {
        if (token === get().diffToken) set((s) => ({ busy: s.busy === 'diff' ? null : s.busy }))
      }
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

    // Inline rename: optimistic tree edit + surface that persistence is pending so we never
    // silently imply a rename was written (the faithful chezmoi move is the 1-08 verb slice).
    onRename: (event) =>
      set((s) => ({
        files: s.files.map((f) =>
          f.targetPath === event.sourcePath ? { ...f, targetPath: event.destinationPath } : f,
        ),
        selected: event.destinationPath,
        error: `Renamed in the tree. Persisting a rename to chezmoi lands with the row verbs (issue 1-08).`,
      })),

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

    moveSelectedToGroup: (groupId) => {
      const selected = get().selected
      if (!selected) return
      void get().run('organize', async () => {
        await api.den.moveFileToGroup(selected, groupId)
        await get().reloadTree()
      })
    },

    scopeSelectedFile: (scope) => {
      const selected = get().selected
      if (!selected) return
      void get().run('organize', async () => {
        await api.den.setFileScope(selected, scope)
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
          await api.den.apply([path])
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
          await api.den.apply([path], [path])
          if (get().selected === path) await get().selectFile(null)
          await get().reloadTree()
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
        const summary = await api.den.incomingSummary()
        set({
          remoteAxis: new Map(summary.items.map((i) => [i.targetPath, i.marker])),
          incomingFrom: summary.fromEnvironmentLabel,
        })
      } catch (caught) {
        set({ error: caught instanceof Error ? caught.message : 'Could not read your Files.' })
      }
    },
  })
}
