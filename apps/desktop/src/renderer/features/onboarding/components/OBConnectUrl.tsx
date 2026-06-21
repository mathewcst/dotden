import { useState } from 'react'
import { GitBranch, Loader2, TriangleAlert } from 'lucide-react'
import { Button } from '@/ui/button'
import type { ConnectResult } from '@shared/remote'
import { isConnectBusy, stateAfterConnectResult, type ConnectState } from '../lib/connect-state'

/** Parsed host for the copy, derived locally so the UI never echoes the raw URL. */
function hostFromRemote(url: string): string {
  try {
    return new URL(url).hostname
  } catch {
    return /^(?:[^@]+@)?([^:]+):/.exec(url)?.[1] ?? 'your Provider'
  }
}

/**
 * OBConnectUrl — onboarding step 3 (design: onboarding.md `OBContent/ConnectURL`).
 *
 * The load-bearing new V1-Lean screen: the user pastes their **empty private repo**
 * URL, dotden preflights it with `git ls-remote` (their existing credentials, no
 * token held — ADR 0020), and on success `chezmoi init`s the Den and advances. It
 * **reuses the 1-03 RemoteClient IPC** (`window.dotden.remote.preflight/connect`) —
 * the same paste+preflight seam the returning-environment flow will reuse.
 *
 * On a credential error it surfaces the ambiguous-auth treatment: a provider-agnostic
 * headline, an enumerated (never asserted) list of likely causes, a recovery line,
 * and a Details disclosure exposing only sanitized host/scheme/exit-code/stderr.
 * dotden never tries to fix auth itself and never auto-runs `gh auth switch`.
 *
 * On a reachable but incompatible repo (`foreign-chezmoi`), it refuses locally and returns the URL
 * field to an editable state instead of leaving the shell in the initializing spinner.
 *
 * @param onConnected Called once the Remote is reachable AND `chezmoi init` succeeds,
 *   so the shell can advance to Discover.
 */
