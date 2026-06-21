import { useRef, useState, type ReactNode } from 'react'
import { ContextMenu } from '@base-ui/react/context-menu'
import { ArrowUpFromLine, Download, EyeOff, GitCommitVertical, Trash2 } from 'lucide-react'

/**
 * The four row verbs offered on a right-click (issue 1-08), in menu order. Commit and
 * Apply are the everyday verbs; **Untrack** (`forget`) and **Delete everywhere**
 * (`destroy`) are the lifecycle/destructive verbs this slice introduces.
 */
export type RowVerb = 'commit' | 'apply' | 'untrack' | 'delete-everywhere'

/** Props for {@link RowContextMenu}. */
export interface RowContextMenuProps {
  /**
   * Invoked with the right-clicked File's destination-relative path and the chosen verb.
   * `path` is `null` when the right-click did not land on a tree row (the menu is then
   * suppressed) — callers never receive a verb without a target.
   */
  readonly onVerb: (path: string, verb: RowVerb) => void
  /** The tree (or any content) the right-click menu is attached to. */
  readonly children: ReactNode
}

/** One menu entry's static config — label, icon, and whether it reads as destructive. */
interface VerbEntry {
  readonly verb: RowVerb
  readonly label: string
  readonly icon: ReactNode
  readonly destructive?: boolean
}

/**
 * The verbs in menu order (CONTEXT.md vocabulary). Delete everywhere is visually
 * distinct: a separator above it + red text, so the destructive intent is separate
 * from the safe Untrack right next to it (issue 1-08 acceptance: visibly distinct).
 */
const VERBS: readonly VerbEntry[] = [
  { verb: 'commit', label: 'Commit changes', icon: <GitCommitVertical className="size-3.5" /> },
  { verb: 'apply', label: 'Apply', icon: <Download className="size-3.5" /> },
  { verb: 'untrack', label: 'Untrack', icon: <EyeOff className="size-3.5" /> },
  {
    verb: 'delete-everywhere',
    label: 'Delete everywhere',
    icon: <Trash2 className="size-3.5" />,
    destructive: true,
  },
]

/**
 * RowContextMenu — the right-click row action menu over the Workspace tree (issue 1-08).
 *
 * Wraps the tree in a `@base-ui/react` ContextMenu so right-clicking a row offers Commit,
 * Apply, **Untrack**, and **Delete everywhere** — the user acts on a File directly from the
 * tree. The right-clicked File is recovered from DOM attributes: every dotden tree row carries
 * `data-item-path="<targetPath>"` plus `data-item-type`, so the trigger's `contextmenu` handler
 * walks up from the event target to a real File row and remembers its path.
 *
 * Delete everywhere is rendered visibly distinct from Untrack — separated and in red —
 * so the destructive intent is unmistakably separate from the safe Untrack beside it.
 */
export function RowContextMenu({ onVerb, children }: RowContextMenuProps) {
  // The File the most recent right-click landed on; null when the click missed a row.
  const pathRef = useRef<string | null>(null)
  // Mirror it into state so the menu can suppress itself (render nothing actionable)
  // when the right-click did not hit a tree row.
  const [hasTarget, setHasTarget] = useState(false)

  // Resolve the right-clicked row's File path from the DOM. Every tree row exposes
  // `data-item-path`; `closest` walks up from whatever inner element was clicked.
  function onContextMenuCapture(event: React.MouseEvent<HTMLDivElement>) {
    const row = (event.target as HTMLElement).closest<HTMLElement>(
      '[data-item-path][data-item-type="file"]',
    )
    const path = row?.dataset.itemPath ?? null
    pathRef.current = path
    setHasTarget(path !== null)
  }

  return (
    <ContextMenu.Root>
      <ContextMenu.Trigger
        // Capture phase so we record the target BEFORE base-ui opens the menu.
        onContextMenuCapture={onContextMenuCapture}
        className="contents"
      >
        {children}
      </ContextMenu.Trigger>
      <ContextMenu.Portal>
        <ContextMenu.Positioner className="z-50 outline-none">
          <ContextMenu.Popup className="bg-popover text-popover-foreground border-border min-w-44 rounded-md border p-1 text-sm shadow-lg outline-none">
            {hasTarget
              ? VERBS.map((entry, index) => (
                  <div key={entry.verb}>
                    {/* Separate Delete everywhere from the safe verbs above it. */}
                    {entry.destructive ? (
                      <ContextMenu.Separator className="bg-border -mx-1 my-1 h-px" />
                    ) : null}
                    <ContextMenu.Item
                      className={`flex cursor-default items-center gap-2 rounded-sm px-2 py-1.5 outline-none select-none data-[highlighted]:bg-white/5 ${
                        entry.destructive ? 'text-dd-red-400 data-[highlighted]:bg-dd-red-950' : ''
                      }`}
                      onClick={() => {
                        const path = pathRef.current
                        if (path !== null) onVerb(path, entry.verb)
                      }}
                    >
                      {entry.icon}
                      {entry.label}
                    </ContextMenu.Item>
                    {index === 0 ? <SyncHint /> : null}
                  </div>
                ))
              : null}
          </ContextMenu.Popup>
        </ContextMenu.Positioner>
      </ContextMenu.Portal>
    </ContextMenu.Root>
  )
}

/**
 * A tiny inline reminder that the lifecycle verbs are local until Sync — keeps the menu
 * honest about what right-clicking a verb does (a Commit/Untrack/Delete is recorded
 * LOCALLY and travels on the next Sync, ADR 0006). Rendered as a non-interactive caption.
 */
function SyncHint() {
  return (
    <p className="text-muted-foreground flex items-center gap-1.5 px-2 py-1 text-[10px]">
      <ArrowUpFromLine className="size-3" /> Recorded locally — Sync now to share.
    </p>
  )
}
