import { useCallback, useEffect, useState } from 'react'
import { GitBranch, KeyRound, Loader2, Lock, RefreshCw, Shield, TriangleAlert } from 'lucide-react'
import { cn } from '@/lib/utils'
import type { ConnectedRemote } from '../../../main/foundation/den-service'
import type { PreflightResult } from '../../../main/foundation/remote-client'
import type { DetectedPasswordManager } from '../../../main/foundation/pm-detect'

/**
 * AccountTab — the Settings → Account tab (issue 2-11, stories 40–42; design: screens/settings.md
 * "Repository" / V1-Lean reconciliation, ADR 0020).
 *
 * The honest "what is dotden connected to, and is it working" surface. **V1-Lean (ADR 0020): there
 * is NO dotden account, no OAuth, no stored token, no keychain entry** — push/fetch ride the user's
 * own git credentials (their SSH key or git credential helper). So this tab deliberately shows
 * neither a "Connected as …" identity nor a Disconnect/sign-out control; it shows three things:
 *
 * - **Connected Remote** — the git Remote URL (read-only, mono) + the Provider host it points at
 *   (`github.com`, `gitlab.com`, a self-hosted host, …), read over the `den:connected-remote` seam
 *   (`git remote get-url origin`). When no Remote is connected (a local-only Den) it shows an honest
 *   empty state rather than a blank card (never fail silently).
 * - **Credential status** — a LIVE `git ls-remote` preflight (the `remote:preflight` seam) that
 *   answers "do my git credentials reach this Remote right now?". The user can edit the URL and
 *   **Re-check**; a failure surfaces the provider-agnostic credential help ("set up your SSH key /
 *   token for `<host>`") straight from the RemoteClient's sanitized diagnostics — never a raw URL or
 *   token (the redaction is owned by RemoteClient, issue 1-03). dotden never tries to repair
 *   credentials itself; it guides (ADR 0020). The re-point/re-clone of a *changed* URL is the
 *   deferred data-migration flow (design: settings.md "Future work"); this slice verifies the
 *   credential reaches, which is exactly what acceptance criterion 4 asks for.
 * - **Detected password-manager CLI** — which of `op`/`bw`/`pass` is installed on THIS environment,
 *   from the SAME `den:detect-password-managers` detection the convert picker uses (issue 2-05), so
 *   the user knows secret conversion will work here. Environment-local, never synced (ADR 0024).
 *
 * Loading is parallel-then-authoritative: the connected Remote, the PM detection, and the first
 * credential preflight all kick off on mount; each surface renders independently as it resolves, and
 * any failure shows inline rather than blanking the whole tab.
 */
