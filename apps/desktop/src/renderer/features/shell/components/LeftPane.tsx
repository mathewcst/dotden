import { FileRow } from '@/features/workspace/components/FileRow'
import { RowContextMenu } from '@/features/workspace/components/RowContextMenu'
import { WorkspaceSidebar } from '@/features/workspace/components/WorkspaceSidebar'
import { useDenSession } from '@/features/shell/components/DenSessionProvider'
import { FileTree } from '@pierre/trees/react'
import { Loader2 } from 'lucide-react'
import { useMemo, type ComponentProps } from 'react'

/**
 * LeftPane — the den window's left Workspace tree (issue 1-07/1-14). Renders, by precedence:
 * a load placeholder; the grouped Workspace/Group sidebar once the organization layer is in play
 * (a 2nd Workspace exists OR any Group was created); or the flat `@pierre/trees` File tree with the
 * `WORKSPACES` header. Right-clicking any row offers the verbs (Commit · Apply · Untrack · Delete
 * everywhere), resolved from the row's `data-item-path`.
 *
 * The `@pierre/trees` model is built once in the shell (it is shared with the title-bar search) and
 * handed in; everything else reads the scoped den-session store.
 */
export function LeftPane({ model }: { model: ComponentProps<typeof FileTree>['model'] }) {
  const role = useDenSession((s) => s.role)
  const files = useDenSession((s) => s.files)
  const incoming = useDenSession((s) => s.incoming)
  const workspaces = useDenSession((s) => s.workspaces)
  const selected = useDenSession((s) => s.selected)
  const selectedGroup = useDenSession((s) => s.selectedGroup)
  const selectedWorkspace = useDenSession((s) => s.selectedWorkspace)
  const emptyDenWarning = useDenSession((s) => s.emptyDenWarning)
  const busy = useDenSession((s) => s.busy)
  const selectFile = useDenSession((s) => s.selectFile)
  const selectGroup = useDenSession((s) => s.selectGroup)
  const selectWorkspace = useDenSession((s) => s.selectWorkspace)
  const onRowVerb = useDenSession((s) => s.onRowVerb)
  const createWorkspace = useDenSession((s) => s.createWorkspace)
  const createGroup = useDenSession((s) => s.createGroup)

  // The paths the tree renders: real managed Files on A, incoming Files on B.
  const paths = useMemo(
    () => (role === 'a' ? files.map((f) => f.targetPath) : incoming.map((i) => i.targetPath)),
    [role, files, incoming],
  )
  const filesByWorkspaceAndGroup = useMemo(() => {
    const buckets = new Map<string, (typeof files)[number][]>()
    for (const file of files) {
      const key = `${file.workspaceId}\u0000${file.groupId ?? ''}`
      let bucket = buckets.get(key)
      if (!bucket) {
        bucket = []
        buckets.set(key, bucket)
      }
      bucket.push(file)
    }
    return buckets
  }, [files])

  // Switch to the grouped Workspace/Group sidebar (issue 1-14) once the organization layer is in
  // play: a SECOND Workspace exists OR the user has created any Group. Until then the flat tree is
  // shown and the Workspace concept stays invisible. env B always uses the flat incoming list.
  const useGroupedSidebar =
    role === 'a' && (workspaces.length > 1 || workspaces.some((w) => w.groups.length > 0))

  return (
    <aside className="border-border bg-sidebar flex flex-col overflow-hidden border-r">
      <div className="min-h-0 flex-1 overflow-auto px-1">
        {busy === 'load' && paths.length === 0 && !useGroupedSidebar ? (
          <p className="text-muted-foreground flex items-center gap-2 px-2 py-3 text-xs">
            <Loader2 className="size-3.5 animate-spin" /> Reading your managed Files…
          </p>
        ) : useGroupedSidebar ? (
          // Organization layer (issue 1-14): the Workspace concept is visible (a 2nd Workspace
          // exists) OR the user has organized Files into Groups, so render the Workspace sections +
          // nested Group tree instead of the flat tree. The File rows still carry `data-item-path`,
          // so the same right-click verbs work.
          <RowContextMenu onVerb={onRowVerb}>
            <WorkspaceSidebar
              workspaces={workspaces}
              files={files}
              busy={busy === 'organize'}
              onCreateWorkspace={createWorkspace}
              onCreateGroup={createGroup}
              onSelectWorkspace={selectWorkspace}
              onSelectGroup={selectGroup}
              selectedWorkspace={selectedWorkspace}
              selectedGroup={selectedGroup}
              renderFiles={(workspaceId, groupId) =>
                (filesByWorkspaceAndGroup.get(`${workspaceId}\u0000${groupId ?? ''}`) ?? []).map(
                  (f) => (
                    <FileRow
                      key={f.targetPath}
                      file={f}
                      selected={selected === f.targetPath}
                      onSelect={(path) => void selectFile(path)}
                    />
                  ),
                )
              }
            />
          </RowContextMenu>
        ) : (
          // Simple case: exactly one Workspace, no Groups → the Workspace concept is INVISIBLE
          // (issue 1-14). Render only the flat File list; no default Workspace chrome.
          <>
            <div className="flex items-center px-3 pt-2 pr-2 pb-1">
              <span className="text-muted-foreground font-mono text-[11px] font-medium tracking-[0.8px] uppercase">
                Files
              </span>
            </div>
            {paths.length === 0 ? (
              <p
                className={
                  role === 'a' && emptyDenWarning
                    ? 'text-dd-amber-400 px-2 py-3 text-xs leading-relaxed'
                    : 'text-muted-foreground px-2 py-3 text-xs'
                }
                role={role === 'a' && emptyDenWarning ? 'alert' : undefined}
              >
                {role === 'a' && emptyDenWarning
                  ? emptyDenWarning
                  : role === 'a'
                    ? 'No Files yet. Track a File below to start managing it.'
                    : 'No incoming Files. Detect the Remote, then refresh.'}
              </p>
            ) : (
              // Right-click any row for the verbs (Commit · Apply · Untrack · Delete everywhere);
              // the menu resolves which File from the row's data-item-path.
              <RowContextMenu onVerb={onRowVerb}>
                <FileTree model={model} className="text-sm" />
              </RowContextMenu>
            )}
          </>
        )}
      </div>
    </aside>
  )
}
