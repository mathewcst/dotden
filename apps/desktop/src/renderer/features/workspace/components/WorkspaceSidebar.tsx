import { useMemo, useState, type ReactNode } from 'react'
import { ChevronDown, ChevronRight, Folder, FolderPlus, Plus } from 'lucide-react'
import type { Group, Workspace } from '../../../../main/foundation/myenv-store'
import type { FileTreeEntry } from '../../../../main/foundation/den-service'
import { cn } from '@/shared/lib/utils'

/**
 * WorkspaceSidebar — the user-authored organization layer of the left pane (issue 1-14).
 *
 * dotden organization is two-tiered (ADR 0005):
 * - **Workspaces** are the **access boundary** an environment subscribes to. The
 *   Workspace concept **stays invisible until a SECOND Workspace exists** — with only
 *   the default one, this component surfaces no Workspace UI at all, so simple setups
 *   stay simple. Creating a second Workspace (via the header `+`) reveals the sections.
 * - **Groups** are **pure organization** nested inside a Workspace — they change
 *   NEITHER access NOR a File's on-disk path. The user can create and nest them freely
 *   to tidy their Den.
 *
 * This renders the Workspace sections + nested Group tree and the affordances to create
 * each; the actual File rows (with their `@pierre/trees` git-status decorations) are
 * rendered by the parent via {@link WorkspaceSidebarProps.renderFiles}, scoped to the
 * Workspace/Group whose Files belong there. The whole tree is read from / written to the
 * synced `.myenv/` over IPC by the parent — nothing here is a fixture.
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
  /** Create a new Workspace (the access boundary). Reveals the concept once a 2nd exists. */
  readonly onCreateWorkspace: (label: string) => void
  /** Create a nested Group inside a Workspace (organization only). */
  readonly onCreateGroup: (workspaceId: string, label: string, parentId: string | null) => void
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
 * The organization sidebar. Below a second Workspace exists, it renders nothing but the
 * default Workspace's Files (the concept stays invisible); from the second on, it
 * renders the labelled Workspace sections with their nested Groups.
 */
export function WorkspaceSidebar({
  workspaces,
  files,
  renderFiles,
  onCreateWorkspace,
  onCreateGroup,
  busy,
}: WorkspaceSidebarProps) {
  // The Workspace concept is surfaced ONLY once a SECOND Workspace exists (issue 1-14):
  // a single default Workspace is never named in the UI, so simple setups stay simple.
  const conceptVisible = workspaces.length > 1
  const defaultWorkspace = workspaces[0]
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
      {conceptVisible ? (
        /* WORKSPACES header — shown only after a second Workspace exists. */
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
      ) : (
        <div className="flex items-center px-3 pt-2 pr-2 pb-1">
          <span className="text-muted-foreground font-mono text-[11px] font-medium tracking-[0.8px] uppercase">
            Files
          </span>
        </div>
      )}

      {conceptVisible ? (
        // ≥2 Workspaces: render each as a labelled section with its nested Group tree.
        workspaces.map((workspace) => (
          <WorkspaceSection
            key={workspace.id}
            workspace={workspace}
            fileCount={fileStatsByWorkspace.get(workspace.id)?.total ?? 0}
            hasRootFiles={(fileStatsByWorkspace.get(workspace.id)?.root ?? 0) > 0}
            renderFiles={renderFiles}
            onCreateGroup={onCreateGroup}
            busy={busy}
          />
        ))
      ) : defaultWorkspace ? (
        // Exactly one Workspace: the concept is invisible. We still render the default
        // Workspace's Groups (so a user who made Groups before adding a 2nd Workspace
        // keeps them) and its Files — but with NO Workspace chrome around them.
        <WorkspaceBody
          workspace={defaultWorkspace}
          hasRootFiles={(fileStatsByWorkspace.get(defaultWorkspace.id)?.root ?? 0) > 0}
          renderFiles={renderFiles}
          onCreateGroup={onCreateGroup}
          busy={busy}
          showGroupAffordance={defaultWorkspace.groups.length > 0}
        />
      ) : null}
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
  busy,
}: {
  workspace: Workspace
  fileCount: number
  hasRootFiles: boolean
  renderFiles: WorkspaceSidebarProps['renderFiles']
  onCreateGroup: WorkspaceSidebarProps['onCreateGroup']
  busy: boolean
}) {
  // The Workspace row is collapsible (matching the signature tree): the chevron is the
  // only affordance and the trailing count is the number of Files this Workspace owns.
  const [open, setOpen] = useState(true)
  return (
    <section className="px-2 pt-1">
      <button
        type="button"
        className="hover:bg-sidebar-accent flex w-full items-center gap-1.5 rounded-sm px-1.5 py-1.5 text-left"
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronDown
          className={cn(
            'text-muted-foreground size-3.5 transition-transform',
            !open && '-rotate-90',
          )}
        />
        <span className="text-foreground truncate text-[13px] font-medium">{workspace.label}</span>
        <span className="flex-1" />
        <span className="text-muted-foreground text-[11px]">{fileCount}</span>
      </button>
      {open ? (
        <WorkspaceBody
          workspace={workspace}
          hasRootFiles={hasRootFiles}
          renderFiles={renderFiles}
          onCreateGroup={onCreateGroup}
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
  busy,
  showGroupAffordance,
}: {
  workspace: Workspace
  hasRootFiles: boolean
  renderFiles: WorkspaceSidebarProps['renderFiles']
  onCreateGroup: WorkspaceSidebarProps['onCreateGroup']
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
  busy,
}: {
  node: GroupNode
  workspaceId: string
  depth: number
  renderFiles: WorkspaceSidebarProps['renderFiles']
  onCreateGroup: WorkspaceSidebarProps['onCreateGroup']
  busy: boolean
}) {
  const [open, setOpen] = useState(true)
  return (
    <div style={{ paddingLeft: depth * 10 }}>
      <button
        type="button"
        className="text-foreground hover:bg-sidebar-accent flex w-full items-center gap-1.5 rounded-sm px-1.5 py-1.5 text-left text-[13px]"
        onClick={() => setOpen((v) => !v)}
      >
        <ChevronRight
          className={cn('text-muted-foreground size-3.5 transition-transform', open && 'rotate-90')}
        />
        <Folder className="text-muted-foreground size-3.5" aria-hidden />
        <span className="truncate">{node.group.label}</span>
      </button>
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
