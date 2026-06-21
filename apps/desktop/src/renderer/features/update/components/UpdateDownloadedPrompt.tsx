import { useEffect, useState } from 'react'
import { Download, Loader2 } from 'lucide-react'
import { Button } from '@/ui/button'
import type { DownloadedUpdate } from '@shared/app-info'

/**
 * UpdateDownloadedPrompt — the app-level "restart to install" surface (issue 3-21). The main
 * process owns download/install mechanics; the renderer only listens for a completed download and
 * offers the two user choices electron-updater can honor safely: restart now or defer.
 */
export function UpdateDownloadedPrompt() {
  const [update, setUpdate] = useState<DownloadedUpdate | null>(null)
  const [installing, setInstalling] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    return window.dotden.app.onUpdateDownloaded((downloaded) => {
      setUpdate(downloaded)
      setInstalling(false)
      setError(null)
    })
  }, [])

  if (!update) return null

  async function restartNow() {
    setInstalling(true)
    setError(null)
    try {
      await window.dotden.app.quitAndInstallUpdate()
    } catch (caught) {
      setInstalling(false)
      setError(messageOf(caught, 'Could not restart to install the update.'))
    }
  }

  return (
    <section
      className="border-border bg-card text-foreground fixed right-4 bottom-20 z-50 flex w-[min(420px,calc(100vw-32px))] items-start gap-3 rounded-lg border p-4 shadow-lg"
      role="status"
      aria-live="polite"
    >
      <Download className="text-dd-ember-400 mt-0.5 size-5 shrink-0" aria-hidden="true" />
      <div className="min-w-0 flex-1 space-y-3">
        <div className="space-y-1">
          <p className="text-sm font-medium">Update downloaded</p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            {update.version} is ready. Restart dotden to install it, or keep working and install it
            later.
          </p>
          {error ? (
            <p className="text-dd-red-400 text-xs" role="alert">
              {error}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <Button size="sm" onClick={() => void restartNow()} disabled={installing}>
            {installing ? <Loader2 className="size-3.5 animate-spin" /> : null}
            Restart now
          </Button>
          <Button
            size="sm"
            variant="outline"
            disabled={installing}
            onClick={() => setUpdate(null)}
          >
            Later
          </Button>
        </div>
      </div>
    </section>
  )
}

function messageOf(caught: unknown, fallback: string): string {
  return caught instanceof Error && caught.message ? caught.message : fallback
}
