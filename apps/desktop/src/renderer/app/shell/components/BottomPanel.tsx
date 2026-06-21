import { CommandRecord } from '@/features/diagnostics/components/CommandRecord'
import { useDenSession } from '@/den-session'
import { IconButton } from '@/ui/icon-button'
import { ChevronDown, Copy, Filter, PanelBottomClose, Plus, X } from 'lucide-react'
import { useState } from 'react'

/** VSCode-style global bottom panel. Diagnostics is the first tab. */
export function BottomPanel() {
  const records = useDenSession((s) => s.diagnosticsRecords)
  const mode = useDenSession((s) => s.diagnosticsPanelMode)
  const traceId = useDenSession((s) => s.diagnosticsPanelTraceId)
  const close = useDenSession((s) => s.closeDiagnosticsPanel)
  const clear = useDenSession((s) => s.clearDiagnosticsView)
  const tabLabel = mode === 'details' ? 'Details' : 'Console'
  const [copyState, setCopyState] = useState<'idle' | 'copied' | 'error'>('idle')
  const [filtersOpen, setFiltersOpen] = useState(false)
  const [failuresOnly, setFailuresOnly] = useState(false)
  const [traceFilter, setTraceFilter] = useState('')
  const filtersEnabled = mode === 'console'
  const visibleRecords = records.filter((record) => {
    if (!filtersEnabled) return true
    if (failuresOnly && record.exitCode === 0) return false
    if (traceFilter.trim() && !record.traceId?.includes(traceFilter.trim())) return false
    return true
  })

  async function copyDiagnostics() {
    setCopyState('idle')
    try {
      await window.dotden.diagnostics.copyDiagnostics(traceId ?? undefined)
      setCopyState('copied')
    } catch {
      setCopyState('error')
    }
  }

  return (
    <section
      className={
        filtersOpen && filtersEnabled
          ? 'border-border bg-card grid min-h-0 grid-rows-[36px_auto_minmax(0,1fr)] border-t'
          : 'border-border bg-card grid min-h-0 grid-rows-[36px_minmax(0,1fr)] border-t'
      }
    >
      <header className="border-border bg-sidebar flex items-center border-b">
        <div className="flex h-full items-stretch">
          <button
            type="button"
            className="border-dd-ember-500 text-foreground bg-card flex items-center gap-2 border-t-2 px-3 text-xs font-medium"
          >
            {tabLabel}
            <span className="text-muted-foreground font-mono">{visibleRecords.length}</span>
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
          <span
            className={
              copyState === 'error'
                ? 'text-dd-red-400 px-1 text-xs'
                : 'text-dd-green-400 px-1 text-xs'
            }
            aria-live="polite"
          >
            {copyState === 'copied'
              ? 'Copied diagnostics'
              : copyState === 'error'
                ? 'Copy failed'
                : ''}
          </span>
          <IconButton aria-label="Copy diagnostics" onClick={() => void copyDiagnostics()}>
            <Copy />
          </IconButton>
          <IconButton
            aria-label="Filter diagnostics records"
            aria-pressed={filtersOpen}
            disabled={!filtersEnabled}
            onClick={() => setFiltersOpen((open) => !open)}
          >
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

      {filtersOpen && filtersEnabled ? (
        <div className="border-border bg-background flex items-center gap-3 border-b px-3 py-2 text-xs">
          <label className="flex items-center gap-2">
            <input
              type="checkbox"
              checked={failuresOnly}
              onChange={(event) => setFailuresOnly(event.currentTarget.checked)}
            />
            Failures
          </label>
          <label className="flex min-w-0 items-center gap-2">
            <span className="text-muted-foreground">traceId</span>
            <input
              value={traceFilter}
              onChange={(event) => setTraceFilter(event.currentTarget.value)}
              className="border-border bg-card text-foreground h-7 w-56 rounded border px-2 font-mono"
              placeholder="filter trace"
            />
          </label>
        </div>
      ) : null}

      <div className="min-h-0 overflow-auto">
        {visibleRecords.length > 0 ? (
          visibleRecords.map((record, index) => (
            <CommandRecord
              key={`${record.timestamp}-${record.command}-${record.traceId ?? 'no-trace'}-${index}`}
              record={record}
            />
          ))
        ) : (
          <div className="text-muted-foreground grid h-full place-items-center text-sm">
            {mode === 'details' ? 'No records for this Operation' : 'No Command records yet'}
          </div>
        )}
      </div>
    </section>
  )
}
