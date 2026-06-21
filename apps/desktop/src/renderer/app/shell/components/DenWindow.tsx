import { BottomPanel } from '@/app/shell/components/BottomPanel'
import { CenterPane } from '@/app/shell/components/CenterPane'
import { DialogLayer } from '@/app/shell/components/DialogLayer'
import { ErrorBanner } from '@/components/den/error-banner'
import { LeftPane } from '@/app/shell/components/LeftPane'
import { RightInspector } from '@/app/shell/components/RightInspector'
import { StatusBar } from '@/app/shell/components/StatusBar'
import { TitleBar } from '@/app/shell/components/TitleBar'
import { useDenSession } from '@/den-session'
import { IncomingBanner } from '@/features/sync/components/IncomingBanner'
import { OfflineBanner } from '@/features/sync/components/OfflineBanner'
import { syncStatus } from '@/app/shell/lib/sync-status'
import { WindowTitleBar } from '@/components/den/window-controls'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/components/den/resizable'
import { buildIncomingTreeModel, buildWorkspaceTreeModel, type DotdenTreeNode } from '@/den-session'
import {
  hotkeysCoreFeature,
  searchFeature,
  selectionFeature,
  syncDataLoaderFeature,
} from '@headless-tree/core'
import { useTree } from '@headless-tree/react'
import { lazy, Suspense, useEffect, useMemo, useRef } from 'react'

const ConflictResolver = lazy(() =>
  import('@/features/apply/components/ConflictResolver').then((module) => ({
    default: module.ConflictResolver,
  })),
)
const ReviewApply = lazy(() =>
  import('@/features/apply/components/ReviewApply').then((module) => ({
    default: module.ReviewApply,
  })),
)

function FullWindowLoading({ label }: { label: string }) {
  return (
    <div className="bg-background text-muted-foreground grid h-screen grid-rows-[40px_1fr] text-sm">
      <WindowTitleBar windowsControlsClassName="-mr-3 h-10" />
      <div className="grid min-h-0 place-items-center">{label}</div>
    </div>
  )
}

/**
 * DenWindow — the den window's composition root (ADR 0027, Phase 2; renamed from `Workspace.tsx`,
 * which lied: it is the den window, not a domain Workspace — ADR 0005). A thin three-pane frame
 * that owns the shared Headless Tree model (shared by the title-bar search + the left tree), the
 * external-system effects (boot load, connectivity, the tray poller, the live git-status axis), the
 * two full-window review surfaces, and the dialog layer — and renders the feature panes. All the
 * flow logic now lives in the scoped den-session store; this just wires the store to the layout.
 *
 * The tree, status axis, and per-File diff are driven over IPC from the main process, so the view
 * is a faithful read of real chezmoi state. The A/B role switch is the MVP single-window stand-in
 * for the two-environment thread (issue 1-04): role `a` drives Track/Commit/Sync, `b` Detect/Apply.
 */
