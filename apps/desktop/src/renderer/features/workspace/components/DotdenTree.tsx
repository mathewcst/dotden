import { useState, type ComponentProps, type CSSProperties, type DragEvent } from 'react'
import { ChevronRight, File, Folder, FolderPlus, Layers, LayoutGrid, Plus } from 'lucide-react'
import { useTree } from '@headless-tree/react'
import type { DotdenTreeNode } from '@/den-session'
import { RowContextMenu } from '@/features/workspace/components/RowContextMenu'
import { AddInline, WorkspaceActionsMenu } from '@/features/workspace/components/WorkspaceSidebar'
import { remoteAxisDecoration } from '@/den-session'
import { cn } from '@/lib/utils'

export type DotdenHeadlessTree = ReturnType<typeof useTree<DotdenTreeNode>>

const STATUS_TONE = {
  modified: 'text-dd-amber-400',
  added: 'text-dd-green-400',
  deleted: 'text-dd-red-400',
  renamed: 'text-dd-blue-400',
  untracked: 'text-muted-foreground',
  ignored: 'text-muted-foreground',
} as const

const STATUS_LETTER = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  untracked: 'U',
  ignored: '',
} as const

/**
 * Headless Tree renderer for dotden's Workspace/File model.
 *
 * Headless Tree owns keyboard focus, expansion, selection and search state; dotden owns the row
 * markup so every node uses shadcn/Tailwind tokens and carries the same data attributes consumed by
 * the existing File row context menu.
 */
