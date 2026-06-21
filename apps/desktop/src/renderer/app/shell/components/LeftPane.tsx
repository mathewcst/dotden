import { DotdenTree, type DotdenHeadlessTree } from '@/features/workspace/components/DotdenTree'
import { AddInline, WorkspacesHeader } from '@/features/workspace/components/WorkspaceSidebar'
import { useDenSession } from '@/den-session'
import { FolderPlus, Loader2 } from 'lucide-react'

/**
 * LeftPane — the den window's left Workspace tree (ADR 0032).
 *
 * The tree is now a Headless Tree render over dotden's own node model: Workspaces/Groups are
 * organization, Folders are read-only reflections of real chezmoi target paths, and File rows carry
 * the existing context-menu data attributes. env B uses the same renderer for incoming Files.
 */
export function LeftPane({ tree }: { tree: DotdenHeadlessTree }) {
  const role = useDenSession((s) => s.role)
  const files = useDenSession((s) => s.files)
  const incoming = useDenSession((s) => s.incoming)
  const workspaces = useDenSession((s) => s.workspaces)
  const selected = useDenSession((s) => s.selected)
  const emptyDenWarning = useDenSession((s) => s.emptyDenWarning)
  const busy = useDenSession((s) => s.busy)
  const selectFile = useDenSession((s) => s.selectFile)
  const onRowVerb = useDenSession((s) => s.onRowVerb)
  const createWorkspace = useDenSession((s) => s.createWorkspace)
  const createGroup = useDenSession((s) => s.createGroup)
  const renameWorkspace = useDenSession((s) => s.renameWorkspace)
  const renameGroup = useDenSession((s) => s.renameGroup)
  const deleteWorkspace = useDenSession((s) => s.deleteWorkspace)
  const deleteGroup = useDenSession((s) => s.deleteGroup)
  const organizeTreeDrop = useDenSession((s) => s.organizeTreeDrop)

  if (role === 'b') {
    return (
      <aside className="border-border bg-sidebar flex h-full min-h-0 flex-col overflow-hidden border-r">
        <div className="flex items-center px-3 pt-2 pr-2 pb-1">
          <span className="text-muted-foreground font-mono text-[11px] font-medium tracking-[0.8px] uppercase">
            Files
          </span>
        </div>
        {incoming.length === 0 ? (
          <p className="text-muted-foreground px-2 py-3 text-xs">
            No incoming Files. Detect the Remote, then refresh.
          </p>
        ) : (
          <DotdenTree
            tree={tree}
            selectedPath={selected}
            onSelectFile={(path) => void selectFile(path)}
            onRowVerb={onRowVerb}
            label="Incoming Files"
            organizing={busy === 'organize'}
            readOnly
            onCreateGroup={createGroup}
            onRenameWorkspace={renameWorkspace}
            onRenameGroup={renameGroup}
            onDeleteWorkspace={deleteWorkspace}
            onDeleteGroup={deleteGroup}
            onDropNode={organizeTreeDrop}
          />
        )}
      </aside>
    )
  }

  const defaultWorkspace = workspaces[0]
  const loading = busy === 'load' && files.length === 0
  const empty = files.length === 0

  return (
    <aside className="border-border bg-sidebar flex h-full min-h-0 flex-col overflow-hidden border-r">
      <WorkspacesHeader busy={busy === 'organize'} onCreateWorkspace={createWorkspace} />

      {loading ? (
        <p className="text-muted-foreground flex items-center gap-2 px-2 py-3 text-xs">
          <Loader2 className="size-3.5 animate-spin" /> Reading your managed Files…
        </p>
      ) : empty ? (
        <p
          className={
            emptyDenWarning
              ? 'text-dd-amber-400 px-2 py-3 text-xs leading-relaxed'
              : 'text-muted-foreground px-2 py-3 text-xs'
          }
          role={emptyDenWarning ? 'alert' : undefined}
        >
          {emptyDenWarning ?? 'No Files yet. Track a File below to start managing it.'}
        </p>
      ) : (
        <DotdenTree
          tree={tree}
          selectedPath={selected}
          onSelectFile={(path) => void selectFile(path)}
          onRowVerb={onRowVerb}
          label="Workspace Files"
          organizing={busy === 'organize'}
          onCreateGroup={createGroup}
          onRenameWorkspace={renameWorkspace}
          onRenameGroup={renameGroup}
          onDeleteWorkspace={deleteWorkspace}
          onDeleteGroup={deleteGroup}
          onDropNode={organizeTreeDrop}
        />
      )}

      {defaultWorkspace ? (
        <div className="px-3 py-1">
          <AddInline
            title="New Group"
            icon={
              <span className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs">
                <FolderPlus className="size-3.5" /> New Group
              </span>
            }
            placeholder="Group name…"
            disabled={busy === 'organize'}
            onSubmit={(label) => createGroup(defaultWorkspace.id, label, null)}
          />
        </div>
      ) : null}
    </aside>
  )
}