export function DenWindow({
  openReviewOnMount = false,
  onReviewOpened,
  onOpenSettings,
}: {
  openReviewOnMount?: boolean
  onReviewOpened?: () => void
  onOpenSettings?: () => void
}) {
  const role = useDenSession((s) => s.role)
  const files = useDenSession((s) => s.files)
  const incoming = useDenSession((s) => s.incoming)
  const workspaces = useDenSession((s) => s.workspaces)
  const remoteAxis = useDenSession((s) => s.remoteAxis)
  const incomingFrom = useDenSession((s) => s.incomingFrom)
  const pushQueued = useDenSession((s) => s.pushQueued)
  const busy = useDenSession((s) => s.busy)
  const selected = useDenSession((s) => s.selected)
  const reviewing = useDenSession((s) => s.reviewing)
  const resolving = useDenSession((s) => s.resolving)
  const diagnosticsPanelOpen = useDenSession((s) => s.diagnosticsPanelOpen)
  const diagnosticsPanelMode = useDenSession((s) => s.diagnosticsPanelMode)
  const diagnosticsConsoleEnabled = useDenSession((s) => s.diagnosticsConsoleEnabled)
  const error = useDenSession((s) => s.error)

  const init = useDenSession((s) => s.init)
  const reloadTree = useDenSession((s) => s.reloadTree)
  const refreshIncoming = useDenSession((s) => s.refreshIncoming)
  const refreshPushQueued = useDenSession((s) => s.refreshPushQueued)
  const flushQueuedPush = useDenSession((s) => s.flushQueuedPush)
  const refreshDiagnosticsStatus = useDenSession((s) => s.refreshDiagnosticsStatus)
  const loadDiagnosticsConsoleSetting = useDenSession((s) => s.loadDiagnosticsConsoleSetting)
  const refreshDiagnosticsConsole = useDenSession((s) => s.refreshDiagnosticsConsole)
  const openDiagnosticsPanel = useDenSession((s) => s.openDiagnosticsPanel)
  const setReviewing = useDenSession((s) => s.setReviewing)
  const setResolving = useDenSession((s) => s.setResolving)

  // The paths the tree renders: real managed Files on A, incoming Files on B.
  const paths = useMemo(
    () => (role === 'a' ? files.map((f) => f.targetPath) : incoming.map((i) => i.targetPath)),
    [role, files, incoming],
  )

  const treeModel = useMemo(
    () =>
      role === 'a'
        ? buildWorkspaceTreeModel({ workspaces, files, remoteAxis })
        : buildIncomingTreeModel(incoming),
    [files, incoming, remoteAxis, role, workspaces],
  )
  const selectedTreeNodeId = useMemo(
    () =>
      selected
        ? [...treeModel.nodes.values()].find(
            (node) => node.kind === 'file' && node.targetPath === selected,
          )?.id
        : undefined,
    [selected, treeModel],
  )

  // Containers (Workspaces, Groups, Folders) open by default, and expansion is UNCONTROLLED —
  // Headless Tree owns the expanded-id set. We tried controlling it (`state.expandedItems` +
  // `setExpandedItems`, tracking only collapses) and it desynced the visible rows from the real
  // expand state in the live app: a collapse flipped `isExpanded` but never rebuilt the flat row
  // list — Headless Tree only rebuilds it on the toggle's OWN re-render (its internal `setState`),
  // which the controlled round-trip bypasses, so the rebuild waited for an unrelated later render
  // (the "click a folder, nothing happens until you click elsewhere" lag, confirmed by logging
  // `getItems()` staying flat while `isExpanded()` flipped). Letting the tree own expansion makes a
  // user toggle drive its own re-render + flat-list rebuild directly — no round-trip, no desync.
  //
  // Headless Tree persists the expanded-id set across our background model rebuilds (the live
  // git-status refresh hands the data loader new closures, not a new tree, and node ids are stable
  // across rebuilds), so a folder the user collapsed stays collapsed. We only (a) seed every
  // container open at mount and (b) auto-open containers that FIRST appear afterwards — a freshly
  // loaded Workspace, a newly created Group, a newly-tracked path — so "open by default" holds
  // without ever reopening a user's collapse.

  // Build the Headless Tree model. The data source is a pure node model derived from the scoped
  // den-session store. `initialState.expandedItems` is consumed once at mount (later renders' value
  // is ignored), so handing it the current container set seeds everything open. Selection is
  // uncontrolled too (the row highlight is driven by the store's `selected` via DotdenTree's
  // `selectedPath`); we only seed the initial keyboard selection.
  const tree = useTree<DotdenTreeNode>({
    rootItemId: treeModel.rootId,
    initialState: {
      expandedItems: [...treeModel.expandedIds],
      selectedItems: selectedTreeNodeId ? [selectedTreeNodeId] : [],
    },
    dataLoader: {
      getItem: (itemId) => {
        const node = treeModel.nodes.get(itemId)
        if (!node) throw new Error(`Missing tree node: ${itemId}`)
        return node
      },
      getChildren: (itemId) => [...(treeModel.childrenById.get(itemId) ?? [])],
    },
    getItemName: (item) => item.getItemData().name,
    isItemFolder: (item) => item.getItemData().kind !== 'file',
    isSearchMatchingItem: (search, item) => {
      const query = search.toLowerCase()
      const node = item.getItemData()
      return (
        node.name.toLowerCase().includes(query) ||
        node.targetPath?.toLowerCase().includes(query) === true
      )
    },
    indent: 14,
    features: [syncDataLoaderFeature, selectionFeature, hotkeysCoreFeature, searchFeature],
  })

  // Auto-open containers that first appear AFTER mount (a new Group, a newly-tracked path, or the
  // first real model replacing the empty boot model) so "open by default" holds — without reopening
  // anything the user has collapsed, since we only ever expand ids we have not seen before. The
  // tree's own mount effect (setMounted + rebuildTree) runs before this one, so expand() applies
  // immediately rather than queuing for mount.
  const seenContainers = useRef<Set<string> | null>(null)
  useEffect(() => {
    // [tree-lag] TEMP — is the store actually populated, or is the tree empty because no data loaded?
    console.log(
      '[tree-lag] model — files:',
      files.length,
      'workspaces:',
      workspaces.length,
      'busy:',
      busy,
      'nodes:',
      treeModel.nodes.size,
      'getItems:',
      tree.getItems().length,
    )
    // The data loader closes over `treeModel`; when it changes (a Commit/drag/boot/refresh adds or
    // removes Files, or a Group is created), re-walk so new and removed rows show immediately. The
    // old controlled wiring got this for free (a fresh expandedItems array forced the rebuild);
    // uncontrolled must ask explicitly.
    tree.rebuildTree()

    if (seenContainers.current === null) {
      // First run: everything currently present was seeded open via initialState — mark it all seen
      // so we never re-expand it, and only act on containers that appear in later rebuilds.
      seenContainers.current = new Set(treeModel.expandedIds)
      return
    }
    for (const id of treeModel.expandedIds) {
      if (seenContainers.current.has(id)) continue
      seenContainers.current.add(id)
      tree.getItemInstance(id)?.expand()
    }
  }, [treeModel, tree])

  // The title-bar advertises the native search chord; bind it at the shell layer that owns the
  // shared tree model so keyboard and mouse open the exact same search session.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || (!event.metaKey && !event.ctrlKey)) return
      if (role !== 'a' || paths.length === 0) return
      event.preventDefault()
      tree.openSearch()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [tree, paths.length, role])

  // env A boot load (issue 1-04). `init` self-guards on role and is a stable store action, so this
  // runs once per mount; the provider's `key={role}` remount re-runs it for the other environment.
  useEffect(() => {
    void init()
  }, [init])

  useEffect(() => {
    void refreshDiagnosticsStatus()
  }, [refreshDiagnosticsStatus])

  useEffect(() => {
    void loadDiagnosticsConsoleSetting()
  }, [loadDiagnosticsConsoleSetting])

  useEffect(() => {
    if (!diagnosticsConsoleEnabled || !diagnosticsPanelOpen || diagnosticsPanelMode !== 'console') {
      return
    }
    void refreshDiagnosticsConsole()
    const interval = window.setInterval(() => void refreshDiagnosticsConsole(), 1500)
    return () => window.clearInterval(interval)
  }, [
    diagnosticsConsoleEnabled,
    diagnosticsPanelMode,
    diagnosticsPanelOpen,
    refreshDiagnosticsConsole,
  ])

  // Returning onboarding hands off directly to the reviewed Apply surface. The ReviewApply
  // component fetches its own incoming summary on mount, so the shell only needs to flip the route.
  useEffect(() => {
    if (!openReviewOnMount) return
    setReviewing(true)
    onReviewOpened?.()
  }, [openReviewOnMount, onReviewOpened, setReviewing])

  // Connectivity detection (issue 1-16): on `online`, ask the store to flush any queued push then
  // refresh the banner; `offline` just refreshes. The main process also pushes `net:reconnected`
  // after a wake-flush, treated the same way. env A only.
  useEffect(() => {
    if (role !== 'a') return
    const onOnline = () => void flushQueuedPush()
    const onOffline = () => void refreshPushQueued()
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    const unsubscribeReconnect = window.dotden.net.onReconnected(() => void refreshPushQueued())
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      unsubscribeReconnect()
    }
  }, [role, flushQueuedPush, refreshPushQueued])

  // Subscribe to the TrayPoller's detect-only incoming push (issue 1-12): refresh this window's
  // Remote axis + banner when another environment moves the Remote. Detect-only — never Applies.
  // env A only (env B drives its own explicit Detect).
  useEffect(() => {
    if (role !== 'a') return
    const unsubscribe = window.dotden.trayPoller.onIncoming(() => {
      void refreshIncoming()
    })
    return unsubscribe
  }, [role, refreshIncoming])

  // Background automation result (v1-A3): when Auto-apply/YOLO ran after a tray-detected move,
  // refresh the tree/Remote axis and open the human surface if anything still needs review.
  useEffect(() => {
    if (role !== 'a') return
    const unsubscribe = window.dotden.trayPoller.onAutomationAction((action) => {
      void refreshIncoming()
      void reloadTree()
      if (action === 'review') setReviewing(true)
      if (action === 'resolve') setResolving(true)
    })
    return unsubscribe
  }, [role, refreshIncoming, reloadTree, setResolving, setReviewing])

  // How many changes are incoming for THIS environment (issue 1-09): drives the top-level banner.
  const incomingCount = remoteAxis.size
  const status = syncStatus({
    role,
    remoteAxis,
    pushQueued,
    busy,
    error,
    online: navigator.onLine,
  })
  const banner =
    status.kind === 'error' && error ? (
      <ErrorBanner
        message={error.message}
        onViewDetails={error.traceId ? () => void openDiagnosticsPanel(error.traceId) : undefined}
        onRetry={error.retry ? () => void error.retry?.() : undefined}
      />
    ) : status.kind === 'offline' ? (
      <OfflineBanner />
    ) : status.kind === 'incoming' ? (
      <IncomingBanner
        count={incomingCount}
        fromEnvironmentLabel={incomingFrom}
        onReview={() => setReviewing(true)}
      />
    ) : (
      // Keep the middle grid row collapsed when there is no banner (no layout shift).
      <div />
    )

  // The Conflict resolution surface (issue 1-11): the ⚠ CTA opens it. On close it re-checks the
  // Remote + tree so the decorations reflect what was resolved.
  if (resolving) {
    return (
      <Suspense fallback={<FullWindowLoading label="Loading conflict resolver…" />}>
        <ConflictResolver
          onClose={() => {
            setResolving(false)
            void refreshIncoming()
            void reloadTree()
          }}
        />
      </Suspense>
    )
  }

  // The dedicated Review & Apply surface (issue 1-09): the banner/card CTA opens it. On close it
  // re-checks the Remote so the tree decorations + banner reflect what is left.
  if (reviewing) {
    return (
      <Suspense fallback={<FullWindowLoading label="Loading review…" />}>
        <ReviewApply
          onClose={() => {
            setReviewing(false)
            void refreshIncoming()
            void reloadTree()
          }}
        />
      </Suspense>
    )
  }

  return (
    <div className="bg-background text-foreground grid h-screen grid-rows-[auto_auto_minmax(0,1fr)_auto]">
      <TitleBar
        onSearch={() => tree.openSearch()}
        searchDisabled={role !== 'a' || paths.length === 0}
        onOpenSettings={onOpenSettings}
      />

      {banner}

      <ResizablePanelGroup
        direction="vertical"
        autoSaveId="dotden-shell-vertical"
        className="min-h-0 overflow-hidden"
      >
        <ResizablePanel id="shell-main" order={1} defaultSize={75} minSize={45}>
          <ResizablePanelGroup direction="horizontal" autoSaveId="dotden-shell-horizontal">
            <ResizablePanel id="shell-left" order={1} defaultSize={22} minSize={16} maxSize={35}>
              <LeftPane tree={tree} />
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel id="shell-center" order={2} defaultSize={53} minSize={30}>
              <CenterPane />
            </ResizablePanel>
            <ResizableHandle withHandle />
            <ResizablePanel id="shell-right" order={3} defaultSize={25} minSize={18} maxSize={40}>
              <RightInspector />
            </ResizablePanel>
          </ResizablePanelGroup>
        </ResizablePanel>

        {diagnosticsPanelOpen ? (
          <>
            <ResizableHandle withHandle />
            <ResizablePanel
              id="shell-diagnostics"
              order={2}
              defaultSize={25}
              minSize={15}
              maxSize={45}
            >
              <BottomPanel />
            </ResizablePanel>
          </>
        ) : null}
      </ResizablePanelGroup>

      <StatusBar />
      <DialogLayer />
    </div>
  )
}
