import { useMemo, useState, type ReactNode } from 'react'
import { Menu } from '@base-ui/react/menu'
import {
  ChevronDown,
  ChevronRight,
  Folder,
  FolderPlus,
  MoreHorizontal,
  Pencil,
  Plus,
  Trash2,
} from 'lucide-react'
import type { Group, Workspace } from '@shared/workspace'
import type { FileTreeEntry } from '@shared/den'
import { cn } from '@/shared/lib/utils'

/**
 * WorkspaceSidebar — the user-authored organization layer of the left pane (issue 1-14).
 *
 * dotden organization is two-tiered (ADR 0005):
 * - **Workspaces** are the **access boundary** an environment subscribes to. The default
 *   Workspace is **seeded for the user** — issue 1-14's "the Workspace concept stays
 *   invisible" means the user never has to *manually create* it, NOT that the `WORKSPACES`
 *   section is hidden. The section + each Workspace node are always shown (matching the
 *   signature-screen design), so the `+` to add a second Workspace is always reachable.
 * - **Groups** are **pure organization** nested inside a Workspace — they change
 *   NEITHER access NOR a File's on-disk path. The user can create and nest them freely
 *   to tidy their Den.
 *
 * This renders one labelled section per Workspace + its nested Group tree and the
 * affordances to create each; the actual File rows (with their `@pierre/trees` git-status
 * decorations) are rendered by the parent via {@link WorkspaceSidebarProps.renderFiles},
 * scoped to the Workspace/Group whose Files belong there. The `WORKSPACES` header itself is
 * owned by the parent (see {@link WorkspacesHeader}) so it can stay pinned above the scroll
 * region. The whole tree is read from / written to the synced `.dotden/` over IPC by the
 * parent — nothing here is a fixture.
 */
export interface WorkspaceSidebarProps {
  /** Every Workspace in the Den (each carrying its nested Group tree), from `den:tree`. */
  readonly workspaces: readonly Workspace[]
  /** Every managed File with its Workspace + Group placement, from `den:tree`. */
  readonly files: readonly FileTreeEntry[]
  /**
   * Render the File rows that belong to one Workspace+Group bucket. Returning the
   * `@pierre/trees` tree (or a subset of it) keeps the git-status axis with the rows.
   * `groupId` is `null` for Files sitting directly under the Workspace root.
   */
  readonly renderFiles: (workspaceId: string, groupId: string | null) => ReactNode
  /** Create a nested Group inside a Workspace (organization only). */
  readonly onCreateGroup: (workspaceId: string, label: string, parentId: string | null) => void
  /** Rename a Workspace label. */
  readonly onRenameWorkspace: (workspaceId: string, label: string) => void
  /** Rename a Group label. */
  readonly onRenameGroup: (workspaceId: string, groupId: string, label: string) => void
  /** Delete an empty Workspace. */
  readonly onDeleteWorkspace: (workspaceId: string) => void
  /** Delete an empty Group. */
  readonly onDeleteGroup: (workspaceId: string, groupId: string) => void
  /** Select a Workspace as the active inspector target while preserving expand/collapse. */
  readonly onSelectWorkspace: (workspaceId: string) => void
  /** Select a Group as the active inspector target while preserving expand/collapse. */
  readonly onSelectGroup: (workspaceId: string, groupId: string) => void
  /** Currently selected Workspace inspector target. */
  readonly selectedWorkspace: string | null
  /** Currently selected Group inspector target. */
  readonly selectedGroup: { workspaceId: string; groupId: string } | null
  /** Whether an organize action is in flight (disables the affordances). */
  readonly busy: boolean
}

/** A Group plus the child Groups + Files nested beneath it, ready to render recursively. */
interface GroupNode {
  readonly group: Group
  readonly children: readonly GroupNode[]
}

/** Build the nested Group forest for a Workspace from its flat `parentId`-linked list. */
function buildGroupForest(groups: readonly Group[]): readonly GroupNode[] {
  const groupsByParent = new Map<string, Group[]>()
  for (const group of groups) {
    const key = group.parentId ?? ''
    const siblings = groupsByParent.get(key) ?? []
    siblings.push(group)
    groupsByParent.set(key, siblings)
  }

  const childrenOf = (parentId: string | null): readonly GroupNode[] =>
    (groupsByParent.get(parentId ?? '') ?? []).map((group) => ({
      group,
      children: childrenOf(group.id),
    }))
  return childrenOf(null)
}

/**
 * The `WORKSPACES` section header, owned by the parent so it can stay pinned above the
 * scroll region. Always shown (the default Workspace is seeded, not hidden — issue 1-14),
 * so the `+` to add a second Workspace is always reachable.
 */
