import { ChevronRight, GitCommitVertical } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import type { FileVersion } from '../../../../main/foundation/file-history'

/**
 * Render a File version's ISO author date as a readable, locale-aware timestamp for the
 * `CommitRow` meta line (file-history.md — "a human-readable timestamp so the user can
 * recognise the version").
 *
 * Falls back to the raw value when the date can't be parsed (a malformed git log line),
 * so the row always shows *something* rather than a blank — never fail silently.
 */
function formatTimestamp(iso: string): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return iso
  // Medium date + short time reads naturally ("Jun 16, 2026, 10:30 AM") without being noisy.
  return date.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

/**
 * CommitRow — one selectable version row in the History tab's version list (issue 2-01),
 * mirroring the design-system `CommitRow` SET (`313:790`, `State=Default|Selected`).
 *
 * Anatomy (file-history.md / components.md): a `git-commit` lead glyph (ember-tinted when
 * Selected) + the Commit `message` over `shortSha · timestamp`, an optional green **Current**
 * pill (for the version matching the current Den state), and a trailing disclosure
 * `chevron-right` that signals "this row opens a preview". The short SHA is rendered in
 * **amber** (the committed-SHA convention). The row carries NO restore button — restore is a
 * single action in the preview panel (issue 2-02), so this row's only job is selection.
 *
 * `State=Selected` is a deliberately LOUD affordance (the project's "legible to non-devs"
 * baseline): a `secondary` background, an **ember left rail**, and an ember commit-dot, so
 * "rows are pickable" reads at rest. Colors bind dd/* tokens (ADR 0017), never literal hex.
 */
export function CommitRow({
  version,
  selected,
  onSelect,
}: {
  version: FileVersion
  selected: boolean
  onSelect: (sha: string) => void
}) {
  return (
    <button
      type="button"
      data-version-sha={version.sha}
      aria-pressed={selected}
      onClick={() => onSelect(version.sha)}
      className={cn(
        'flex w-full items-start gap-2.5 px-3 py-2 text-left transition-colors',
        // Selection is loud: secondary tint + a 2px ember left rail (the design's strokeLeft).
        selected
          ? 'bg-secondary border-dd-ember-500 border-l-2 pl-[10px]'
          : 'hover:bg-secondary/50 border-l-2 border-transparent pl-[10px]',
      )}
    >
      {/* git-commit lead — ember-tinted (the commit-dot) when Selected, muted otherwise. */}
      <GitCommitVertical
        className={cn(
          'mt-0.5 size-4 shrink-0',
          selected ? 'text-dd-ember-400' : 'text-muted-foreground',
        )}
        aria-hidden
      />
      <span className="min-w-0 flex-1">
        {/* Message over Sha · Meta — the row data the user recognises the version by. */}
        <span className="flex items-center gap-2">
          <span className="text-foreground truncate text-sm font-medium">{version.message}</span>
          {/* The green "Current" pill marks the version matching the current Den state. */}
          {version.current ? (
            <span className="bg-dd-green-950 text-dd-green-400 shrink-0 rounded-full px-1.5 py-0.5 text-[10px] font-semibold tracking-wide">
              Current
            </span>
          ) : null}
        </span>
        <span className="text-muted-foreground mt-0.5 flex items-center gap-1.5 text-xs">
          {/* The committed SHA convention: amber, monospaced. */}
          <span className="text-dd-amber-400 font-mono">{version.shortSha}</span>
          <span aria-hidden>·</span>
          <span className="truncate">{formatTimestamp(version.committedAt)}</span>
        </span>
      </span>
      {/* Trailing disclosure chevron — "this row opens a preview" (the affordance hint). */}
      <ChevronRight className="text-muted-foreground mt-0.5 size-4 shrink-0" aria-hidden />
    </button>
  )
}
