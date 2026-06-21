import { Cloud } from 'lucide-react'
import { Banner } from '@/components/den/banner'

/**
 * OfflineBanner — the "Offline — changes queued" status strip (issue 1-16; see
 * [secret-and-errors](../../../docs/design-system/screens/secret-and-errors.md) §Offline,
 * Figma `Banner Offline`).
 *
 * A persistent inline strip between the titlebar and the body, shown whenever this
 * environment has a push **queued** because it is offline (ADR 0006: a Commit records
 * locally and its push waits for connectivity). It is functional, honest chrome — never
 * a hard error: the work is safe locally and will propagate automatically on reconnect or
 * the next Sync, which is exactly what the copy promises. The muted/`cloud` treatment
 * (not destructive-red) matches the spec: offline is a transient awareness state, not a
 * failure. The fuller offline state-surface is issue 3-08; this is the functional minimum.
 *
 * Self-consistency with the spec: the titlebar status glyph and the inspector env row also
 * read "Offline" while this is shown — see the Workspace wiring that gates this banner.
 */
export function OfflineBanner() {
  return (
    <Banner tone="offline">
      <Cloud className="size-4 shrink-0" aria-label="offline" />
      <span className="text-foreground font-medium">Offline — changes queued</span>
      <span className="text-muted-foreground/80">· Will sync when you reconnect</span>
    </Banner>
  )
}
