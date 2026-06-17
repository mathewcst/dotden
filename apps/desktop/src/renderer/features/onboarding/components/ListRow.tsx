import { Folder, File as FileIcon, AlertTriangle } from 'lucide-react'
import { cn } from '@/shared/lib/utils'

/**
 * ListRow — the scan-result row of the Discover step (design: onboarding.md; Figma
 * `ListRow`, formerly `DiscoverRow`).
 *
 * Renders one discovered config as a selectable row: a leading **checkbox**
 * (`HasCheckbox`), a File/Folder icon, the **title** (file name), the **path** below
 * it, and a right-aligned **meta** (size). Picking the row toggles whether that File
 * is Tracked when the user advances the Discover step.
 *
 * dd/* tokens only (ADR 0017).
 *
 * **The amber `Warn` state (issue 2-07).** When `warn` is set, the SecretScanner
 * (issue 2-03) flagged this File as secret-bearing. The row is reconciled to the
 * **warn-not-block** model (roadmap "Soft-block detected secrets") — it is NOT shown
 * as Blocked/excluded and is NOT auto-deselected:
 *
 * - the checkbox stays a **real, selectable** control, so the user can still Track the File;
 * - the icon swaps to an amber `AlertTriangle` (warn tone, never destructive-red — catching
 *   a secret is non-destructive and the remedy, Convert to a Secret reference, is safe);
 * - the meta is replaced by an amber **"Secret · review at commit"** label.
 *
 * The secret itself is handled deliberately at Commit time: a Tracked warned File routes
 * through the commit-time warn step (`SecretWarning`, issue 2-03), where the user Converts to
 * a Secret reference or Commits anyway. This row only *flags*; it never excludes.
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
  /**
   * Whether the SecretScanner flagged this File as secret-bearing (issue 2-07). Drives the
   * amber `Warn` state — selectable still, never excluded — handled at Commit time. Defaults
   * to `false` (the neutral catalog-found row).
   */
  readonly warn?: boolean
}

/** A single discovered-config row, selectable via its leading checkbox. */
export function ListRow({
  title,
  path,
  meta,
  isFolder,
  checked,
  onToggle,
  warn = false,
}: ListRowProps) {
  return (
    <label
      className={cn(
        'border-border flex cursor-pointer items-center gap-3 rounded-md border px-3 py-2.5 text-sm transition-colors',
        // Selected wins the surface (ember); a warned-but-unselected row gets a faint amber
        // edge so the caution reads even when not picked. Warn never disables selection.
        checked
          ? 'bg-dd-ember-950 border-dd-ember-700'
          : warn
            ? 'bg-card border-dd-amber-950 hover:bg-accent'
            : 'bg-card hover:bg-accent',
      )}
    >
      <input
        type="checkbox"
        className="accent-dd-ember-500 size-4 shrink-0"
        checked={checked}
        onChange={onToggle}
      />
      {/* Warn → amber AlertTriangle (caution, not failure); else File/Folder icon. */}
      {warn ? (
        <AlertTriangle className="text-dd-amber-400 size-4 shrink-0" aria-hidden />
      ) : isFolder ? (
        <Folder className="text-muted-foreground size-4 shrink-0" />
      ) : (
        <FileIcon className="text-muted-foreground size-4 shrink-0" />
      )}
      <div className="min-w-0 flex-1">
        <div className="text-foreground truncate font-medium">{title}</div>
        <div className="text-muted-foreground truncate font-mono text-xs">{path}</div>
      </div>
      {/* Warn replaces the size meta with the amber "review at commit" caution; the File is
          still Trackable — the secret is resolved at Commit time, not excluded here. */}
      {warn ? (
        <span className="text-dd-amber-400 shrink-0 text-xs font-medium whitespace-nowrap">
          Secret · review at commit
        </span>
      ) : meta ? (
        <span className="text-muted-foreground shrink-0 text-xs">{meta}</span>
      ) : null}
    </label>
  )
}