export function OBConnectUrl({
  onConnected,
  onCancel,
}: {
  onConnected: (result: ConnectResult) => void
  onCancel?: () => void
}) {
  const [url, setUrl] = useState('')
  const [state, setState] = useState<ConnectState>('idle')
  // Sanitized diagnostics from a failed preflight (host/scheme/exitCode/stderr/help).
  const [diagnostics, setDiagnostics] = useState<{
    host: string
    scheme: string
    exitCode?: number
    stderr: string
    help: string
  } | null>(null)
  const [showDetails, setShowDetails] = useState(false)

  const host = hostFromRemote(url)

  async function connect() {
    setState('checking')
    setDiagnostics(null)
    try {
      const result = await window.dotden.remote.preflight(url)
      if (!result.reachable) {
        setState('credential-error')
        setDiagnostics(
          result.diagnostics ?? {
            host,
            scheme: 'unknown',
            stderr: '',
            help: `Set up your git credentials for ${host}, then retry.`,
          },
        )
        return
      }
      // Reachable → clone + initialize the Den, then hand off to Discover.
      setState('reachable')
      const connected = await window.dotden.remote.connect(url)
      const nextState = stateAfterConnectResult(connected)
      if (nextState === 'refused') {
        setState(nextState)
        return
      }
      onConnected(connected)
    } catch (error) {
      // A rejected invoke (e.g. chezmoi init failed, bundled tools missing) must leave a
      // recoverable state — surface it, never strand the UI mid-check (never fail silently).
      setState('credential-error')
      setDiagnostics({
        host,
        scheme: 'unknown',
        stderr: '',
        help: error instanceof Error ? error.message : 'Connecting your Remote failed. Retry.',
      })
    }
  }

  const busy = isConnectBusy(state)

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <header className="space-y-2">
        <h1 className="text-foreground text-2xl font-semibold tracking-tight">Connect your repo</h1>
        <p className="text-muted-foreground text-sm leading-relaxed">
          Paste the URL of the empty private repo you just created. dotden checks it with your
          existing git credentials, then initializes your Den — it never stores a token of its own.
        </p>
      </header>

      <label className="grid gap-2 text-sm font-medium">
        Repo URL
        <input
          className="border-input bg-background placeholder:text-muted-foreground focus-visible:ring-ring rounded-md border px-3 py-2 font-mono text-sm focus-visible:ring-2 focus-visible:outline-none disabled:opacity-60"
          placeholder="https://… or git@…"
          value={url}
          disabled={busy}
          onChange={(event) => {
            setUrl(event.target.value)
            setState('idle')
            setDiagnostics(null)
          }}
        />
      </label>

      {state === 'checking' || state === 'reachable' ? (
        <div className="text-muted-foreground flex items-center gap-2 text-sm" role="status">
          <Loader2 className="size-4 animate-spin" />
          {state === 'reachable'
            ? `Connected to ${host} — initializing your Den…`
            : `Checking access to ${host}…`}
        </div>
      ) : null}

      {state === 'credential-error' && diagnostics ? (
        <div
          className="bg-dd-red-950 border-destructive/30 grid gap-3 rounded-md border p-4 text-sm"
          role="alert"
        >
          <div className="text-foreground flex items-center gap-2 font-medium">
            <TriangleAlert className="text-destructive size-4" />
            dotden couldn’t reach {diagnostics.host} with your git credentials.
          </div>
          {/* Enumerate likely causes — never assert one (the error is genuinely ambiguous). */}
          <ul className="text-muted-foreground list-disc space-y-1 pl-5 text-xs">
            <li>the URL is wrong</li>
            <li>the repo doesn’t exist</li>
            <li>your active credentials don’t have access</li>
          </ul>
          <p className="text-muted-foreground text-xs">
            Set up an SSH key or token for {diagnostics.host}, then retry. Using the GitHub CLI?
            Check <span className="text-foreground font-mono">gh auth status</span> and switch with{' '}
            <span className="text-foreground font-mono">gh auth switch</span>.
          </p>
          <button
            type="button"
            className="text-muted-foreground hover:text-foreground w-fit text-left text-xs"
            onClick={() => setShowDetails((shown) => !shown)}
          >
            {showDetails ? '▾' : '▸'} Details
          </button>
          {showDetails ? (
            <pre className="bg-dd-ink-950 text-muted-foreground overflow-auto rounded p-2 font-mono text-[11px]">
              host: {diagnostics.host}
              {'\n'}scheme: {diagnostics.scheme}
              {diagnostics.exitCode !== undefined ? `\nexit: ${diagnostics.exitCode}` : ''}
              {diagnostics.stderr ? `\nstderr: ${diagnostics.stderr}` : ''}
            </pre>
          ) : null}
        </div>
      ) : null}

      {state === 'refused' ? (
        <div
          className="bg-dd-ember-950 text-dd-ember-300 border-dd-ember-400/30 grid gap-2 rounded-md border p-4 text-sm"
          role="alert"
        >
          <div className="text-foreground flex items-center gap-2 font-medium">
            <TriangleAlert className="text-dd-ember-300 size-4" />
            This repo already has a chezmoi setup.
          </div>
          <p className="text-muted-foreground text-xs leading-relaxed">
            Full adoption is coming later. Connect an empty repo for now, or paste a different repo
            URL and retry.
          </p>
        </div>
      ) : null}

      <div className="flex items-center gap-2">
        <Button disabled={!url.trim() || busy} onClick={() => void connect()}>
          {busy ? <Loader2 className="size-4 animate-spin" /> : <GitBranch className="size-4" />}
          {state === 'credential-error' || state === 'refused' ? 'Retry' : 'Connect'}
        </Button>
        {state === 'checking' || state === 'reachable' || state === 'credential-error' ? (
          <Button
            variant="secondary"
            onClick={() => {
              setState('idle')
              onCancel?.()
            }}
          >
            Cancel
          </Button>
        ) : null}
      </div>
    </div>
  )
}