export function DotdenTree({
  tree,
  selectedPath,
  onSelectFile,
  onRowVerb,
  label,
  organizing,
  readOnly = false,
  onCreateGroup,
  onRenameWorkspace,
  onRenameGroup,
  onDeleteWorkspace,
  onDeleteGroup,
  onDropNode,
}: {
  tree: DotdenHeadlessTree
  selectedPath: string | null
  onSelectFile: (targetPath: string) => void
  onRowVerb: ComponentProps<typeof RowContextMenu>['onVerb']
  label: string
  organizing: boolean
  /**
   * env B (the incoming-review list) renders the same tree but is a read-only review surface:
   * no drag, no Group/Workspace create/rename/delete. Its only root is a synthetic "Incoming
   * Files" Workspace that must never expose organize verbs (it isn't a real Workspace).
   */
  readOnly?: boolean
  onCreateGroup: (workspaceId: string, label: string, parentId: string | null) => void
  onRenameWorkspace: (workspaceId: string, label: string) => void
  onRenameGroup: (workspaceId: string, groupId: string, label: string) => void
  onDeleteWorkspace: (workspaceId: string) => void
  onDeleteGroup: (workspaceId: string, groupId: string) => void
  onDropNode: (dragged: DotdenTreeNode, target: DotdenTreeNode) => void
}) {
  // The Group row the pointer is currently over during a drag. Native HTML5 DnD gives no built-in
  // drop highlight, so we track the target ourselves and ring it — without this the drop is a guess.
  const [dropTargetId, setDropTargetId] = useState<string | null>(null)
  return (
    <RowContextMenu onVerb={onRowVerb}>
      <div className="flex h-full min-h-0 flex-col gap-1">
        {tree.isSearchOpen() ? (
          <input
            {...tree.getSearchInputElementProps()}
            className="border-border bg-background text-foreground placeholder:text-muted-foreground focus-visible:ring-ring mx-1 rounded-md border px-2 py-1 text-xs outline-none focus-visible:ring-1"
            placeholder="Search Files…"
            aria-label="Search Files"
            autoFocus
          />
        ) : null}
        <div {...tree.getContainerProps(label)} className="min-h-0 flex-1 overflow-auto px-1 pb-2">
          {tree
            .getItems()
            .filter((item) => item.getItemData().kind !== 'root')
            .map((item) => {
              const node = item.getItemData()
              const itemProps = item.getProps()
              const level = Math.max(0, item.getItemMeta().level - 1)
              const canDrag = !readOnly && (node.kind === 'file' || node.kind === 'group')
              const canDrop = !readOnly && node.kind === 'group'
              return (
                <div
                  {...itemProps}
                  key={item.getId()}
                  data-item-path={node.targetPath}
                  data-item-type={node.kind === 'file' ? 'file' : node.kind}
                  data-type="item"
                  style={{ '--tree-depth': level } as CSSProperties}
                  draggable={canDrag}
                  onDragStart={(event) => {
                    if (!canDrag) return
                    event.dataTransfer.effectAllowed = 'move'
                    event.dataTransfer.setData(
                      'application/x-dotden-tree-node',
                      JSON.stringify(node),
                    )
                  }}
                  onDragOver={(event) => {
                    if (!canDrop) return
                    event.preventDefault()
                    event.dataTransfer.dropEffect = 'move'
                    if (dropTargetId !== item.getId()) setDropTargetId(item.getId())
                  }}
                  onDragLeave={() => {
                    if (canDrop && dropTargetId === item.getId()) setDropTargetId(null)
                  }}
                  onDrop={(event) => {
                    if (!canDrop) return
                    setDropTargetId(null)
                    const dragged = readDraggedNode(event)
                    if (!dragged) return
                    event.preventDefault()
                    onDropNode(dragged, node)
                  }}
                  className={cn(
                    'hover:bg-sidebar-accent focus-visible:ring-ring flex w-full cursor-default items-center gap-1.5 rounded-sm py-1.5 pr-1.5 text-left outline-none focus-visible:ring-1',
                    'pl-[calc(0.375rem+(var(--tree-depth)*0.875rem))]',
                    item.isFocused() && 'ring-ring ring-1',
                    item.isMatchingSearch?.() && 'bg-sidebar-accent/70',
                    selectedPath && node.targetPath === selectedPath && 'bg-secondary',
                    dropTargetId === item.getId() && 'ring-dd-blue-400 bg-sidebar-accent ring-1',
                    node.file?.muted && 'opacity-50',
                  )}
                  onClick={(event) => {
                    // Headless Tree's own onClick (from itemProps) already focuses the row AND
                    // toggles folder expansion — calling expand/collapse again here would double-
                    // toggle (net no-op, the "can't collapse" bug). So we ONLY add file selection
                    // and let itemProps own focus + folder toggle (official "click behavior" recipe).
                    itemProps.onClick?.(event)
                    if (node.kind === 'file' && node.targetPath) {
                      onSelectFile(node.targetPath)
                      item.select?.()
                    }
                  }}
                >
                  <RowChevron expandable={item.isFolder()} expanded={item.isExpanded()} />
                  <TreeRowIcon node={node} />
                  <span className="text-foreground min-w-0 flex-1 truncate text-[13px]">
                    {node.name}
                  </span>
                  <RemoteMarker marker={node.remoteMarker} />
                  <StatusLetter node={node} />
                  {readOnly ? null : (
                    <TreeRowActions
                      node={node}
                      organizing={organizing}
                      onCreateGroup={onCreateGroup}
                      onRenameWorkspace={onRenameWorkspace}
                      onRenameGroup={onRenameGroup}
                      onDeleteWorkspace={onDeleteWorkspace}
                      onDeleteGroup={onDeleteGroup}
                    />
                  )}
                </div>
              )
            })}
        </div>
      </div>
    </RowContextMenu>
  )
}

/**
 * Disclosure chevron. Containers (Workspace/Group/Folder) get a rotating arrow so the hierarchy and
 * its open/closed state read at a glance; leaf Files get an equal-width spacer so every row's icon +
 * label align on the same column regardless of depth.
 */
function RowChevron({ expandable, expanded }: { expandable: boolean; expanded: boolean }) {
  if (!expandable) return <span className="size-3.5 shrink-0" aria-hidden />
  return (
    <ChevronRight
      className={cn(
        'text-muted-foreground size-3.5 shrink-0 transition-transform',
        expanded && 'rotate-90',
      )}
      aria-hidden
    />
  )
}

