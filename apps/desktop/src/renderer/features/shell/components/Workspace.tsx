import { ConfirmDialog } from '@/shared/components/ConfirmDialog'
import { ConflictResolver } from '@/features/apply/components/ConflictResolver'
import { EnvironmentBadge } from '@/features/shell/components/EnvironmentBadge'
import { FileHistory } from '@/features/file-history/components/FileHistory'
import { FileRow } from '@/features/workspace/components/FileRow'
import { IncomingBanner } from '@/features/sync/components/IncomingBanner'
import { OfflineBanner } from '@/features/sync/components/OfflineBanner'
import { ReviewApply } from '@/features/apply/components/ReviewApply'
import { RowContextMenu, type RowVerb } from '@/features/workspace/components/RowContextMenu'
import { ScopeEditor } from '@/features/scope/components/ScopeEditor'
import { SecretPicker } from '@/features/secrets/components/SecretPicker'
import { SecretWarning } from '@/features/secrets/components/SecretWarning'
import { StatusTag, type FileStatus } from '@/shared/components/StatusTag'
import { Button } from '@/ui/button'
import { AddInline, WorkspaceSidebar } from '@/features/workspace/components/WorkspaceSidebar'
import { remoteAxisDecoration } from '@/features/shell/lib/remote-axis'
import { PatchDiff } from '@pierre/diffs/react'
import type {
  FileTreeRenameEvent,
  FileTreeRowDecorationRenderer,
  GitStatusEntry,
} from '@pierre/trees'
import { FileTree, useFileTree } from '@pierre/trees/react'
import {
  AlertTriangle,
  ArrowDownUp,
  Bell,
  ChevronDown,
  Download,
  FilePlus2,
  Folder,
  GitCommitVertical,
  GitMerge,
  Loader2,
  Plus,
  RefreshCw,
  Search,
  Settings2,
} from 'lucide-react'
import { IconButton } from '@/ui/icon-button'
import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import type { AutomationLevel } from '../../../../main/foundation/automation-policy'
import type {
  AffectedEnvironment,
  ConvertSecretRequest,
  FileTreeEntry,
  IncomingReviewItem,
  RemoteAxisMarker,
} from '../../../../main/foundation/den-service'
import type { Workspace as WorkspaceModel } from '../../../../main/foundation/myenv-store'
import type { Scope } from '../../../../main/foundation/os-scope'
import type { DetectedPasswordManager } from '../../../../main/foundation/pm-detect'
import type { PmPreference } from '../../../../main/foundation/pm-preference'
import type { SecretFinding } from '../../../../main/foundation/secret-scanner'

/** Discriminates which environment's role this shell is driving (A vs B copy/actions). */
type Role = 'a' | 'b'

/**
 * Map dotden's local-axis status (the `chezmoi status` letters parsed in the main
 * process) onto `@pierre/trees`' `GitStatus` union, which drives the row's coloured
 * M/A/D/R/U letter via `setGitStatus` (the 1-00 spike recipe). A muted (out-of-OS-Scope)
 * File renders as `ignored` so `@pierre/trees` auto-dims the whole row — the muted
 * rendering this slice owns (the rule that scopes it out is issue 1-15).
 */
function toGitStatus(file: FileTreeEntry): GitStatusEntry | null {
  // Out-of-OS-Scope wins: an ignored row is dimmed regardless of any pending change,
  // because it is not applied on this environment at all (issue 1-07 muted rendering).
  if (file.muted) return { path: file.targetPath, status: 'ignored' }
  if (file.status === null) return null
  return { path: file.targetPath, status: file.status }
}

/**
 * Workspace — the real three-pane workspace (issue 1-07): a `@pierre/trees` File tree
 * with git-status decorations + search + inline rename + drag-reorganize (left), a
 * `@pierre/diffs` diff of the selected File (center), and the inspector (right),
 * modeled on the signature screen.
 *
 * The tree, status axis, and per-File diff are all driven over IPC from the main
 * process (`window.dotden.den.tree` / `den.diff`, each a `_trace`-carrying call), so
 * the view is a faithful read of real chezmoi state — not a fixture. Every verb
 * (Track/Commit/Sync/Apply) refreshes the tree afterwards so the decorations stay
 * live. The A/B role switch is the MVP single-window stand-in for the two-environment
 * thread (issue 1-04): role `a` drives Track/Commit/Sync, role `b` Detect/Apply.
 *
 * Component seams kept clean for the slices that build on this (issue note): the row
 * `renderContextMenu` hook is left for right-click verbs (1-08), the inspector's
 * incoming callout for Review & Apply + the Remote `↓`/`⚠` decoration lane for 1-09,
 * the `WORKSPACES` grouping for 1-14, and the muted/`ignored` rendering for OS Scope
 * (1-15) — all reachable without reshaping this component.
 */
