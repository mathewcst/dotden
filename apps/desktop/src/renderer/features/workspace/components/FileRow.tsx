import { File } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import type { FileTreeEntry } from '../../../../main/foundation/den-service'

/**
 * The local-axis git-status letter shown on a grouped File row, color-bound to dd/*
 * tokens (ADR 0017). Mirrors `@pierre/trees`' M/A/D/R/U decorations so the grouped
 * Workspace/Group view (issue 1-14) shows the same honest local status as the flat tree.
 */
const STATUS_TONE: Record<NonNullable<FileTreeEntry['status']>, string> = {
  modified: 'text-dd-amber-400',
  added: 'text-dd-green-400',
  deleted: 'text-dd-red-400',
  renamed: 'text-dd-blue-400',
  untracked: 'text-muted-foreground',
  // An OS-scoped-out File is dimmed (see `file.muted`); its letter stays muted too.
  ignored: 'text-muted-foreground',
}

const STATUS_LETTER: Record<NonNullable<FileTreeEntry['status']>, string> = {
  modified: 'M',
  added: 'A',
  deleted: 'D',
  renamed: 'R',
  untracked: 'U',
  ignored: '',
}

/**
 * FileRow — one File row inside a Workspace/Group bucket of the organization sidebar
 * (issue 1-14).
 *
 * When Files are organized into Groups, the flat `@pierre/trees` tree can no longer
 * render them grouped, so the grouped view draws its own rows. Each row still shows the
 * File's real local-axis status letter (from the same `den:tree` snapshot) and dims when
 * the File is muted (out of OS Scope), so the grouped view is as honest as the flat one.
 * Rows carry `data-item-path` so the existing right-click {@link RowContextMenu} resolves
 * the File the same way it does over the `@pierre/trees` rows.
 */
export function FileRow({
  file,
  selected,
  onSelect,
}: {
  file: FileTreeEntry
  selected: boolean
  onSelect: (targetPath: string) => void
}) {
  const leaf = file.targetPath.split('/').pop() ?? file.targetPath
  return (
    <button
      type="button"
      data-item-path={file.targetPath}
      className={cn(
        'hover:bg-sidebar-accent flex w-full items-center gap-1.5 rounded-sm px-1.5 py-1.5 text-left',
        selected && 'bg-secondary',
        file.muted && 'opacity-50',
      )}
      onClick={() => onSelect(file.targetPath)}
    >
      <File className="text-muted-foreground size-3.5 shrink-0" aria-hidden />
      <span className="text-foreground flex-1 truncate text-[13px]">{leaf}</span>
      {file.status && STATUS_LETTER[file.status] ? (
        <span className={cn('font-mono text-[11px] font-medium', STATUS_TONE[file.status])}>
          {STATUS_LETTER[file.status]}
        </span>
      ) : null}
    </button>
  )
}