function TreeRowIcon({ node }: { node: DotdenTreeNode }) {
  if (node.kind === 'workspace') {
    return <LayoutGrid className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
  }
  if (node.kind === 'group') {
    return <Layers className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
  }
  if (node.kind === 'folder') {
    return <Folder className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
  }
  return <File className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
}

function RemoteMarker({ marker }: { marker: DotdenTreeNode['remoteMarker'] }) {
  const decoration = remoteAxisDecoration(marker)
  if (!decoration) return null
  return (
    <span
      className={cn(
        'shrink-0 font-mono text-[11px] font-medium',
        marker === 'conflict' ? 'text-dd-amber-400' : 'text-dd-blue-400',
      )}
      title={decoration.title}
    >
      {decoration.text}
    </span>
  )
}

function StatusLetter({ node }: { node: DotdenTreeNode }) {
  const status = node.file?.muted ? 'ignored' : node.file?.status
  if (!status || !STATUS_LETTER[status]) return null
  return (
    <span className={cn('shrink-0 font-mono text-[11px] font-medium', STATUS_TONE[status])}>
      {STATUS_LETTER[status]}
    </span>
  )
}

function TreeRowActions({
  node,
  organizing,
  onCreateGroup,
  onRenameWorkspace,
  onRenameGroup,
  onDeleteWorkspace,
  onDeleteGroup,
}: {
  node: DotdenTreeNode
  organizing: boolean
  onCreateGroup: (workspaceId: string, label: string, parentId: string | null) => void
  onRenameWorkspace: (workspaceId: string, label: string) => void
  onRenameGroup: (workspaceId: string, groupId: string, label: string) => void
  onDeleteWorkspace: (workspaceId: string) => void
  onDeleteGroup: (workspaceId: string, groupId: string) => void
}) {
  if (node.kind === 'workspace' && node.workspaceId) {
    return (
      <span
        className="ml-auto flex shrink-0 items-center gap-1"
        onClick={(event) => event.stopPropagation()}
      >
        <AddInline
          title="New Group"
          icon={<Plus className="size-3.5" />}
          triggerClassName="hover:bg-sidebar-accent inline-flex size-5 items-center justify-center rounded"
          placeholder="Group name…"
          disabled={organizing}
          onSubmit={(label) => onCreateGroup(node.workspaceId!, label, null)}
        />
        <WorkspaceActionsMenu
          label={node.name}
          disabled={organizing}
          onRename={(label) => onRenameWorkspace(node.workspaceId!, label)}
          onDelete={() => onDeleteWorkspace(node.workspaceId!)}
        />
      </span>
    )
  }

  if (node.kind === 'group' && node.workspaceId && node.groupId) {
    return (
      <span
        className="ml-auto flex shrink-0 items-center gap-1"
        onClick={(event) => event.stopPropagation()}
      >
        <AddInline
          title="New nested Group"
          icon={<FolderPlus className="size-3.5" />}
          triggerClassName="hover:bg-sidebar-accent inline-flex size-5 items-center justify-center rounded"
          placeholder="Group name…"
          disabled={organizing}
          onSubmit={(label) => onCreateGroup(node.workspaceId!, label, node.groupId!)}
        />
        <WorkspaceActionsMenu
          label={node.name}
          disabled={organizing}
          onRename={(label) => onRenameGroup(node.workspaceId!, node.groupId!, label)}
          onDelete={() => onDeleteGroup(node.workspaceId!, node.groupId!)}
        />
      </span>
    )
  }

  return null
}

function readDraggedNode(event: DragEvent<HTMLElement>): DotdenTreeNode | null {
  try {
    const raw = event.dataTransfer.getData('application/x-dotden-tree-node')
    if (!raw) return null
    return JSON.parse(raw) as DotdenTreeNode
  } catch {
    return null
  }
}
