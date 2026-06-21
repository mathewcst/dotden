import { useEffect, useState } from 'react'
import { ClipboardCopy, FolderOpen, Loader2, SquareTerminal } from 'lucide-react'
import { Button } from '@/ui/button'
import { Switch } from '@/ui/switch'
import type { DiagnosticsSettings } from '@shared/settings'

/** Settings → Diagnostics: controls the standing Console and local support handoff actions. */
export function DiagnosticsTab() {
  const [settings, setSettings] = useState<DiagnosticsSettings | null>(null)
  const [busy, setBusy] = useState(false)
  const [status, setStatus] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    window.dotden.diagnostics
      .getSettings()
      .then((loaded) => {
        if (alive) setSettings(loaded)
      })
      .catch((caught: unknown) => {
        if (alive) setError(messageOf(caught, 'Could not load Diagnostics settings.'))
      })
    return () => {
      alive = false
    }
  }, [])

  async function updateConsoleEnabled(consoleEnabled: boolean) {
    const previous = settings
    const next = { consoleEnabled }
    setSettings(next)
    setBusy(true)
    setError(null)
    setStatus(null)
    try {
      setSettings(await window.dotden.diagnostics.setSettings(next))
    } catch (caught) {
      setSettings(previous)
      setError(messageOf(caught, 'Could not save Diagnostics settings.'))
    } finally {
      setBusy(false)
    }
  }

  async function copyDiagnostics() {
    setBusy(true)
    setError(null)
    setStatus(null)
    try {
      const result = await window.dotden.diagnostics.copyDiagnostics()
      setStatus(`Copied ${result.recordCount} diagnostic records.`)
    } catch (caught) {
      setError(messageOf(caught, 'Could not copy Diagnostics.'))
    } finally {
      setBusy(false)
    }
  }

  async function openLogLocation() {
    setBusy(true)
    setError(null)
    setStatus(null)
    try {
      await window.dotden.diagnostics.openLogLocation()
      setStatus('Opened log location.')
    } catch (caught) {
      setError(messageOf(caught, 'Could not open the Diagnostics log.'))
    } finally {
      setBusy(false)
    }
  }

  if (!settings) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 p-8 text-sm">
        {error ? (
          <span className="text-dd-red-400" role="alert">
            {error}
          </span>
        ) : (
          <>
            <Loader2 className="size-4 animate-spin" /> Loading Diagnostics settings…
          </>
        )}
      </div>
    )
  }

  return (
    <div className="flex max-w-2xl flex-col gap-8 p-8">
      <header className="space-y-1">
        <h2 className="text-foreground text-xl font-semibold tracking-tight">Diagnostics</h2>
        <p className="text-muted-foreground text-sm leading-relaxed">
          Inspect the completed CLI calls dotden makes, and copy a redacted support bundle when
          something needs debugging.
        </p>
      </header>

      {error ? (
        <p className="text-dd-red-400 text-xs" role="alert">
          {error}
        </p>
      ) : null}
      {status ? (
        <p className="text-dd-green-400 text-xs" role="status">
          {status}
        </p>
      ) : null}

      <div className="border-border bg-card divide-border divide-y rounded-lg border">
        <label className="flex cursor-pointer items-start gap-4 px-4 py-3.5">
          <span className="flex-1">
            <span className="text-foreground flex items-center gap-2 text-sm font-medium">
              <SquareTerminal className="size-4" /> Enable Console
            </span>
            <span className="text-muted-foreground block text-xs leading-relaxed">
              Keep a standing bottom-panel Console open with completed, redacted Command records.
              Error Details can still open when this is off.
            </span>
          </span>
          <span className="pt-0.5">
            <Switch
              checked={settings.consoleEnabled}
              disabled={busy}
              onCheckedChange={(checked) => void updateConsoleEnabled(checked)}
            />
          </span>
        </label>

        <div className="flex items-center justify-between gap-4 px-4 py-3.5">
          <div>
            <p className="text-foreground text-sm font-medium">Copy diagnostics</p>
            <p className="text-muted-foreground text-xs leading-relaxed">
              Copy a redacted bundle with app version, OS, and recent Command records.
            </p>
          </div>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void copyDiagnostics()}>
            <ClipboardCopy className="size-4" /> Copy
          </Button>
        </div>

        <div className="flex items-center justify-between gap-4 px-4 py-3.5">
          <div>
            <p className="text-foreground text-sm font-medium">Open log location</p>
            <p className="text-muted-foreground text-xs leading-relaxed">
              Reveal the local redacted Command log stored under this environment.
            </p>
          </div>
          <Button size="sm" variant="secondary" disabled={busy} onClick={() => void openLogLocation()}>
            <FolderOpen className="size-4" /> Open
          </Button>
        </div>
      </div>

      <p className="text-muted-foreground border-border bg-card rounded-md border p-3 text-xs leading-relaxed">
        Command records are captured only after a process finishes. The log is redacted before it is
        written, and copied diagnostics are redacted again before they reach the clipboard.
      </p>
    </div>
  )
}

function messageOf(caught: unknown, fallback: string): string {
  return caught instanceof Error && caught.message ? caught.message : fallback
}
