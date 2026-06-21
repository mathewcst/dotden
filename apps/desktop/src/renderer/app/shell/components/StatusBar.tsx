import { useEffect, useState } from 'react'
import { Monitor, TerminalSquare } from 'lucide-react'
import type { EnvironmentWithAttribution } from '@shared/environments'
import { useDenSession } from '@/den-session'
import { syncStatus } from '@/app/shell/lib/sync-status'
import { cn } from '@/shared/lib/utils'

/** Full-width shell status bar with environment identity + Diagnostics badge. */
export function StatusBar() {
  const [self, setSelf] = useState<EnvironmentWithAttribution | null>(null)
  const [error, setError] = useState<string | null>(null)
  const role = useDenSession((s) => s.role)
  const remoteAxis = useDenSession((s) => s.remoteAxis)
  const pushQueued = useDenSession((s) => s.pushQueued)
  const busy = useDenSession((s) => s.busy)
  const shellError = useDenSession((s) => s.error)
  const diagnosticsErrorCount = useDenSession((s) => s.diagnosticsErrorCount)
  const panelOpen = useDenSession((s) => s.diagnosticsPanelOpen)
  const consoleEnabled = useDenSession((s) => s.diagnosticsConsoleEnabled)
  const togglePanel = useDenSession((s) => s.toggleDiagnosticsPanel)

  useEffect(() => {
    let active = true
    async function load() {
      try {
        const all = await window.dotden.environment.list()
        if (active) setSelf(all.find((environment) => environment.isSelf) ?? null)
      } catch (caught) {
        if (active)
          setError(caught instanceof Error ? caught.message : 'Could not load environment.')
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [])

  const diagnosticsState = consoleEnabled
    ? 'Console-on'
    : diagnosticsErrorCount > 0
      ? String(diagnosticsErrorCount)
      : 'Idle'
  const status = syncStatus({
    role,
    remoteAxis,
    pushQueued,
    busy,
    error: shellError,
    online: navigator.onLine,
  })

  return (
    <footer className="border-border bg-sidebar text-muted-foreground flex h-7 items-center gap-3 border-t px-3 text-xs">
      <div className="flex min-w-0 items-center gap-1.5">
        <Monitor className="size-3.5" aria-hidden />
        <span className="text-foreground truncate font-medium">
          {self?.label ?? 'This environment'}
        </span>
        <span className={cn('size-1.5 rounded-full', status.dotClassName)} aria-hidden />
        <span>{self?.os ?? window.dotden.platform}</span>
      </div>

      {error ? <span className="text-dd-red-400 truncate">{error}</span> : null}
      <div className="flex-1" />
      <span>{status.label}</span>
      <button
        type="button"
        className={cn(
          'flex h-5 items-center gap-1.5 rounded px-2 font-medium',
          panelOpen || consoleEnabled
            ? 'bg-dd-ember-950 text-dd-ember-300'
            : diagnosticsErrorCount > 0
              ? 'bg-dd-red-950 text-dd-red-300'
              : 'hover:bg-secondary text-muted-foreground hover:text-foreground',
        )}
        onClick={() => void togglePanel()}
      >
        <TerminalSquare className="size-3.5" />
        Diagnostics
        <span className="font-mono">{diagnosticsState}</span>
      </button>
    </footer>
  )
}