export function WorkspacesHeader({
  busy,
  onCreateWorkspace,
}: {
  busy: boolean
  onCreateWorkspace: (label: string) => void
}) {
  return (
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
        disabled={busy}
        onSubmit={(label) => onCreateWorkspace(label)}
      />
    </div>
  )
}

/**
 * The organization sidebar body: one labelled, collapsible section per Workspace with its
 * nested Group tree. Every Workspace is always rendered (including the lone default one) —
 * the `WORKSPACES` header is rendered separately by the parent via {@link WorkspacesHeader}.
 */
export function WorkspaceSidebar({
  workspaces,
  files,
  renderFiles,
  onCreateGroup,
  onRenameWorkspace,
  onRenameGroup,
  onDeleteWorkspace,
  onDeleteGroup,
  onSelectWorkspace,
  onSelectGroup,
  selectedWorkspace,
  selectedGroup,
  busy,
}: WorkspaceSidebarProps) {
  const fileStatsByWorkspace = useMemo(() => {
    const stats = new Map<string, { total: number; root: number }>()
    for (const file of files) {
      const current = stats.get(file.workspaceId) ?? { total: 0, root: 0 }
      current.total += 1
      if (file.groupId === null) current.root += 1
      stats.set(file.workspaceId, current)
    }
    return stats
  }, [files])

  return (
    <div className="flex flex-col">
      {workspaces.map((workspace) => (
        <WorkspaceSection
          key={workspace.id}
          workspace={workspace}
          fileCount={fileStatsByWorkspace.get(workspace.id)?.total ?? 0}
          hasRootFiles={(fileStatsByWorkspace.get(workspace.id)?.root ?? 0) > 0}
          renderFiles={renderFiles}
          onCreateGroup={onCreateGroup}
          onRenameWorkspace={onRenameWorkspace}
          onRenameGroup={onRenameGroup}
          onDeleteWorkspace={onDeleteWorkspace}
          onDeleteGroup={onDeleteGroup}
          onSelectWorkspace={onSelectWorkspace}
          onSelectGroup={onSelectGroup}
          selectedWorkspace={selectedWorkspace}
          selectedGroup={selectedGroup}
          busy={busy}
        />
      ))}
    </div>
  )
}

/** One labelled Workspace section (rendered only when the concept is visible). */
function WorkspaceSection({
  workspace,
  fileCount,
  hasRootFiles,
  renderFiles,
  onCreateGroup,
  onRenameWorkspace,
  onRenameGroup,
  onDeleteWorkspace,
  onDeleteGroup,
  onSelectWorkspace,
  onSelectGroup,
  selectedWorkspace,
  selectedGroup,
  busy,
}: {
  workspace: Workspace
  fileCount: number
  hasRootFiles: boolean
  renderFiles: WorkspaceSidebarProps['renderFiles']
  onCreateGroup: WorkspaceSidebarProps['onCreateGroup']
  onRenameWorkspace: WorkspaceSidebarProps['onRenameWorkspace']
  onRenameGroup: WorkspaceSidebarProps['onRenameGroup']
  onDeleteWorkspace: WorkspaceSidebarProps['onDeleteWorkspace']
  onDeleteGroup: WorkspaceSidebarProps['onDeleteGroup']
  onSelectWorkspace: WorkspaceSidebarProps['onSelectWorkspace']
  onSelectGroup: WorkspaceSidebarProps['onSelectGroup']
  selectedWorkspace: WorkspaceSidebarProps['selectedWorkspace']
  selectedGroup: WorkspaceSidebarProps['selectedGroup']
  busy: boolean
}) {
  // The Workspace row is collapsible (matching the signature tree): the chevron is the
  // only affordance and the trailing count is the number of Files this Workspace owns.
  const [open, setOpen] = useState(true)
  return (
    <section className="px-2 pt-1">
      <div
        className={cn(
          'hover:bg-sidebar-accent flex w-full items-center gap-1.5 rounded-sm px-1.5 py-1.5',
          selectedWorkspace === workspace.id && 'bg-sidebar-accent text-foreground',
        )}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          onClick={() => {
            onSelectWorkspace(workspace.id)
            setOpen((v) => !v)
          }}
        >
          <ChevronDown
            className={cn(
              'text-muted-foreground size-3.5 transition-transform',
              !open && '-rotate-90',
            )}
          />
          <span className="text-foreground truncate text-[13px] font-medium">
            {workspace.label}
          </span>
          <span className="flex-1" />
          <span className="text-muted-foreground text-[11px]">{fileCount}</span>
        </button>
        <WorkspaceActionsMenu
          label={workspace.label}
          disabled={busy}
          onRename={(label) => onRenameWorkspace(workspace.id, label)}
          onDelete={() => onDeleteWorkspace(workspace.id)}
        />
      </div>
      {open ? (
        <WorkspaceBody
          workspace={workspace}
          hasRootFiles={hasRootFiles}
          renderFiles={renderFiles}
          onCreateGroup={onCreateGroup}
          onRenameGroup={onRenameGroup}
          onDeleteGroup={onDeleteGroup}
          onSelectGroup={onSelectGroup}
          selectedGroup={selectedGroup}
          busy={busy}
          showGroupAffordance
        />
      ) : null}
    </section>
  )
}

