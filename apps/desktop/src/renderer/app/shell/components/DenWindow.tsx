import { BottomPanel } from '@/app/shell/components/BottomPanel'
import { CenterPane } from '@/app/shell/components/CenterPane'
import { DialogLayer } from '@/app/shell/components/DialogLayer'
import { ErrorBanner } from '@/app/shell/components/ErrorBanner'
import { LeftPane } from '@/app/shell/components/LeftPane'
import { RightInspector } from '@/app/shell/components/RightInspector'
import { StatusBar } from '@/app/shell/components/StatusBar'
import { TitleBar } from '@/app/shell/components/TitleBar'
import { useDenSession } from '@/den-session'
import { IncomingBanner } from '@/features/sync/components/IncomingBanner'
import { OfflineBanner } from '@/features/sync/components/OfflineBanner'
import { syncStatus } from '@/app/shell/lib/sync-status'
import { WindowTitleBar } from '@/shared/components/WindowControls'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '@/ui/resizable'
import { buildIncomingTreeModel, buildWorkspaceTreeModel, type DotdenTreeNode } from '@/den-session'
import {
  hotkeysCoreFeature,
  searchFeature,
  selectionFeature,
  syncDataLoaderFeature,
} from '@headless-tree/core'
import { useTree } from '@headless-tree/react'
import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react'

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

  // Containers (Workspaces, Groups, Folders) are expanded by default. We remember only what the
  // user has explicitly COLLAPSED, never what is expanded — so a freshly loaded Workspace or a
  // newly created Group opens on first appearance, while a folder the user closed stays closed
  // across the next background model rebuild (the live git-status refresh).
  const [collapsedItems, setCollapsedItems] = useState<ReadonlySet<string>>(() => new Set())

  // `expandedItems` is a CONTROLLED Headless Tree substate: every container minus the user's
  // collapses. Recomputing it on each `treeModel` change hands Headless Tree a fresh array, which
  // is exactly what makes it re-walk the data loader in the SAME render — so files added/removed by
  // a Commit, drag, or boot load show immediately instead of one render behind (the old
  // `tree.setState` effect could not do this: core discards that updater).
  const expandedItems = useMemo(
    () => treeModel.expandedIds.filter((id) => !collapsedItems.has(id)),
    [treeModel, collapsedItems],
  )

  const handleSetExpanded = useCallback(
    (next: string[] | ((prev: string[]) => string[])) => {
      const nextList = typeof next === 'function' ? next(expandedItems) : next
      const nextExpanded = new Set(nextList)
      // Headless Tree gives us the full expanded set after a user expand/collapse; invert it into
      // the collapsed set so the "open by default" rule above keeps holding.
      const collapsed = new Set<string>()
      for (const id of treeModel.expandedIds) if (!nextExpanded.has(id)) collapsed.add(id)
      setCollapsedItems(collapsed)
    },
    [expandedItems, treeModel],
  )

  // Build the Headless Tree model. The data source is a pure node model derived from the scoped
  // den-session store; `expandedItems` is controlled (above) so model changes re-render the tree
  // from new data. Selection stays uncontrolled (the row highlight is driven by the store's
  // `selected` via DotdenTree's `selectedPath`); we only seed the initial keyboard selection.
  const tree = useTree<DotdenTreeNode>({
    rootItemId: treeModel.rootId,
    state: { expandedItems },
    setExpandedItems: handleSetExpanded,
    initialState: {
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