export function AccountTab() {
  // The connected Remote (URL + Provider host); null while the first read is in flight.
  const [remote, setRemote] = useState<ConnectedRemote | null>(null)
  // The URL the credential check runs against — seeded from the connected Remote, then editable so
  // the user can verify a corrected URL's credentials before committing to a (deferred) re-point.
  const [checkUrl, setCheckUrl] = useState('')
  // The latest live `git ls-remote` preflight result; null until the first check resolves.
  const [preflight, setPreflight] = useState<PreflightResult | null>(null)
  const [checking, setChecking] = useState(false)
  // This environment's detected password-manager CLIs (op/bw/pass); null while detection runs.
  const [managers, setManagers] = useState<readonly DetectedPasswordManager[] | null>(null)
  const [error, setError] = useState<string | null>(null)

  /**
   * Run a live credential preflight against `url` (`git ls-remote`). Reusable so both the mount
   * effect and the Re-check button drive the SAME path. A failure is returned as a `PreflightResult`
   * with diagnostics (the RemoteClient never throws for an unreachable Remote), so the tab renders
   * the provider-agnostic help inline; only an unexpected IPC error lands in `error`.
   */
  const runPreflight = useCallback(async (url: string) => {
    if (!url.trim()) return
    setChecking(true)
    setError(null)
    try {
      const result = await window.dotden.remote.preflight(url)
      setPreflight(result)
    } catch (caught) {
      setError(messageOf(caught, 'Could not check your connection.'))
    } finally {
      setChecking(false)
    }
  }, [])

  // On mount: read the connected Remote + detect password managers, then preflight the connected URL
  // once so the user sees a live credential status without having to click anything.
  useEffect(() => {
    let alive = true
    window.dotden.den
      .connectedRemote()
      .then((loaded) => {
        if (!alive) return
        setRemote(loaded)
        if (loaded.url) {
          setCheckUrl(loaded.url)
          void runPreflight(loaded.url)
        }
      })
      .catch((caught: unknown) => {
        if (alive) setError(messageOf(caught, 'Could not read your connected repository.'))
      })
    window.dotden.den
      .detectPasswordManagers()
      .then((detected) => {
        if (alive) setManagers(detected)
      })
      .catch((caught: unknown) => {
        if (alive) setError(messageOf(caught, 'Could not check for a password manager.'))
      })
    return () => {
      alive = false
    }
  }, [runPreflight])

  if (!remote) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 p-8 text-sm">
        {error ? (
          <span className="text-dd-red-400" role="alert">
            {error}
          </span>
        ) : (
          <>
            <Loader2 className="size-4 animate-spin" /> Loading account…
          </>
        )}
      </div>
    )
  }

  return (
    <div className="flex max-w-2xl flex-col gap-8 p-8">
      <header className="space-y-1">
        <h2 className="text-foreground text-xl font-semibold tracking-tight">Account</h2>
        <p className="text-muted-foreground text-sm leading-relaxed">
          The repository dotden syncs to and whether your git credentials can reach it. dotden has{' '}
          <span className="text-foreground font-medium">no account and stores no password</span> —
          pushes use your own SSH key or git credential helper.
        </p>
      </header>

      {error ? (
        <p className="text-dd-red-400 text-xs" role="alert">
          {error}
        </p>
      ) : null}

      {/* ── Connected Remote + live credential status ────────────────────────────────────────── */}
      <section className="border-border bg-card flex flex-col gap-5 rounded-lg border p-5">
        {remote.url ? (
          <>
            <div className="flex items-start gap-3">
              <GitBranch className="text-dd-ember-400 mt-0.5 size-5 shrink-0" />
              <div className="min-w-0 flex-1">
                <p className="text-foreground text-sm font-medium">Connected repository</p>
                {/* The Remote URL read-only in mono — exactly the string git is using. */}
                <p className="text-muted-foreground truncate font-mono text-xs" title={remote.url}>
                  {remote.url}
                </p>
                {remote.host ? (
                  <p className="text-muted-foreground mt-1 text-xs">
                    Provider: <span className="text-foreground">{remote.host}</span>
                    {remote.scheme ? (
                      <span className="text-muted-foreground"> · {remote.scheme}</span>
                    ) : null}
                  </p>
                ) : null}
              </div>
              <CredentialPill preflight={preflight} checking={checking} />
            </div>

            {/* Edit the URL + Re-check credentials (acceptance criterion 4). */}
            <div className="border-border flex flex-col gap-2 border-t pt-4">
              <label htmlFor="account-remote-url" className="text-foreground text-xs font-medium">
                Check connection
              </label>
              <div className="flex flex-wrap items-center gap-2">
                <input
                  id="account-remote-url"
                  type="text"
                  spellCheck={false}
                  autoCapitalize="off"
                  autoCorrect="off"
                  value={checkUrl}
                  onChange={(event) => setCheckUrl(event.target.value)}
                  placeholder="git@github.com:you/den.git"
                  className="border-border bg-background text-foreground focus:border-dd-ember-500 min-w-0 flex-1 rounded-md border px-3 py-1.5 font-mono text-xs outline-none"
                />
                <button
                  type="button"
                  onClick={() => void runPreflight(checkUrl)}
                  disabled={checking || !checkUrl.trim()}
                  className="border-border bg-background hover:bg-secondary/40 text-foreground inline-flex shrink-0 items-center gap-2 rounded-md border px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-60"
                >
                  {checking ? (
                    <Loader2 className="size-3.5 animate-spin" />
                  ) : (
                    <RefreshCw className="size-3.5" />
                  )}
                  {checking ? 'Checking…' : 'Re-check'}
                </button>
              </div>

              {/* On a failed preflight, the RemoteClient's provider-agnostic, sanitized help. */}
              {preflight && !preflight.reachable && preflight.diagnostics ? (
                <div className="border-dd-red-900 bg-dd-red-950 mt-1 flex items-start gap-2 rounded-md border p-3">
                  <KeyRound className="text-dd-red-400 mt-0.5 size-4 shrink-0" />
                  <div className="space-y-1">
                    <p className="text-dd-red-400 text-xs font-medium">
                      Can’t reach the repository
                    </p>
                    <p className="text-muted-foreground text-xs leading-relaxed">
                      {preflight.diagnostics.help}
                    </p>
                  </div>
                </div>
              ) : null}
            </div>
          </>
        ) : (
          /* No Remote connected yet — honest empty state, not a blank card (never fail silently). */
          <div className="flex items-start gap-3">
            <TriangleAlert className="text-dd-amber-400 mt-0.5 size-5 shrink-0" />
            <div className="space-y-1">
              <p className="text-foreground text-sm font-medium">No repository connected</p>
              <p className="text-muted-foreground text-xs leading-relaxed">
                This Den isn’t connected to a git repository yet, so there’s nothing to sync to.
                Connect one to start syncing your config across your computers.
              </p>
            </div>
          </div>
        )}
      </section>

      {/* ── No token / no keychain reassurance — the V1-Lean auth model (ADR 0020) ───────────── */}
      <div className="border-dd-ember-900 bg-dd-ember-950 flex items-start gap-3 rounded-lg border p-4">
        <Lock className="text-dd-ember-400 mt-0.5 size-5 shrink-0" />
        <div className="space-y-1">
          <p className="text-foreground text-sm font-medium">Uses your own git credentials</p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            dotden stores no password or access token. Pushing and fetching use your SSH key or git
            credential helper — the same ones your terminal already uses. If a check fails, fix your
            git credentials for the provider and re-check.
          </p>
        </div>
      </div>

      {/* ── Detected password-manager CLI (same detection as the convert picker, issue 2-05) ──── */}
      <section className="space-y-3">
        <div className="space-y-1">
          <h3 className="text-foreground text-sm font-semibold">Password manager</h3>
          <p className="text-muted-foreground text-xs leading-relaxed">
            Detected on this computer — used to convert secrets into references so the secret value
            never enters your repo. This is local to this computer.
          </p>
        </div>
        <ManagerList managers={managers} />
      </section>
    </div>
  )
}