export function Workspace({ role, onOpenSettings }: { role: Role; onOpenSettings?: () => void }) {
  // env A: the managed File tree read from the main process (the real chezmoi view).
  const [files, setFiles] = useState<readonly FileTreeEntry[]>([])
  // The Workspace/Group tree (issue 1-14), read from the synced `.myenv/` over `den:tree`.
  // The Workspace concept stays invisible while exactly one Workspace exists.
  const [workspaces, setWorkspaces] = useState<readonly WorkspaceModel[]>([])
  const workspaceLabel = workspaces[0]?.label ?? 'Personal'
  // env B: incoming Files for a reviewed Apply (the 1-04 detect→apply half).
  const [incoming, setIncoming] = useState<readonly IncomingReviewItem[]>([])
  // The Remote axis (issue 1-09): the incoming/conflict markers per File for THIS
  // environment's tree decoration lane, plus the source environment label for the
  // top-level "N incoming from <env>" banner. Empty until a Sync surfaces incoming.
  const [remoteAxis, setRemoteAxis] = useState<ReadonlyMap<string, RemoteAxisMarker>>(new Map())
  const [incomingFrom, setIncomingFrom] = useState<string>('another environment')
  // Whether the dedicated Review & Apply surface is open (the banner/card CTA opens it).
  const [reviewing, setReviewing] = useState(false)
  // Whether the Conflict resolution surface is open (issue 1-11). Opened from the Remote
  // axis when a File is in ⚠ Conflict — the cross-environment merge the user resolves.
  const [resolving, setResolving] = useState(false)
  const [selected, setSelected] = useState<string | null>(null)
  // Which center-pane tab is active (issue 2-01 adds the live History tab). Changes is the
  // everyday diff; History is the per-File version list + read-only preview; Scope is 1-15.
  // env B (incoming review) only ever shows Changes, so this is meaningful on env A.
  const [centerTab, setCenterTab] = useState<'changes' | 'history'>('changes')
  const [diff, setDiff] = useState<string | null>(null)
  const [lastCommitMessage, setLastCommitMessage] = useState<string | null>(null)
  // An honest "nothing to commit" notice (not an error): the chosen Files already matched the
  // Den, so the Commit was a clean no-op (CommitResult.noop). Shown as neutral info, never the
  // red error channel — never fail loudly on a legitimate no-op (ADR 0001).
  const [commitNotice, setCommitNotice] = useState<string | null>(null)
  // This environment's automation level (issue 1-12). Auto-sync auto-pushes Commits and
  // changes the Commit/Sync copy; Manual leaves push to an explicit Sync now. Read once on
  // mount and refreshed when the user toggles it elsewhere (Settings, a later slice).
  const [automationLevel, setAutomationLevel] = useState<AutomationLevel>('manual')
  const autoSyncOn = automationLevel === 'auto-sync'
  // Whether the last Commit auto-pushed (Auto-sync) vs is local-until-Sync (Manual) — drives
  // the "Last commit" callout copy so the user always knows where their change actually is.
  const [lastCommitPushed, setLastCommitPushed] = useState(false)
  // Offline queue (issue 1-16): whether a push is currently QUEUED because this environment
  // is offline (ADR 0006 — the Commit recorded locally; its push waits for connectivity).
  // Drives the Offline banner. Refreshed after every Commit/Sync and on connectivity changes;
  // it is the main-process truth (`den.pushPending`), not a guess from `navigator.onLine`.
  const [pushQueued, setPushQueued] = useState(false)
  const [busy, setBusy] = useState<
    | null
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
  >(null)
  const [error, setError] = useState<string | null>(null)
  const [newPath, setNewPath] = useState('')

  // The pending destructive/lifecycle confirm (issue 1-08): which row verb is awaiting
  // confirmation, on which File, and — for Delete everywhere — the affected environments
  // the confirm must name before proceeding (null while none is open). `apply-deletion` is
  // an incoming **deletion** the user must confirm before Apply removes the real file
  // (invariant #4, ADR 0008) — applying it without confirmation would silently delete it.
  const [confirm, setConfirm] = useState<{
    verb: 'untrack' | 'delete-everywhere' | 'apply-deletion'
    path: string
    affected: readonly AffectedEnvironment[]
  } | null>(null)

  // The pending commit-time secret warn step (issue 2-03): the scan findings to caution about
  // plus the exact paths the user was Committing, so "Commit anyway" can proceed with them.
  // null while no warning is open. The scan runs BEFORE the Commit; a non-empty result opens
  // this amber warn step instead of Committing straight away (warn-never-block, ADR 0001).
  const [secretWarn, setSecretWarn] = useState<{
    findings: readonly SecretFinding[]
    paths: readonly string[]
  } | null>(null)

  // The pending step-2 password-manager picker (issue 2-05): the detected managers + remembered
  // preference for THIS environment, plus the File being converted. null while the picker is
  // closed. Opened from the warn step's Convert; converting writes the chezmoi `.tmpl` Secret
  // reference (only the reference enters the Den, never the raw secret) then Commits it.
  const [secretPicker, setSecretPicker] = useState<{
    managers: readonly DetectedPasswordManager[]
    preference: PmPreference | null
    targetPath: string
  } | null>(null)

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

  // Remote-axis decoration lane (the 1-00 spike's `renderRowDecoration`, issue 1-09).
  // The local axis (M/A/D/R/U) is owned by `setGitStatus`; this overlay lane paints the
  // independent Remote ↓ incoming / ⚠ conflict glyph directly LEFT of the status letter
  // (`↓ M`, `⚠ U`) per the spike geometry. The marker per File comes from the Remote-axis
  // map a Sync populated; a File with nothing incoming returns null (no overlay glyph).
  const renderRowDecoration = useCallback<FileTreeRowDecorationRenderer>(
    ({ item }) => remoteAxisDecoration(remoteAxis.get(item.path)),
    [remoteAxis],
  )

  // Inline rename: the user renames a File in place; we move its placement so the
  // tree, the synced `.myenv/`, and chezmoi stay in step. The faithful chezmoi move
  // (re-add under the new name + forget the old) is the 1-08 verb slice; here we keep
  // the optimistic tree edit and surface that persistence is pending so we never
  // silently imply a rename was written.
  const onRename = useCallback((event: FileTreeRenameEvent) => {
    setFiles((prev) =>
      prev.map((f) =>
        f.targetPath === event.sourcePath ? { ...f, targetPath: event.destinationPath } : f,
      ),
    )
    setSelected(event.destinationPath)
    setError(
      `Renamed in the tree. Persisting a rename to chezmoi lands with the row verbs (issue 1-08).`,
    )
  }, [])

  // Build the tree model with all interactions the issue asks for: search, inline
  // rename, drag-reorganize, the git-status axis, and the Remote decoration lane.
  const { model } = useFileTree({
    paths,
    initialExpansion: 'open',
    initialSelectedPaths: selected ? [selected] : [],
    gitStatus,
    renderRowDecoration,
    // Inline rename + drag-reorganize so managing many Files stays fast (issue 1-07).
    renaming: { onRename },
    dragAndDrop: true,
    // Drive selection straight off the model so the center/inspector follow the tree.
    onSelectionChange: (selectedPaths) => void selectFile(selectedPaths[0] ?? null),
  })

  // Keep the live model's git-status axis in sync when the File set/status changes
  // (useFileTree only seeds `gitStatus` at construction; later refreshes go through
  // the model's imperative `setGitStatus`, the 1-00 recipe). This is an
  // external-system sync (the web component), not a setState-in-effect.
  useEffect(() => {
    model.setGitStatus(gitStatus)
  }, [model, gitStatus])

  // Run an IPC action with consistent busy/error handling — never fail silently.
  const run = useCallback(async (kind: NonNullable<typeof busy>, fn: () => Promise<void>) => {
    setBusy(kind)
    setError(null)
    try {
      await fn()
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Operation failed.')
    } finally {
      setBusy(null)
    }
  }, [])

  // Select a File AND fetch its real `chezmoi diff` for the center pane (issue 1-07).
  // Done in this event path (not a selection-watching effect) so we never call
  // setState synchronously inside an effect (react-hooks/set-state-in-effect). A
  // monotonic token guards against an out-of-order response when the user clicks
  // through rows faster than the diff resolves (last selection wins). env B rows are
  // incoming-clean (no local copy yet), so they carry no local diff.
  const diffTokenRef = useRef(0)
  const selectFile = useCallback(
    async (path: string | null) => {
      setSelected(path)
      const token = ++diffTokenRef.current
      // A cleared selection can't have a History tab to show; snap back to Changes so the
      // active-tab highlight never disagrees with the body (the fall-through shows Changes).
      if (path === null) setCenterTab('changes')
      if (path === null || role !== 'a') {
        setDiff(null)
        return
      }
      setBusy('diff')
      try {
        const patch = await window.dotden.den.diff(path)
        if (token === diffTokenRef.current) setDiff(patch)
      } catch (caught) {
        if (token === diffTokenRef.current) {
          setError(caught instanceof Error ? caught.message : 'Could not load the diff.')
          setDiff(null)
        }
      } finally {
        if (token === diffTokenRef.current) setBusy((b) => (b === 'diff' ? null : b))
      }
    },
    [role],
  )

  // Refresh the managed File tree from the main process (the real chezmoi view).
  const reloadTree = useCallback(
    () =>
      run('load', async () => {
        const view = await window.dotden.den.tree()
        setFiles(view.files)
        setWorkspaces(view.workspaces)
      }),
    [run],
  )

  // Fetch the Remote axis for THIS environment (issue 1-09): the incoming/conflict
  // markers per File (for the tree decoration lane) + the source environment label (for
  // the top-level banner). This fetches the Remote, so it is the env-A side of "checking
  // for incoming" — run on load and after a Sync. Failures here must never break the
  // local tree, so it surfaces a soft error rather than throwing out of the caller.
  const refreshIncoming = useCallback(async () => {
    try {
      const summary = await window.dotden.den.incomingSummary()
      setRemoteAxis(new Map(summary.items.map((i) => [i.targetPath, i.marker])))
      setIncomingFrom(summary.fromEnvironmentLabel)
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : 'Could not check the Remote for incoming changes.',
      )
    }
  }, [])

  // Re-read whether a push is queued offline (issue 1-16) from the main process — the
  // authoritative durable-outbox state, not a `navigator.onLine` guess. Soft-fails: a read
  // error must never break the everyday view, so it surfaces nothing (the banner just stays
  // as it was). Only env A's everyday view owns the offline banner (env B drives its own flow).
  const refreshPushQueued = useCallback(async () => {
    try {
      setPushQueued(await window.dotden.den.pushPending())
    } catch {
      // A failed read leaves the banner unchanged — better than flickering it on a transient error.
    }
  }, [])

  // Connectivity detection (issue 1-16) via the browser's own `navigator.onLine` + the
  // `online`/`offline` events — the canonical renderer-side signal. On `online` we ask the
  // main process to FLUSH any push queued while offline (the reconnect retry, complementing
  // the main-process `powerMonitor` path), then refresh the banner; `offline` just refreshes
  // so the banner can appear promptly. The main process also pushes `net:reconnected` after a
  // wake-flush, which we treat the same way (re-read the queue). env A only.
  useEffect(() => {
    if (role !== 'a') return
    const onOnline = () => {
      void (async () => {
        try {
          await window.dotden.den.flushPushQueue()
        } catch (caught) {
          // A non-offline failure during flush (e.g. a server rejection) surfaces as an error;
          // an offline flush re-queues silently inside the main process (never throws here).
          setError(caught instanceof Error ? caught.message : 'Could not retry the queued push.')
        } finally {
          await refreshPushQueued()
        }
      })()
    }
    const onOffline = () => void refreshPushQueued()
    window.addEventListener('online', onOnline)
    window.addEventListener('offline', onOffline)
    const unsubscribeReconnect = window.dotden.net.onReconnected(() => void refreshPushQueued())
    return () => {
      window.removeEventListener('online', onOnline)
      window.removeEventListener('offline', onOffline)
      unsubscribeReconnect()
    }
  }, [role, refreshPushQueued])

  // env A starts by reading its real managed Files (env B waits for an explicit
  // Detect). App.tsx keys this component by role, so switching environments remounts
  // it and resets all state (the React `key` reset pattern). The initial load mirrors
  // the codebase convention: an `active`-guarded async fn that only setState's AFTER
  // the await, so a late reply after unmount is dropped and the no-setState-in-effect
  // rule is satisfied (it accepts post-await updates).
  useEffect(() => {
    if (role !== 'a') return
    let active = true
    async function loadInitial() {
      try {
        // This environment's automation level (issue 1-12) so the Commit/Sync copy and
        // the "Last commit" callout reflect Manual vs Auto-sync from first paint.
        const level = await window.dotden.automation.getLevel()
        if (active) setAutomationLevel(level)
        // Whether a push is queued offline (issue 1-16), so the Offline banner is correct
        // from first paint (e.g. the app launched still offline with a queued push).
        const queued = await window.dotden.den.pushPending()
        if (active) setPushQueued(queued)
        const view = await window.dotden.den.tree()
        if (active) {
          setFiles(view.files)
          setWorkspaces(view.workspaces)
        }
        // Also check the Remote for incoming changes so the tree's Remote-axis
        // decorations + the top-level banner are live on first paint (issue 1-09).
        if (active) {
          const summary = await window.dotden.den.incomingSummary()
          if (active) {
            setRemoteAxis(new Map(summary.items.map((i) => [i.targetPath, i.marker])))
            setIncomingFrom(summary.fromEnvironmentLabel)
          }
        }
      } catch (caught) {
        if (active) {
          setError(caught instanceof Error ? caught.message : 'Could not read your Files.')
        }
      }
    }
    void loadInitial()
    return () => {
      active = false
    }
  }, [role])

  // Subscribe to the TrayPoller's detect-only incoming push (issue 1-12): when the
  // always-on watcher sees another environment changed the Remote, refresh THIS window's
  // Remote axis + banner so the in-app surface matches the OS notification the poller
  // raised. Detect-only — this never Applies; it just re-checks for incoming. Only env A's
  // everyday view consumes it (env B drives its own explicit Detect).
  useEffect(() => {
    if (role !== 'a') return
    const unsubscribe = window.dotden.trayPoller.onIncoming(() => {
      void refreshIncoming()
    })
    return unsubscribe
    // refreshIncoming is a stable useCallback (no deps), so this binds once per mount.
  }, [role, refreshIncoming])

  // ── env A verbs ── (each refreshes the tree so decorations reflect new state)
  const track = () =>
    run('track', async () => {
      const targetPath = newPath.trim()
      if (!targetPath) return
      await window.dotden.den.track(targetPath)
      setNewPath('')
      await reloadTree()
      await selectFile(targetPath)
    })

  // The ACTUAL Commit body (un-wrapped) — records the Commit + reflects its result. Extracted so
  // the plain Commit path AND the Commit-anyway-with-allowlist path (issue 2-04) both record the
  // Commit identically, the latter sharing a SINGLE `run` span with its allowlist writes.
  const recordCommit = useCallback(
    async (paths: readonly string[]) => {
      if (paths.length === 0) return
      const result = await window.dotden.den.commit(paths)
      // A legitimate no-op: the chosen Files already match the Den (stale tree status). Say so
      // honestly and reload so the now-clean status disables the Commit button — never an error.
      if (result.noop) {
        setCommitNotice('Nothing to commit — your selected Files already match your Den.')
        setLastCommitMessage(null)
        await reloadTree()
        return
      }
      setCommitNotice(null)
      setLastCommitMessage(result.message)
      // Under Auto-sync the main process auto-pushed this Commit (result.pushed === true);
      // under Manual it stays local until Sync now. Reflect that so the callout copy is honest.
      setLastCommitPushed(result.pushed)
      // Offline queue (issue 1-16): an Auto-sync push that couldn't go out because we are
      // offline is QUEUED (result.queued) — show the offline banner; the Commit is safe.
      setPushQueued(result.queued)
      await reloadTree()
      // An auto-pushed Commit also fetched incoming as part of the round-trip — refresh the
      // Remote axis + banner so they stay live without the user pressing Sync now.
      if (result.pushed) await refreshIncoming()
    },
    [reloadTree, refreshIncoming],
  )

  // The ACTUAL Commit, once the secret warn step (if any) has been cleared (no allowlist edit).
  const performCommit = useCallback(
    (paths: readonly string[]) => run('commit', () => recordCommit(paths)),
    [run, recordCommit],
  )

  // Commit-time secret scan + warn (issue 2-03): scan the about-to-be-Committed set FIRST.
  // On findings, open the amber warn step instead of Committing straight away — a caution,
  // never a block (ADR 0001), so the user can still proceed via "Commit anyway". On no
  // findings, Commit immediately. Extracted so both the toolbar Commit and the row-verb
  // Commit share one scan-then-warn entry point.
  const commitWithScan = useCallback(
    (paths: readonly string[]) =>
      run('commit', async () => {
        if (paths.length === 0) return
        const findings = await window.dotden.den.scanCommit(paths)
        if (findings.length > 0) {
          // Stash the findings + the exact paths so "Commit anyway" can proceed with them.
          setSecretWarn({ findings, paths })
          return
        }
        await performCommit(paths)
      }),
    [run, performCommit],
  )

  // Commit-anyway past the warn step (issue 2-04). When `dontWarnAgain` is set, allowlist the
  // shown findings FIRST so this File stops warning on future Commits — synced + scoped per
  // File+match (a new/different secret here still warns), persisted by the main process into
  // `.myenv/` and staged into the SAME Commit so the decision travels with the next Sync. The
  // allowlist write NEVER prevents the Commit (warn-not-block, ADR 0001), which follows either way.
  const commitAnyway = useCallback(
    (findings: readonly SecretFinding[], paths: readonly string[], dontWarnAgain: boolean) =>
      run('commit', async () => {
        if (dontWarnAgain) {
          // Allowlist each distinct flagged finding (de-duplicated by the pure model in main).
          for (const finding of findings) {
            await window.dotden.den.allowlistSecret(finding)
          }
        }
        await recordCommit(paths)
      }),
    [run, recordCommit],
  )

  // Open step 2 (the password-manager picker, issue 2-05) for a flagged File. Detect the installed
  // managers + read this environment's remembered preference (both env-local), then surface the
  // picker. Convert is per-File: we target the FIRST flagged File (the common single-secret case),
  // which the warn step always has at least one of. Detection is read-only feature-detection.
  const openConvertPicker = useCallback(
    (findings: readonly SecretFinding[]) =>
      run('convert', async () => {
        const targetPath = findings[0]?.file
        if (!targetPath) return
        const [managers, preference] = await Promise.all([
          window.dotden.den.detectPasswordManagers(),
          window.dotden.den.pmPreference(),
        ])
        setSecretPicker({ managers, preference, targetPath })
      }),
    [run],
  )

  // Convert the flagged value into a chezmoi `.tmpl` Secret reference (issue 2-05). Writes the
  // reference/template call into source state + Commits it — ONLY the reference enters the Den, the
  // raw secret stays in the vault and chezmoi re-fetches it at Apply time. Refreshes the tree so the
  // now-converted File reflects its committed state.
  const convertSecret = useCallback(
    (request: ConvertSecretRequest) =>
      run('convert', async () => {
        const result = await window.dotden.den.convertSecret(request)
        setLastCommitMessage(result.commit.message)
        setLastCommitPushed(result.commit.pushed)
        setPushQueued(result.commit.queued)
        await reloadTree()
        if (result.commit.pushed) await refreshIncoming()
      }),
    [run, reloadTree, refreshIncoming],
  )

  const commit = () => {
    // Commit every managed File that has a pending local change (the modified/added set).
    const changed = files.filter((f) => !f.muted && f.status !== null).map((f) => f.targetPath)
    void commitWithScan(changed)
  }

  const push = () =>
    run('push', async () => {
      const result = await window.dotden.den.syncPush()
      // Offline queue (issue 1-16): a Sync that couldn't reach the Remote (offline) does NOT
      // throw — the push is queued and `result.queued` is true, so we show the offline banner.
      // A successful Sync clears it; the Commit(s) have now left this environment.
      setPushQueued(result.queued)
      setLastCommitPushed(result.pushed)
      // A Sync also checks for incoming, so refresh the Remote axis + banner afterwards.
      await refreshIncoming()
    })

  // ── env B verbs ──
  // Detect lists incoming Files so the inspector callout + the "Review & Apply" button
  // wake up; the actual reviewed Apply (one/all, per-file atomicity, retry) happens on
  // the dedicated Review & Apply surface (issue 1-09), opened by the button below.
  const list = () =>
    run('list', async () => {
      const items = await window.dotden.den.listIncoming()
      setIncoming(items)
      await selectFile(items[0]?.targetPath ?? null)
    })

  // ── Right-click row verbs (issue 1-08) ──
  // The four verbs the row context menu offers, routed by intent:
  // - Commit/Apply: everyday verbs, run immediately on the one right-clicked File.
  // - Untrack/Delete everywhere: destructive/lifecycle verbs — never run on the click.
  //   They OPEN a confirm first (never fail silently); Delete everywhere additionally
  //   fetches the affected environments so the confirm can name the blast radius.
  const onRowVerb = useCallback(
    (path: string, verb: RowVerb) => {
      if (verb === 'commit') {
        // Scan-then-warn before recording this one File's Commit (issue 2-03), same as the
        // toolbar Commit: a flagged secret opens the amber warn step, never silently commits.
        void commitWithScan([path])
        return
      }
      if (verb === 'apply') {
        // An incoming **deletion** is never applied without explicit confirmation (invariant
        // #4): applying it removes the real file. If the row is a deletion, OPEN a confirm
        // first; a normal incoming change applies straight through.
        const incomingItem = incoming.find((i) => i.targetPath === path)
        if (incomingItem?.requiresConfirmation) {
          setConfirm({ verb: 'apply-deletion', path, affected: [] })
          return
        }
        void run('apply', async () => {
          await window.dotden.den.apply([path])
          await reloadTree()
        })
        return
      }
      if (verb === 'untrack') {
        // Untrack is non-destructive (the File stays on disk), so it needs no blast radius.
        setConfirm({ verb: 'untrack', path, affected: [] })
        return
      }
      // Delete everywhere: load the affected environments BEFORE opening the confirm so
      // the destructive dialog can name every environment that loses the real path.
      void run('delete', async () => {
        const affected = await window.dotden.den.affectedEnvironments(path)
        setConfirm({ verb: 'delete-everywhere', path, affected })
      })
    },
    [run, reloadTree, incoming, commitWithScan],
  )

  // Carry out the verb the user CONFIRMED in the dialog. Each maps faithfully onto a
  // chezmoi verb (Untrack→forget, Delete everywhere→destroy, apply-deletion→a confirmed
  // `chezmoi apply` of the removed File) in the main process, then refreshes the tree so the
  // removed File disappears from the decorations.
  const runConfirmedVerb = useCallback(() => {
    if (!confirm) return
    const { verb, path } = confirm
    if (verb === 'apply-deletion') {
      // The user confirmed the incoming deletion: apply it, passing the path as a confirmed
      // deletion so the main process actually removes the real file (invariant #4).
      void run('apply', async () => {
        await window.dotden.den.apply([path], [path])
        if (selected === path) await selectFile(null)
        await reloadTree()
      })
      return
    }
    void run(verb === 'untrack' ? 'untrack' : 'delete', async () => {
      if (verb === 'untrack') await window.dotden.den.untrack(path)
      else await window.dotden.den.deleteEverywhere(path)
      // The File is gone from the Den: clear it from selection and refresh the tree.
      if (selected === path) await selectFile(null)
      await reloadTree()
    })
  }, [confirm, run, reloadTree, selectFile, selected])

  // ── Organization verbs (issue 1-14) — each mutates only the synced `.myenv/` and
  // refreshes the tree so the new Workspace/Group (and any re-filed File) shows up. ──

  // Create a Workspace (the access boundary). Creating the SECOND one is what reveals
  // the Workspace concept in the sidebar — until then the whole concept stays hidden.
  const createWorkspace = useCallback(
    (label: string) =>
      run('organize', async () => {
        await window.dotden.den.createWorkspace(label)
        await reloadTree()
      }),
    [run, reloadTree],
  )

  // Create a nested Group inside a Workspace (pure organization — never changes access
  // or any File's on-disk path; that invariant is owned in the main process).
  const createGroup = useCallback(
    (workspaceId: string, label: string, parentId: string | null) =>
      run('organize', async () => {
        await window.dotden.den.createGroup(workspaceId, label, parentId)
        await reloadTree()
      }),
    [run, reloadTree],
  )

  // File the selected File under a Group (or back to its Workspace root). Organization
  // only: the File's Workspace (access) and on-disk path are untouched.
  const moveSelectedToGroup = useCallback(
    (groupId: string | null) => {
      if (!selected) return
      void run('organize', async () => {
        await window.dotden.den.moveFileToGroup(selected, groupId)
        await reloadTree()
      })
    },
    [run, reloadTree, selected],
  )

  // Scope the selected File to specific OSes (issue 1-15). The main process CLAMPS the
  // request to the File's inherited Folder/Workspace Scope (narrowable, never broadenable)
  // and re-compiles the native `.chezmoiignore`, so we reload the tree to reflect the
  // EFFECTIVE Scope that was actually applied + the new muted state on this environment.
  const scopeSelectedFile = useCallback(
    (scope: Scope) => {
      if (!selected) return
      void run('organize', async () => {
        await window.dotden.den.setFileScope(selected, scope)
        await reloadTree()
      })
    },
    [run, reloadTree, selected],
  )

  // The header/inspector status pill for the selected File (the honest dotden state).
  const selectedFile = files.find((f) => f.targetPath === selected)
  const selectedIncoming = incoming.find((i) => i.targetPath === selected)
  const headerStatus: FileStatus | null = selectedIncoming
    ? 'incoming'
    : selectedFile && !selectedFile.muted && selectedFile.status !== null
      ? 'tracked'
      : null
  const changedCount = files.filter((f) => !f.muted && f.status !== null).length

  // Switch the left pane to the grouped Workspace/Group sidebar (issue 1-14) once the
  // organization layer is in play: a SECOND Workspace exists (the concept is now
  // visible) OR the user has created any Group to organize Files. Until then the flat
  // `@pierre/trees` tree is shown and the Workspace concept stays invisible. env B (the
  // incoming-review role) always uses the flat incoming list.
  const useGroupedSidebar =
    role === 'a' && (workspaces.length > 1 || workspaces.some((w) => w.groups.length > 0))

  // The Groups available for filing the selected File — those of its OWN Workspace, since
  // a Group belongs to exactly one Workspace (its access boundary, ADR 0005).
  const selectedFileGroups =
    workspaces.find((w) => w.id === selectedFile?.workspaceId)?.groups ?? []

  // How many changes are incoming for THIS environment (issue 1-09): drives the
  // top-level banner + inspector card. Only env A's everyday view shows the banner.
  const incomingCount = remoteAxis.size

  // Whether any incoming File is in ⚠ Conflict (issue 1-11): if so, the user must resolve
  // the cross-environment merge before those Files can be applied. Drives the resolve CTA.
  const conflictCount = [...remoteAxis.values()].filter((m) => m === 'conflict').length

  // The Conflict resolution surface (issue 1-11): the ⚠ CTA opens it. On close it
  // re-checks the Remote + tree so the decorations reflect what was resolved.
  if (resolving) {
    return (
      <ConflictResolver
        onClose={() => {
          setResolving(false)
          void refreshIncoming()
          void reloadTree()
        }}
      />
    )
  }

  // The dedicated Review & Apply surface (issue 1-09): the banner/card CTA opens it. On
  // close it re-checks the Remote so the tree decorations + banner reflect what is left.
  if (reviewing) {
    return (
      <ReviewApply
        onClose={() => {
          setReviewing(false)
          void refreshIncoming()
          void reloadTree()
        }}
      />
    )
  }

  return (
    <div className="bg-background text-foreground grid h-screen grid-rows-[auto_auto_1fr]">
      {/* Title bar — workspace switcher · centered search · sync · bell · settings · avatar
          (signature screen, Figma `Titlebar` 516:1424). gap-2 + flex-1 spacers on either
          side of the search keep it optically centered regardless of the side clusters. */}
      <header className="border-border bg-sidebar flex items-center gap-2 border-b px-3 py-2.5 text-sm">
        {/* Workspace switcher — folder + label + chevron. Presentational for now: the
            single-pane shell shows every Workspace in the tree, so there is no per-pane
            switch to wire yet (the chevron previews the post-v1 Workspace picker). */}
        <div className="text-foreground flex h-7 shrink-0 items-center gap-1.5 rounded-md px-2.5">
          <Folder className="text-muted-foreground size-4" aria-hidden />
          <span className="text-[13px] font-medium">{workspaceLabel}</span>
          <ChevronDown className="text-muted-foreground size-4" aria-hidden />
        </div>

        <div className="h-px flex-1" />

        {/* Centered ⌘K search — opens the tree's built-in search session (issue 1-07). */}
        <button
          type="button"
          className="bg-secondary text-muted-foreground hover:text-foreground flex w-[420px] shrink-0 items-center gap-2 rounded-md px-2.5 py-1.5 text-[13px]"
          onClick={() => model.openSearch()}
          disabled={role !== 'a' || paths.length === 0}
        >
          <Search className="size-3.5" />
          <span>Search files &amp; workspaces…</span>
          <kbd className="border-border text-muted-foreground ml-auto rounded border px-1.5 py-0.5 font-mono text-[11px]">
            ⌘K
          </kbd>
        </button>

        <div className="h-px flex-1" />

        {/* Right cluster — sync status · bell · settings · avatar. */}
        <div className="flex shrink-0 items-center gap-1">
          <span className="text-muted-foreground mr-1 flex items-center gap-1 pr-1 text-xs">
            <ArrowDownUp className="size-3" aria-hidden />
            {role === 'a' && incomingCount > 0 ? `${incomingCount} incoming` : 'Up to date'}
          </span>
          <IconButton aria-label="notifications">
            <Bell />
          </IconButton>
          {/* Open the Settings surface (issue 2-08): the app shows it over the Workspace. */}
          <IconButton aria-label="settings" onClick={onOpenSettings} disabled={!onOpenSettings}>
            <Settings2 />
          </IconButton>
          {/* User avatar — initials placeholder (no account model in v1). */}
          <span
            className="bg-background text-foreground ml-1 inline-flex size-7 items-center justify-center rounded-full text-xs font-medium"
            aria-hidden
          >
            {workspaceLabel.charAt(0).toUpperCase()}
          </span>
        </div>
      </header>

      {/* The Offline banner (issue 1-16): a persistent strip between the titlebar and the
          body, shown when this environment has a push QUEUED because it is offline (ADR
          0006 — the Commit is recorded locally; only the push waits). Functional, honest
          chrome, never a hard error — the work is safe and retries on reconnect / next Sync.
          Takes precedence over the incoming banner so the most urgent transient state shows;
          already-fetched incoming changes still Apply offline (only push is queued). */}
      {role === 'a' && pushQueued ? (
        <OfflineBanner />
      ) : /* The top-level "N incoming from <environment> — Review & Apply" entry (issue
            1-09): a persistent strip between the titlebar and the body (detach + insert,
            not overlay — sync-states spec). Only env A's everyday view, only when there is
            something incoming; its CTA jumps straight to the Review & Apply surface. The
            row keeps the body's height (auto row) rather than covering the pane headers. */
      role === 'a' && incomingCount > 0 ? (
        <IncomingBanner
          count={incomingCount}
          fromEnvironmentLabel={incomingFrom}
          onReview={() => setReviewing(true)}
        />
      ) : (
        // Keep the middle grid row collapsed when there is no banner (no layout shift).
        <div />
      )}

      <div className="grid grid-cols-[260px_1fr_300px] overflow-hidden">
        {/* Left pane — Workspace tree. */}
        <aside className="border-border bg-sidebar flex flex-col overflow-hidden border-r">
          <div className="min-h-0 flex-1 overflow-auto px-1">
            {busy === 'load' && paths.length === 0 && !useGroupedSidebar ? (
              <p className="text-muted-foreground flex items-center gap-2 px-2 py-3 text-xs">
                <Loader2 className="size-3.5 animate-spin" /> Reading your managed Files…
              </p>
            ) : useGroupedSidebar ? (
              // Organization layer (issue 1-14): the Workspace concept is visible (a 2nd
              // Workspace exists) OR the user has organized Files into Groups, so render
              // the Workspace sections + nested Group tree instead of the flat tree. The
              // File rows still carry `data-item-path`, so the same right-click verbs work.
              <RowContextMenu onVerb={onRowVerb}>
                <WorkspaceSidebar
                  workspaces={workspaces}
                  files={files}
                  busy={busy === 'organize'}
                  onCreateWorkspace={createWorkspace}
                  onCreateGroup={createGroup}
                  renderFiles={(workspaceId, groupId) =>
                    files
                      .filter((f) => f.workspaceId === workspaceId && f.groupId === groupId)
                      .map((f) => (
                        <FileRow
                          key={f.targetPath}
                          file={f}
                          selected={selected === f.targetPath}
                          onSelect={(path) => void selectFile(path)}
                        />
                      ))
                  }
                />
              </RowContextMenu>
            ) : (
              // Simple case: exactly one Workspace, no Groups → the Workspace concept is
              // INVISIBLE (issue 1-14). Just the `WORKSPACES` header (the `+` creates the
              // first extra Workspace, which reveals the concept) over the flat tree.
              <>
                <div className="flex items-center px-3 pt-2 pr-2 pb-1">
                  <span className="text-muted-foreground font-mono text-[11px] font-medium tracking-[0.8px] uppercase">
                    Workspaces
                  </span>
                  <div className="flex-1" />
                  <AddInline
                    title="New Workspace"
                    icon={<Plus className="size-3.5" />}
                    triggerClassName="hover:bg-sidebar-accent inline-flex size-6 items-center justify-center rounded-md"
                    placeholder="Workspace name…"
                    disabled={role !== 'a' || busy !== null}
                    onSubmit={createWorkspace}
                  />
                </div>
                {paths.length === 0 ? (
                  <p className="text-muted-foreground px-2 py-3 text-xs">
                    {role === 'a'
                      ? 'No Files yet. Track a File below to start managing it.'
                      : 'No incoming Files. Detect the Remote, then refresh.'}
                  </p>
                ) : (
                  // Right-click any row for the verbs (Commit · Apply · Untrack · Delete
                  // everywhere); the menu resolves which File from the row's data-item-path.
                  <RowContextMenu onVerb={onRowVerb}>
                    <FileTree model={model} className="text-sm" />
                  </RowContextMenu>
                )}
              </>
            )}
          </div>
          {/* This environment's editable label + git-log attribution (issue 1-05). */}
          <EnvironmentBadge />
        </aside>

        {/* Center pane — selected File header + tabs + diff. */}
        <main className="flex min-w-0 flex-col overflow-hidden">
          <div className="border-border flex items-center gap-3 border-b px-4 py-2">
            <span className="font-mono text-sm">
              {selected ? `~/${selected}` : 'Select a File'}
            </span>
            {headerStatus ? <StatusTag status={headerStatus} /> : null}
            {selectedFile?.muted ? (
              <span className="text-muted-foreground rounded-full px-2 py-0.5 text-xs">
                Scoped out of this OS
              </span>
            ) : null}
            <div className="ml-auto flex items-center gap-2">
              {role === 'a' ? (
                <>
                  <Button
                    size="sm"
                    disabled={busy !== null || changedCount === 0}
                    onClick={commit}
                    // Commit is never automatic at any level (ADR 0006/0008); the tooltip
                    // makes the Auto-sync nuance explicit: Auto-sync only auto-PUSHES the
                    // Commit you make here — it never decides WHAT to Commit.
                    title={
                      autoSyncOn
                        ? 'Record these changes into your Den. Auto-sync will push them automatically — but Committing is always your call.'
                        : 'Record these changes into your Den. They stay local until you Sync now.'
                    }
                  >
                    {busy === 'commit' ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <GitCommitVertical className="size-4" />
                    )}
                    Commit changes
                  </Button>
                  <Button
                    size="sm"
                    variant="secondary"
                    disabled={busy !== null}
                    onClick={push}
                    // Sync-now polish (issue 1-12): the tooltip makes the transport-not-apply
                    // distinction transparent. "Sync now" pushes pending Commits and fetches
                    // incoming, then PRESENTS incoming for review — it does NOT Apply.
                    title="Sync now: push your pending Commits and fetch incoming changes, then review them before Applying. Sync never Applies for you."
                  >
                    {busy === 'push' ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <RefreshCw className="size-4" />
                    )}
                    Sync now
                  </Button>
                </>
              ) : (
                <>
                  <Button size="sm" variant="secondary" disabled={busy !== null} onClick={list}>
                    {busy === 'list' ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <RefreshCw className="size-4" />
                    )}
                    Detect incoming
                  </Button>
                  <Button
                    size="sm"
                    disabled={busy !== null || incoming.length === 0}
                    onClick={() => setReviewing(true)}
                  >
                    {busy === 'apply' ? (
                      <Loader2 className="size-4 animate-spin" />
                    ) : (
                      <Download className="size-4" />
                    )}
                    Review &amp; Apply
                  </Button>
                </>
              )}
            </div>
          </div>

          {/* Tabs — Changes is the everyday diff; History (2-01) is the per-File version list +
              read-only preview; Scope (1-15) is surfaced in the inspector. History is meaningful
              for a managed File on env A (incoming-review env B has no committed history to show),
              so it is only selectable there. */}
          <div className="border-border text-muted-foreground flex items-center gap-4 border-b px-4 text-xs">
            <button
              type="button"
              onClick={() => setCenterTab('changes')}
              className={
                centerTab === 'changes'
                  ? 'text-foreground border-primary border-b-2 py-2 font-medium'
                  : 'hover:text-foreground border-b-2 border-transparent py-2'
              }
            >
              Changes
            </button>
            <button
              type="button"
              onClick={() => setCenterTab('history')}
              disabled={role !== 'a' || !selectedFile}
              className={
                centerTab === 'history'
                  ? 'text-foreground border-primary border-b-2 py-2 font-medium'
                  : 'hover:text-foreground border-b-2 border-transparent py-2 disabled:cursor-default disabled:opacity-50 disabled:hover:text-current'
              }
            >
              History
            </button>
            <span className="cursor-default py-2 opacity-50">Scope</span>
          </div>

          {/* env A: Track a File by path (a browse-pick stand-in for the MVP shell). */}
          {role === 'a' ? (
            <div className="border-border flex items-center gap-2 border-b px-4 py-2">
              <input
                className="border-input bg-background flex-1 rounded-md border px-3 py-1.5 font-mono text-sm"
                placeholder="~/.zshrc — File path to Track"
                value={newPath}
                onChange={(event) => setNewPath(event.target.value)}
                onKeyDown={(event) => {
                  if (event.key === 'Enter') track()
                }}
              />
              <Button size="sm" disabled={busy !== null || !newPath.trim()} onClick={track}>
                {busy === 'track' ? (
                  <Loader2 className="size-4 animate-spin" />
                ) : (
                  <FilePlus2 className="size-4" />
                )}
                Track
              </Button>
            </div>
          ) : null}

          {/* History tab (issue 2-01): the per-File version list + read-only preview, a
              master-detail surface that owns its own independent-scroll regions. Only for a
              managed File on env A; if the active tab is History but the selection no longer
              qualifies (e.g. the File was deselected), fall through to the Changes body. */}
          {centerTab === 'history' && role === 'a' && selectedFile ? (
            <FileHistory key={selected} targetPath={selectedFile.targetPath} />
          ) : (
            <div className="min-h-0 flex-1 overflow-auto p-4 text-sm">
              {selected === null ? (
                <p className="text-muted-foreground">
                  Select a File in the tree to see its changes.
                </p>
              ) : busy === 'diff' ? (
                <p className="text-muted-foreground flex items-center gap-2">
                  <Loader2 className="size-4 animate-spin" /> Loading diff…
                </p>
              ) : role === 'b' ? (
                <p className="text-muted-foreground">
                  Incoming Files have no local copy yet — review and Apply to write them.
                </p>
              ) : diff && diff.trim().length > 0 ? (
                <PatchDiff patch={diff} disableWorkerPool />
              ) : (
                <p className="text-muted-foreground">
                  No uncommitted changes — this File matches the Den.
                </p>
              )}
            </div>
          )}
        </main>

        {/* Right pane — inspector. */}
        <aside className="border-border bg-sidebar flex flex-col gap-4 overflow-auto border-l p-4 text-sm">
          {error ? (
            <div
              className="bg-dd-red-950 text-dd-red-400 rounded-md px-3 py-2 text-xs"
              role="alert"
            >
              {error}
            </div>
          ) : null}

          {/* Conflict callout (issue 1-11) — when the Remote axis shows ⚠ Conflicts, the
              user must resolve the cross-environment merge. Shown on env A's everyday view;
              its CTA opens the dedicated Conflict resolution surface. */}
          {role === 'a' && conflictCount > 0 ? (
            <section className="border-dd-red-900 bg-dd-red-950/40 rounded-md border p-3">
              <h2 className="text-dd-red-400 mb-1 flex items-center gap-1.5 text-xs font-semibold tracking-wide">
                <AlertTriangle className="size-3.5" /> {conflictCount}{' '}
                {conflictCount === 1 ? 'CONFLICT' : 'CONFLICTS'}
              </h2>
              <p className="text-muted-foreground text-xs">
                The same File changed here and on the Remote. Resolve the merge — dotden never picks
                a side for you.
              </p>
              <Button
                size="sm"
                variant="secondary"
                className="mt-3 w-full"
                disabled={busy !== null}
                onClick={() => setResolving(true)}
              >
                <GitMerge className="size-4" /> Resolve conflicts
              </Button>
            </section>
          ) : null}

          {/* Incoming-changes callout — the Review & Apply seam (built out in issue 1-09). */}
          {role === 'b' ? (
            <section className="border-border bg-card rounded-md border p-3">
              <h2 className="mb-2 flex items-center justify-between text-xs font-semibold tracking-wide">
                <span className="inline-flex items-center gap-1.5">
                  <Download className="size-3.5" /> INCOMING CHANGES
                </span>
                <span className="text-muted-foreground">{incoming.length}</span>
              </h2>
              {incoming.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  Nothing incoming. Detect the Remote to pull the Den, then refresh.
                </p>
              ) : (
                <>
                  <ul className="flex flex-col gap-1">
                    {incoming.map((item) => (
                      <li key={item.targetPath} className="flex items-center justify-between gap-2">
                        <span className="font-mono text-xs">{item.targetPath}</span>
                        <StatusTag status="incoming" />
                      </li>
                    ))}
                  </ul>
                  {/* The inspector card's own jump-to-review CTA (issue 1-09), mirroring
                      the design's "N incoming changes · Review & Apply" card button. */}
                  <Button
                    size="sm"
                    className="mt-3 w-full"
                    disabled={busy !== null}
                    onClick={() => setReviewing(true)}
                  >
                    <Download className="size-4" /> Review &amp; Apply
                  </Button>
                </>
              )}
            </section>
          ) : null}

          {/* FILE info — the inspector's per-File details (signature screen). */}
          <section>
            <h2 className="text-muted-foreground mb-2 text-xs font-semibold tracking-wide">FILE</h2>
            <dl className="grid grid-cols-[auto_1fr] items-center gap-x-3 gap-y-2 text-xs">
              <dt className="text-muted-foreground">Workspace</dt>
              <dd className="text-right">
                {selectedIncoming?.workspaceId ??
                  workspaces.find((w) => w.id === selectedFile?.workspaceId)?.label ??
                  workspaceLabel}
              </dd>
              <dt className="text-muted-foreground">Scope</dt>
              <dd className="text-right">
                {selectedFile?.muted ? (
                  // Scoped out of THIS OS → chezmoi ignores it here; the tree dims the row.
                  <span className="border-border text-muted-foreground rounded border px-1.5 py-0.5">
                    out of this OS
                  </span>
                ) : selectedFile && selectedFile.scope !== null ? (
                  // In scope here, but narrowed to a specific OS set (the effective Scope).
                  <span className="text-muted-foreground">{selectedFile.scope.join(', ')}</span>
                ) : (
                  // The universal Scope (null) applies on every OS.
                  <span className="text-muted-foreground">Every OS</span>
                )}
              </dd>
              <dt className="text-muted-foreground">Path</dt>
              <dd className="text-right font-mono break-all">{selected ?? '—'}</dd>
              <dt className="text-muted-foreground">Status</dt>
              <dd className="text-right">
                {selectedFile?.status ?? (selectedIncoming ? 'incoming' : 'unchanged')}
              </dd>
            </dl>
          </section>

          {/* ORGANIZE — file the selected File into a Group within its Workspace (issue
              1-14). Pure organization: this never changes the File's access (Workspace)
              or its on-disk path. Only shown for a managed File on env A once Groups
              exist; the Workspace owns the Groups, so the menu lists only its own. */}
          {role === 'a' && selectedFile ? (
            <section className="border-border bg-card rounded-md border p-3">
              <h2 className="text-muted-foreground mb-2 text-xs font-semibold tracking-wide">
                GROUP
              </h2>
              {selectedFileGroups.length === 0 ? (
                <p className="text-muted-foreground text-xs">
                  No Groups yet in this Workspace. Add one in the sidebar to organize Files — Groups
                  never change where a File lands or which environments apply it.
                </p>
              ) : (
                <select
                  className="border-input bg-background w-full rounded-md border px-2 py-1 text-xs"
                  value={selectedFile.groupId ?? ''}
                  disabled={busy !== null}
                  onChange={(event) => moveSelectedToGroup(event.target.value || null)}
                >
                  <option value="">— No Group (Workspace root) —</option>
                  {selectedFileGroups.map((group) => (
                    <option key={group.id} value={group.id}>
                      {group.label}
                    </option>
                  ))}
                </select>
              )}
            </section>
          ) : null}

          {/* OS SCOPE — scope the selected File to specific OSes (issue 1-15). The main
              process clamps the request to the File's inherited Folder/Workspace Scope
              (narrowable, never broadenable) and re-compiles the native `.chezmoiignore`;
              a scoped-out File renders muted here. Only for a managed File on env A. */}
          {role === 'a' && selectedFile ? (
            <ScopeEditor
              scope={selectedFile.scope}
              disabled={busy !== null}
              onChange={scopeSelectedFile}
            />
          ) : null}

          {role === 'a' && commitNotice ? (
            <p className="text-dd-blue-400 text-xs" role="status">
              {commitNotice}
            </p>
          ) : null}

          {role === 'a' && lastCommitMessage ? (
            <section className="border-border bg-card rounded-md border p-3">
              <h2 className="mb-1 text-xs font-semibold tracking-wide">LAST COMMIT</h2>
              <p className="font-mono text-xs wrap-break-word">{lastCommitMessage}</p>
              {/* Honest about where the change actually is: Auto-sync auto-pushed it to the
                  Remote; Manual leaves it local until Sync now (never imply a sync that did
                  not happen). */}
              {lastCommitPushed ? (
                <p className="text-dd-green-400 mt-2 text-xs">
                  Committed and synced — Auto-sync pushed this to your repo.
                </p>
              ) : (
                <p className="text-dd-blue-400 mt-2 text-xs">
                  Committed locally — this stays on this environment until you Sync now.
                </p>
              )}
            </section>
          ) : null}
        </aside>
      </div>

      {/* The Untrack / Delete-everywhere / incoming-deletion confirm (confirm-dialogs screen
          spec). Untrack is Default tone with copy that the File STAYS ON DISK everywhere;
          Delete everywhere is Destructive tone and NAMES every affected environment; an
          incoming deletion (invariant #4) is Destructive tone and states the real file is
          removed here — so the user always sees the consequence before confirming (never
          fail silently). */}
      {confirm ? (
        <ConfirmDialog
          open
          onOpenChange={(next) => {
            if (!next) setConfirm(null)
          }}
          tone={confirm.verb === 'untrack' ? 'default' : 'destructive'}
          confirmLabel={
            confirm.verb === 'untrack'
              ? 'Untrack'
              : confirm.verb === 'apply-deletion'
                ? 'Delete file'
                : 'Delete everywhere'
          }
          confirmDisabled={busy !== null}
          onConfirm={runConfirmedVerb}
          title={
            confirm.verb === 'untrack'
              ? `Untrack ${confirm.path}?`
              : confirm.verb === 'apply-deletion'
                ? `Apply incoming deletion of ${confirm.path}?`
                : `Delete ${confirm.path} everywhere?`
          }
          body={
            confirm.verb === 'untrack' ? (
              <>
                dotden will stop managing <span className="font-mono">{confirm.path}</span>. The
                real file <strong>stays on disk on every environment</strong> — nothing is deleted,
                and you can Track it again later.
              </>
            ) : confirm.verb === 'apply-deletion' ? (
              <>
                This File was removed from the Den on another environment. Applying the change will{' '}
                <strong>delete the real file</strong>{' '}
                <span className="font-mono">{confirm.path}</span> on this environment.
                <span className="mt-2 block">This can&rsquo;t be undone.</span>
              </>
            ) : (
              <>
                This removes <span className="font-mono">{confirm.path}</span> from your Den
                <strong> and deletes the real file</strong> on every environment where it applies:
                <span className="mt-2 flex flex-wrap gap-1.5">
                  {confirm.affected.map((env) => (
                    <span
                      key={env.id}
                      className="border-border text-foreground rounded border px-1.5 py-0.5 text-xs"
                    >
                      {env.label}
                      {env.isSelf ? ' (this environment)' : ''}
                    </span>
                  ))}
                </span>
                <span className="mt-2 block">This can&rsquo;t be undone.</span>
              </>
            )
          }
        />
      ) : null}

      {/* Commit-time secret warn step (issue 2-03): when the pre-Commit scan flagged a
          possible secret, show the amber warn caution BEFORE the Commit completes. It never
          blocks (ADR 0001) — "Commit anyway" proceeds with the exact stashed paths; Cancel
          closes without Committing so the user can go convert/edit the value. */}
      {secretWarn ? (
        <SecretWarning
          // Re-mount per warn session so the modal's choice/checkbox state starts fresh each
          // time (no reset effect — keeps state changes out of effects, react-patterns). The
          // session signature is this scan's exact paths, which differ per Commit attempt.
          key={secretWarn.paths.join('\u001f')}
          open
          onOpenChange={(next) => {
            if (!next) setSecretWarn(null)
          }}
          findings={secretWarn.findings}
          continueDisabled={busy !== null}
          onConvert={() => {
            // Convert → step 2, the password-manager picker (issue 2-05). Detect installed
            // managers + the remembered preference, then open the picker for the flagged File.
            // The warn step closes; nothing is Committed until the user converts.
            void openConvertPicker(secretWarn.findings)
          }}
          onCommitAnyway={(dontWarnAgain) => {
            // Commit anyway (issue 2-04): when the user ticked "Don't warn me about this File
            // again", allowlist the shown findings FIRST (synced, per File+match) so they stop
            // warning on future Commits — then record the Commit either way (warn-not-block).
            void commitAnyway(secretWarn.findings, secretWarn.paths, dontWarnAgain)
          }}
        />
      ) : null}

      {/* Secret flow step 2 (issue 2-05): the password-manager picker. Opened from the warn step's
          Convert; converting writes the chezmoi `.tmpl` Secret reference into source state + Commits
          it — only the reference enters the Den, the raw secret stays in the user's vault. */}
      {secretPicker ? (
        <SecretPicker
          // Re-mount per convert session so selection/input state starts fresh (react-patterns).
          key={secretPicker.targetPath}
          open
          onOpenChange={(next) => {
            if (!next) setSecretPicker(null)
          }}
          managers={secretPicker.managers}
          preference={secretPicker.preference}
          targetPath={secretPicker.targetPath}
          convertDisabled={busy !== null}
          onBack={() => {
            // Back → return to step 1 (the warn step is still stashed in secretWarn).
            setSecretPicker(null)
          }}
          onConvert={(request) => {
            void convertSecret(request)
          }}
        />
      ) : null}
    </div>
  )
}
