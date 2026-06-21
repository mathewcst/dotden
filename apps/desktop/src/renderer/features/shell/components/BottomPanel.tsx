import { CommandRecord } from '@/features/diagnostics/components/CommandRecord'
import { useDenSession } from '@/features/shell/components/DenSessionProvider'
import { IconButton } from '@/ui/icon-button'
import { ChevronDown, Copy, Filter, PanelBottomClose, Plus, X } from 'lucide-react'

/** VSCode-style global bottom panel. Diagnostics is the first tab. */
export function BottomPanel() {
  const records = useDenSession((s) => s.diagnosticsRecords)
  const close = useDenSession((s) => s.closeDiagnosticsPanel)
  const clear = useDenSession((s) => s.clearDiagnosticsView)

  return (
    <section className="border-border bg-card grid min-h-0 grid-rows-[36px_minmax(0,1fr)] border-t">
      <header className="border-border bg-sidebar flex items-center border-b">
        <div className="flex h-full items-stretch">
          <button
            type="button"
            className="border-dd-ember-500 text-foreground bg-card flex items-center gap-2 border-t-2 px-3 text-xs font-medium"
          >
            Console
            <span className="text-muted-foreground font-mono">{records.length}</span>
          </button>
          <button
            type="button"
            className="text-muted-foreground flex w-9 items-center justify-center border-l opacity-60"
            aria-label="Add diagnostics tab"
            disabled
          >
            <Plus className="size-3.5" />
          </button>
        </div>

        <div className="flex-1" />
        <div className="flex items-center gap-1 px-2">
          <IconButton aria-label="Copy diagnostics" disabled>
            <Copy />
          </IconButton>
          <IconButton aria-label="Filter diagnostics records" disabled>
            <Filter />
          </IconButton>
          <IconButton aria-label="Clear diagnostics view" onClick={clear}>
            <X />
          </IconButton>
          <IconButton aria-label="Collapse diagnostics panel" onClick={close}>
            <ChevronDown />
          </IconButton>
          <IconButton aria-label="Close diagnostics panel" onClick={close}>
            <PanelBottomClose />
          </IconButton>
        </div>
      </header>

      <div className="min-h-0 overflow-auto">
        {records.length > 0 ? (
          records.map((record, index) => (
            <CommandRecord
              key={`${record.timestamp}-${record.command}-${record.traceId ?? 'no-trace'}-${index}`}
              record={record}
            />
          ))
        ) : (
          <div className="text-muted-foreground grid h-full place-items-center text-sm">
            No Command records yet
          </div>
        )}
      </div>
    </section>
  )
}
