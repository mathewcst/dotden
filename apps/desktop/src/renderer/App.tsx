import { useState } from 'react'
import { GitBranch, Loader2, Sparkles } from 'lucide-react'
import { Button } from '@/components/ui/button'

function hostFromRemote(url: string) {
  try {
    return new URL(url).hostname
  } catch {
    return /^(?:[^@]+@)?([^:]+):/.exec(url)?.[1] ?? 'your Provider'
  }
}

export function App() {
  const [remoteUrl, setRemoteUrl] = useState('')
  const [status, setStatus] = useState<
    'idle' | 'checking' | 'reachable' | 'credential-error' | 'connecting'
  >('idle')
  const [message, setMessage] = useState('Paste an HTTPS or SSH git Remote URL to start.')

  async function checkRemote() {
    setStatus('checking')
    setMessage(`Checking credentials for ${hostFromRemote(remoteUrl)}…`)
    try {
      const result = await window.dotden.remote.preflight(remoteUrl)
      if (result.reachable) {
        setStatus('reachable')
        setMessage(
          `Reachable with ${result.gitCommand}. dotden will use your existing git credentials.`,
        )
      } else {
        setStatus('credential-error')
        setMessage(
          result.diagnostics?.help ??
            `Set up your git credentials for ${hostFromRemote(remoteUrl)}.`,
        )
      }
    } catch (error) {
      // A rejected preflight invoke (e.g. getRemoteClient could not resolve
      // bundled tools) must leave a recoverable state — never strand the UI in
      // the disabled 'checking' state — so the Check button re-enables for retry.
      setStatus('credential-error')
      setMessage(error instanceof Error ? error.message : 'Remote check failed.')
    }
  }

  async function connectRemote() {
    setStatus('connecting')
    setMessage('Initializing your Den with chezmoi init…')
    try {
      await window.dotden.remote.connect(remoteUrl)
      setStatus('reachable')
      setMessage('Connected. Your empty Remote is initialized as this environment’s Den.')
    } catch (error) {
      setStatus('credential-error')
      setMessage(error instanceof Error ? error.message : 'Remote connection failed.')
    }
  }

  // True while any IPC operation is in flight. Used to disable Check so a user
  // cannot race a preflight against an in-flight connect on the same source dir.
  const busy = status === 'checking' || status === 'connecting'

  return (
    <main className="bg-background text-foreground min-h-screen p-8">
      <section className="mx-auto flex max-w-3xl flex-col gap-8">
        <div className="space-y-3">
          <div className="border-border text-muted-foreground inline-flex items-center gap-2 rounded-full border px-3 py-1 text-xs">
            <Sparkles className="size-3.5" /> V1-Lean · no dotden-held git token
          </div>
          <h1 className="text-4xl font-semibold tracking-tight">Connect your Remote</h1>
          <p className="text-muted-foreground max-w-xl">
            Paste a private git repo URL from any Provider. dotden preflights it with your existing
            SSH key or git credential helper, then initializes the Den with chezmoi.
          </p>
        </div>

        <div className="border-border bg-card text-card-foreground grid gap-4 rounded-xl border p-5 shadow-sm">
          <label className="grid gap-2 text-sm font-medium">
            Remote URL
            <input
              className="border-input bg-background ring-offset-background placeholder:text-muted-foreground focus-visible:ring-ring rounded-md border px-3 py-2 font-mono text-sm focus-visible:ring-2 focus-visible:ring-offset-2 focus-visible:outline-none"
              placeholder="git@github.com:you/dotfiles.git"
              value={remoteUrl}
              onChange={(event) => {
                setRemoteUrl(event.target.value)
                setStatus('idle')
                setMessage('Paste an HTTPS or SSH git Remote URL to start.')
              }}
            />
          </label>

          <div className="flex flex-wrap items-center gap-3">
            <Button disabled={!remoteUrl || busy} onClick={() => void checkRemote()}>
              {status === 'checking' ? (
                <Loader2 className="size-4 animate-spin" />
              ) : (
                <GitBranch className="size-4" />
              )}
              Check credentials
            </Button>
            <Button
              disabled={!remoteUrl || status !== 'reachable'}
              onClick={() => void connectRemote()}
            >
              {status === 'connecting' ? <Loader2 className="size-4 animate-spin" /> : null}
              Connect Remote
            </Button>
          </div>

          <p className="text-muted-foreground text-sm" role="status">
            {message}
          </p>
        </div>

        <p className="text-muted-foreground text-xs">
          Preload bridge: Electron {window.dotden.versions.electron} / Node{' '}
          {window.dotden.versions.node} / {window.dotden.platform}
        </p>
      </section>
    </main>
  )
}
