import { cn } from '@/lib/utils'

/**
 * StatusTag — a small pill mirroring the design-system `StatusTag` (`43:32`). A
 * **bespoke** `den/` component (ADR 0036): a purely-presentational pill has no shadcn
 * behavioral equivalent, so custom is correct.
 *
 * Surfaces a File's state in dotden vocabulary: `tracked` (managed, recorded),
 * `committed-local` (Committed but local until pushed, ADR 0006), `pushed` (sent to the
 * Remote), or `incoming` (arriving from the Remote for a reviewed Apply). Colors bind
 * dd/* semantic tokens (ADR 0017) — never literal hex.
 *
 * Phase A keeps the existing 4 den states verbatim. The Figma's 7 git-diff states
 * (`added`/`modified`/`deleted`/`renamed`/`untracked`/`incoming`/`conflict`) are a
 * conscious Phase B expansion, not a silent drop (ADR 0036 consequences).
 */
export type FileStatus = 'tracked' | 'committed-local' | 'pushed' | 'incoming'

const TONE: Record<FileStatus, { label: string; className: string }> = {
  // Tracked-but-not-committed reads like a modification waiting to be recorded.
  tracked: { label: 'Tracked', className: 'bg-dd-amber-950 text-dd-amber-400' },
  // Local-until-pushed is the key honest state (ADR 0006): committed, not yet shared.
  'committed-local': { label: 'Committed · local', className: 'bg-dd-blue-950 text-dd-blue-400' },
  pushed: { label: 'Pushed', className: 'bg-dd-green-950 text-dd-green-400' },
  incoming: { label: 'Incoming', className: 'bg-dd-blue-950 text-dd-blue-400' },
}

/** A single status pill for a File row or header. */
export function StatusTag({ status, className }: { status: FileStatus; className?: string }) {
  const tone = TONE[status]
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1 rounded-full px-2 py-0.5 text-xs font-medium',
        tone.className,
        className,
      )}
    >
      {tone.label}
    </span>
  )
}
