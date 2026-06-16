import { Folder, File as FileIcon } from 'lucide-react'
import { cn } from '@/lib/utils'

/**
 * ListRow — the scan-result row of the Discover step (design: onboarding.md; Figma
 * `ListRow`, formerly `DiscoverRow`).
 *
 * Renders one discovered config as a selectable row: a leading **checkbox**
 * (`HasCheckbox`), a File/Folder icon, the **title** (file name), the **path** below
 * it, and a right-aligned **meta** (size). Picking the row toggles whether that File
 * is Tracked when the user advances the Discover step.
 *
 * dd/* tokens only (ADR 0017). The amber `Warn` secret state of this row is the
 * Batch-E soft-warn handled by the commit-time secret flow — out of scope for the
 * 1-06 slice (it lands with the SecretScanner, issue 2-03/2-07), so this row carries
 * only the catalog-found neutral state.
 */
export interface ListRowProps {
  /** File name shown as the row title (e.g. `.zshrc`). */
  readonly title: string
  /** Destination-relative path shown beneath the title (e.g. `~/.zshrc`). */
  readonly path: string
  /** Right-aligned meta — typically the size, or "Folder" for a directory. */
  readonly meta?: string
  /** Whether this is a managed **Folder** (CONTEXT.md) — picks the icon + copy. */
  readonly isFolder?: boolean
  /** Whether the row is picked (checkbox state). */
  readonly checked: boolean
  /** Toggle handler for the checkbox / row click. */
  readonly onToggle: () => void
}

/** A single discovered-config row, selectable via its leading checkbox. */
export function ListRow({ title, path, meta, isFolder, checked, onToggle }: ListRowProps) {
  return (
    <label
      className={cn(
        'border-border flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 text-sm transition-colors',
        checked ? 'bg-dd-ember-950 border-dd-ember-700' : 'bg-card hover:bg-accent',
      )}
    >
      <input
        type="checkbox"
        className="accent-dd-ember-500 size-4 shrink-0"
        checked={checked}
        onChange={onToggle}
      />
      {isFolder ? (
        <Folder className="text-muted-foreground size-4 shrink-0" />
      ) : (
        <FileIcon className="text-muted-foreground size-4 shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <div className="text-foreground truncate font-medium">{title}</div>
        <div className="text-muted-foreground truncate font-mono text-xs">{path}</div>
      </div>
      {meta ? <span className="text-muted-foreground shrink-0 text-xs">{meta}</span> : null}
    </label>
  )
}