/** The Groups (nested) + root-level Files of one Workspace, with the add-Group affordance. */
function WorkspaceBody({
  workspace,
  hasRootFiles,
  renderFiles,
  onCreateGroup,
  onRenameGroup,
  onDeleteGroup,
  onSelectGroup,
  selectedGroup,
  busy,
  showGroupAffordance,
}: {
  workspace: Workspace
  hasRootFiles: boolean
  renderFiles: WorkspaceSidebarProps['renderFiles']
  onCreateGroup: WorkspaceSidebarProps['onCreateGroup']
  onRenameGroup: WorkspaceSidebarProps['onRenameGroup']
  onDeleteGroup: WorkspaceSidebarProps['onDeleteGroup']
  onSelectGroup: WorkspaceSidebarProps['onSelectGroup']
  selectedGroup: WorkspaceSidebarProps['selectedGroup']
  busy: boolean
  showGroupAffordance: boolean
}) {
  const forest = useMemo(() => buildGroupForest(workspace.groups), [workspace.groups])

  return (
    <div className="px-1">
      {/* Files directly under the Workspace root (not in any Group). */}
      {renderFiles(workspace.id, null)}

      {/* The nested Group tree. */}
      {forest.map((node) => (
        <GroupBranch
          key={node.group.id}
          node={node}
          workspaceId={workspace.id}
          depth={0}
          renderFiles={renderFiles}
          onCreateGroup={onCreateGroup}
          onRenameGroup={onRenameGroup}
          onDeleteGroup={onDeleteGroup}
          onSelectGroup={onSelectGroup}
          selectedGroup={selectedGroup}
          busy={busy}
        />
      ))}

      {/* Add a top-level Group to this Workspace. Shown whenever the user has already
          started organizing here, or whenever the Workspace concept is visible. */}
      {showGroupAffordance ? (
        <div className="px-2 py-1">
          <AddInline
            title="New Group"
            icon={
              <span className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs">
                <FolderPlus className="size-3.5" /> New Group
              </span>
            }
            placeholder="Group name…"
            disabled={busy}
            onSubmit={(label) => onCreateGroup(workspace.id, label, null)}
          />
        </div>
      ) : !hasRootFiles ? null : (
        // First-Group hint when the user has Files at the root but no Groups yet.
        <div className="px-2 py-1">
          <AddInline
            title="New Group"
            icon={
              <span className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1.5 text-xs">
                <FolderPlus className="size-3.5" /> Group these Files…
              </span>
            }
            placeholder="Group name…"
            disabled={busy}
            onSubmit={(label) => onCreateGroup(workspace.id, label, null)}
          />
        </div>
      )}
    </div>
  )
}

/** One Group node: its label (collapsible), its Files, a nested-Group affordance, children. */
function GroupBranch({
  node,
  workspaceId,
  depth,
  renderFiles,
  onCreateGroup,
  onRenameGroup,
  onDeleteGroup,
  onSelectGroup,
  selectedGroup,
  busy,
}: {
  node: GroupNode
  workspaceId: string
  depth: number
  renderFiles: WorkspaceSidebarProps['renderFiles']
  onCreateGroup: WorkspaceSidebarProps['onCreateGroup']
  onRenameGroup: WorkspaceSidebarProps['onRenameGroup']
  onDeleteGroup: WorkspaceSidebarProps['onDeleteGroup']
  onSelectGroup: WorkspaceSidebarProps['onSelectGroup']
  selectedGroup: WorkspaceSidebarProps['selectedGroup']
  busy: boolean
}) {
  const [open, setOpen] = useState(true)
  return (
    <div style={{ paddingLeft: depth * 10 }}>
      <div
        className={cn(
          'text-foreground hover:bg-sidebar-accent flex w-full items-center gap-1.5 rounded-sm px-1.5 py-1.5 text-[13px]',
          selectedGroup?.workspaceId === workspaceId &&
            selectedGroup.groupId === node.group.id &&
            'bg-sidebar-accent',
        )}
      >
        <button
          type="button"
          className="flex min-w-0 flex-1 items-center gap-1.5 text-left"
          onClick={() => {
            onSelectGroup(workspaceId, node.group.id)
            setOpen((v) => !v)
          }}
        >
          <ChevronRight
            className={cn(
              'text-muted-foreground size-3.5 transition-transform',
              open && 'rotate-90',
            )}
          />
          <Folder className="text-muted-foreground size-3.5" aria-hidden />
          <span className="truncate">{node.group.label}</span>
        </button>
        <WorkspaceActionsMenu
          label={node.group.label}
          disabled={busy}
          onRename={(label) => onRenameGroup(workspaceId, node.group.id, label)}
          onDelete={() => onDeleteGroup(workspaceId, node.group.id)}
        />
      </div>
      {open ? (
        <div className="pl-3">
          {/* This Group's Files. */}
          {renderFiles(workspaceId, node.group.id)}
          {/* Child Groups (nesting). */}
          {node.children.map((child) => (
            <GroupBranch
              key={child.group.id}
              node={child}
              workspaceId={workspaceId}
              depth={depth + 1}
              renderFiles={renderFiles}
              onCreateGroup={onCreateGroup}
              onRenameGroup={onRenameGroup}
              onDeleteGroup={onDeleteGroup}
              onSelectGroup={onSelectGroup}
              selectedGroup={selectedGroup}
              busy={busy}
            />
          ))}
          {/* Add a sub-Group nested under this one. */}
          <div className="px-2 py-0.5">
            <AddInline
              title="New nested Group"
              icon={
                <span className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-[11px]">
                  <FolderPlus className="size-3" /> Nested Group…
                </span>
              }
              placeholder="Group name…"
              disabled={busy}
              onSubmit={(label) => onCreateGroup(workspaceId, label, node.group.id)}
            />
          </div>
        </div>
      ) : null}
    </div>
  )
}