/**
 * The live credential-status pill (design-system `Pill`, mirroring `OBContent/ConnectURL`'s
 * Reachable/Credential-error states). Green "Connected" when `git ls-remote` succeeded, red "Can't
 * connect" on failure, a spinner while checking — so the user always sees the CURRENT auth state.
 */
function CredentialPill({
  preflight,
  checking,
}: {
  preflight: PreflightResult | null
  checking: boolean
}) {
  if (checking && !preflight) {
    return (
      <span className="bg-dd-blue-950 text-dd-blue-400 inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium">
        <Loader2 className="size-3 animate-spin" /> Checking…
      </span>
    )
  }
  if (!preflight) return null
  return preflight.reachable ? (
    <span className="bg-dd-green-950 text-dd-green-400 inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium">
      <Shield className="size-3" /> Connected
    </span>
  ) : (
    <span className="bg-dd-red-950 text-dd-red-400 inline-flex shrink-0 items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-medium">
      <TriangleAlert className="size-3" /> Can’t connect
    </span>
  )
}

/**
 * The detected-password-manager list. Each catalog manager (op/bw/pass) shows a green "CLI detected"
 * pill when present, or its install hint when absent (never silently hidden — acceptance criterion
 * mirrors the convert picker, issue 2-05). Shows a loading row until detection resolves.
 */
function ManagerList({ managers }: { managers: readonly DetectedPasswordManager[] | null }) {
  if (!managers) {
    return (
      <div className="text-muted-foreground border-border bg-card flex items-center gap-2 rounded-lg border p-4 text-xs">
        <Loader2 className="size-3.5 animate-spin" /> Checking for a password manager…
      </div>
    )
  }
  return (
    <div className="border-border bg-card divide-border divide-y rounded-lg border">
      {managers.map((manager) => (
        <div key={manager.id} className="flex items-start gap-3 px-4 py-3">
          <KeyRound
            className={cn(
              'mt-0.5 size-4 shrink-0',
              manager.available ? 'text-dd-ember-400' : 'text-muted-foreground',
            )}
          />
          <div className="min-w-0 flex-1">
            <p className="text-foreground text-sm font-medium">{manager.label}</p>
            {/* When absent, the install hint explains why + how to fix (never fail silently). */}
            {!manager.available ? (
              <p className="text-muted-foreground text-xs leading-relaxed">{manager.installHint}</p>
            ) : (
              <p className="text-muted-foreground font-mono text-xs">{manager.cli}</p>
            )}
          </div>
          {manager.available ? (
            <span className="bg-dd-green-950 text-dd-green-400 inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium">
              CLI detected
            </span>
          ) : (
            <span className="bg-secondary/40 text-muted-foreground inline-flex shrink-0 items-center rounded-full px-2.5 py-0.5 text-xs font-medium">
              Not installed
            </span>
          )}
        </div>
      ))}
    </div>
  )
}

/** Pull a human message off an unknown thrown value, falling back to `fallback`. */
function messageOf(caught: unknown, fallback: string): string {
  return caught instanceof Error && caught.message ? caught.message : fallback
}
