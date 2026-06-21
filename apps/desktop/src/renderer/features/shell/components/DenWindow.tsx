import { BottomPanel } from '@/features/shell/components/BottomPanel'
import { CenterPane } from '@/features/shell/components/CenterPane'
import { DialogLayer } from '@/features/shell/components/DialogLayer'
import { ErrorBanner } from '@/features/shell/components/ErrorBanner'
import { LeftPane } from '@/features/shell/components/LeftPane'
import { RightInspector } from '@/features/shell/components/RightInspector'
import { StatusBar } from '@/features/shell/components/StatusBar'
import { TitleBar } from '@/features/shell/components/TitleBar'
import { useDenSession } from '@/features/shell/components/DenSessionProvider'
import { IncomingBanner } from '@/features/sync/components/IncomingBanner'
import { OfflineBanner } from '@/features/sync/components/OfflineBanner'
import { remoteAxisDecoration } from '@/features/shell/lib/remote-axis'
import type { FileTreeRowDecorationRenderer, GitStatusEntry } from '@pierre/trees'
import { useFileTree } from '@pierre/trees/react'
import { lazy, Suspense, useCallback, useEffect, useMemo } from 'react'
import type { FileTreeEntry } from '@shared/den'

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
    <div className="bg-background text-muted-foreground grid h-screen place-items-center text-sm">
      {label}
    </div>
  )
}

/**
 * Map dotden's local-axis status (the `chezmoi status` letters parsed in the main process) onto
 * `@pierre/trees`' `GitStatus` union, which drives the row's coloured M/A/D/R/U letter via
 * `setGitStatus` (the 1-00 spike recipe). A muted (out-of-OS-Scope) File renders as `ignored` so
 * `@pierre/trees` auto-dims the whole row.
 */
function toGitStatus(file: FileTreeEntry): GitStatusEntry | null {
  // Out-of-OS-Scope wins: an ignored row is dimmed regardless of any pending change, because it is
  // not applied on this environment at all (issue 1-07 muted rendering).
  if (file.muted) return { path: file.targetPath, status: 'ignored' }
  if (file.status === null) return null
  return { path: file.targetPath, status: file.status }
}

/**
 * DenWindow — the den window's composition root (ADR 0027, Phase 2; renamed from `Workspace.tsx`,
 * which lied: it is the den window, not a domain Workspace — ADR 0005). A thin three-pane frame
 * that owns the shared `@pierre/trees` model (shared by the title-bar search + the left tree), the
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
  const remoteAxis = useDenSession((s) => s.remoteAxis)
  const incomingFrom = useDenSession((s) => s.incomingFrom)
  const pushQueued = useDenSession((s) => s.pushQueued)
  const selected = useDenSession((s) => s.selected)
  const reviewing = useDenSession((s) => s.reviewing)
  const resolving = useDenSession((s) => s.resolving)
  const diagnosticsPanelOpen = useDenSession((s) => s.diagnosticsPanelOpen)
  const diagnosticsPanelMode = useDenSession((s) => s.diagnosticsPanelMode)
  const diagnosticsConsoleEnabled = useDenSession((s) => s.diagnosticsConsoleEnabled)
  const error = useDenSession((s) => s.error)

  const selectFile = useDenSession((s) => s.selectFile)
  const onRename = useDenSession((s) => s.onRename)
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

  // The local-axis git status for every File row (env A only; B rows are incoming-clean).
  const gitStatus = useMemo<GitStatusEntry[]>(
    () => (role === 'a' ? files.flatMap((f) => toGitStatus(f) ?? []) : []),
    [role, files],
  )

  // Remote-axis decoration lane (the 1-00 spike's `renderRowDecoration`, issue 1-09): the overlay
  // ↓ incoming / ⚠ conflict glyph painted LEFT of the local status letter, per File.
  const renderRowDecoration = useCallback<FileTreeRowDecorationRenderer>(
    ({ item }) => remoteAxisDecoration(remoteAxis.get(item.path)),
    [remoteAxis],
  )

  const handleSelectionChange = useCallback(
    (selectedPaths: readonly string[]) => void selectFile(selectedPaths[0] ?? null),
    [selectFile],
  )

  const initialSelectedPaths = useMemo(() => (selected ? [selected] : []), [selected])
  const renaming = useMemo(() => ({ onRename }), [onRename])
  const fileTreeOptions = useMemo(
    () => ({
      paths,
      initialExpansion: 'open' as const,
      initialSelectedPaths,
      gitStatus,
      renderRowDecoration,
      // Inline rename + drag-reorganize so managing many Files stays fast (issue 1-07).
      renaming,
      dragAndDrop: true,
      // Drive selection straight off the model so the center/inspector follow the tree.
      onSelectionChange: handleSelectionChange,
    }),
    [paths, initialSelectedPaths, gitStatus, renderRowDecoration, renaming, handleSelectionChange],
  )

  // Build the tree model with all interactions the issue asks for: search, inline rename,
  // drag-reorganize, the git-status axis, and the Remote decoration lane.
  const { model } = useFileTree(fileTreeOptions)

  // Keep the live model's git-status axis in sync when the File set/status changes (useFileTree only
  // seeds `gitStatus` at construction; later refreshes go through the model's imperative
  // `setGitStatus`, the 1-00 recipe). An external-system sync (the web component), not setState.
  useEffect(() => {
    model.setGitStatus(gitStatus)
  }, [model, gitStatus])

  // The title-bar advertises the native search chord; bind it at the shell layer that owns the
  // shared tree model so keyboard and mouse open the exact same search session.
  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key.toLowerCase() !== 'k' || (!event.metaKey && !event.ctrlKey)) return
      if (role !== 'a' || paths.length === 0) return
      event.preventDefault()
      model.openSearch()
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [model, paths.length, role])

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
  const banner = error ? (
    <ErrorBanner
      message={error.message}
      onViewDetails={error.traceId ? () => void openDiagnosticsPanel(error.traceId) : undefined}
      onRetry={error.retry ? () => void error.retry?.() : undefined}
    />
  ) : role === 'a' && pushQueued ? (
    <OfflineBanner />
  ) : role === 'a' && incomingCount > 0 ? (
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
    <div
      className={
        diagnosticsPanelOpen
          ? 'bg-background text-foreground grid h-screen grid-rows-[auto_auto_minmax(0,1fr)_minmax(160px,30vh)_auto]'
          : 'bg-background text-foreground grid h-screen grid-rows-[auto_auto_minmax(0,1fr)_auto]'
      }
    >
      <TitleBar
        onSearch={() => model.openSearch()}
        searchDisabled={role !== 'a' || paths.length === 0}
        onOpenSettings={onOpenSettings}
      />

      {banner}

      <div className="grid min-h-0 grid-cols-[284px_1fr_320px] overflow-hidden">
        <LeftPane model={model} />
        <CenterPane />
        <RightInspector />
      </div>

      {diagnosticsPanelOpen ? <BottomPanel /> : null}
      <StatusBar />
      <DialogLayer />
    </div>
  )
}