export function WorkspaceActionsMenu({
  label,
  disabled,
  onRename,
  onDelete,
}: {
  label: string
  disabled: boolean
  onRename: (label: string) => void
  onDelete: () => void
}) {
  return (
    <Menu.Root>
      <Menu.Trigger
        className="text-muted-foreground hover:text-foreground hover:bg-sidebar-accent rounded p-0.5 disabled:opacity-50"
        disabled={disabled}
        aria-label={`Actions for ${label}`}
        onClick={(event) => event.stopPropagation()}
      >
        <MoreHorizontal className="size-3.5" />
      </Menu.Trigger>
      <Menu.Portal>
        <Menu.Positioner side="bottom" align="end" sideOffset={4} className="z-50">
          <Menu.Popup className="border-border bg-popover text-popover-foreground min-w-40 rounded-md border p-1 shadow-lg">
            <Menu.Item
              className="hover:bg-accent flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm outline-none select-none"
              onClick={() => {
                const next = window.prompt('Rename', label)
                if (next?.trim()) onRename(next)
              }}
            >
              <Pencil className="size-3.5" /> Rename…
            </Menu.Item>
            <Menu.Separator className="bg-border my-1 h-px" />
            <Menu.Item
              className="text-dd-red-400 hover:bg-dd-red-950 flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-sm outline-none select-none"
              onClick={() => {
                if (window.confirm(`Delete "${label}"? Only empty items can be deleted.`)) {
                  onDelete()
                }
              }}
            >
              <Trash2 className="size-3.5" /> Delete…
            </Menu.Item>
          </Menu.Popup>
        </Menu.Positioner>
      </Menu.Portal>
    </Menu.Root>
  )
}

/**
 * A tiny inline "click → type a name → Enter" affordance, used for both creating a
 * Workspace and creating a Group. Keeps creation a one-field interaction rather than a
 * modal, and never fires with an empty name.
 */
export function AddInline({
  title,
  icon,
  triggerClassName,
  placeholder,
  disabled,
  onSubmit,
}: {
  title: string
  icon: ReactNode
  /** Overrides the trigger button's classes (e.g. to render it as an IconButton box). */
  triggerClassName?: string
  placeholder: string
  disabled?: boolean
  onSubmit: (label: string) => void
}) {
  const [editing, setEditing] = useState(false)
  const [value, setValue] = useState('')

  if (!editing) {
    return (
      <button
        type="button"
        title={title}
        aria-label={title}
        className={cn(
          'text-muted-foreground hover:text-foreground transition-colors',
          triggerClassName,
        )}
        disabled={disabled}
        onClick={() => setEditing(true)}
      >
        {icon}
      </button>
    )
  }

  const commit = () => {
    const label = value.trim()
    setEditing(false)
    setValue('')
    if (label) onSubmit(label)
  }

  return (
    <input
      autoFocus
      className="border-input bg-background w-full rounded border px-2 py-0.5 text-xs"
      placeholder={placeholder}
      value={value}
      disabled={disabled}
      onChange={(event) => setValue(event.target.value)}
      onBlur={commit}
      onKeyDown={(event) => {
        if (event.key === 'Enter') commit()
        if (event.key === 'Escape') {
          setEditing(false)
          setValue('')
        }
      }}
    />
  )
}
