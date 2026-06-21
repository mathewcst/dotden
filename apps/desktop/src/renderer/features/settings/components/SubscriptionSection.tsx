import { useEffect, useState } from 'react'
import { Layers, Loader2 } from 'lucide-react'
import { ConfirmDialog } from '@/components/den/confirm-dialog'
import type { SubscribableWorkspace, SubscriptionState } from '@shared/den'
import type { UnsubscribeDisposition } from '@shared/settings'

/**
 * SubscriptionSection — post-onboarding Workspace subscriptions for THIS environment.
 *
 * The backend/API leg already exists for the returning flow; this settings section makes it
 * reachable after setup. Adding a Workspace is immediate (`setSubscriptions`). Removing a
 * Workspace is a deliberate `unsubscribeWorkspace` action because the user must choose whether
 * this environment keeps the now-unsubscribed files as local orphans or removes its copies.
 */
export function SubscriptionSection() {
  const [state, setState] = useState<SubscriptionState | null>(null)
  const [defaultDisposition, setDefaultDisposition] = useState<UnsubscribeDisposition>('keep')
  const [pendingRemoval, setPendingRemoval] = useState<SubscribableWorkspace | null>(null)
  const [removalDisposition, setRemovalDisposition] = useState<UnsubscribeDisposition>('keep')
  const [rememberRemoval, setRememberRemoval] = useState(false)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    let alive = true
    async function load() {
      try {
        const [subscriptions, disposition] = await Promise.all([
          window.dotden.den.subscriptionState(),
          window.dotden.den.unsubscribeDisposition(),
        ])
        if (!alive) return
        setState(subscriptions)
        setDefaultDisposition(disposition)
        setRemovalDisposition(disposition)
      } catch (caught) {
        if (alive) setError(messageOf(caught, 'Could not load Workspace subscriptions.'))
      }
    }
    void load()
    return () => {
      alive = false
    }
  }, [])

  async function subscribe(workspaceId: string) {
    if (!state) return
    setBusy(true)
    setError(null)
    try {
      const nextIds = [
        ...state.workspaces
          .filter((workspace) => workspace.subscribed)
          .map((workspace) => workspace.id),
        workspaceId,
      ]
      setState(await window.dotden.den.setSubscriptions(nextIds))
    } catch (caught) {
      setError(messageOf(caught, 'Could not update Workspace subscriptions.'))
    } finally {
      setBusy(false)
    }
  }

  async function confirmUnsubscribe() {
    if (!pendingRemoval) return
    setBusy(true)
    setError(null)
    try {
      if (rememberRemoval) {
        await window.dotden.den.rememberUnsubscribeDisposition(removalDisposition)
        setDefaultDisposition(removalDisposition)
      }
      setState(await window.dotden.den.unsubscribeWorkspace(pendingRemoval.id, removalDisposition))
      setPendingRemoval(null)
    } catch (caught) {
      setError(messageOf(caught, 'Could not unsubscribe from that Workspace.'))
    } finally {
      setBusy(false)
    }
  }

  async function saveDefaultDisposition(disposition: UnsubscribeDisposition) {
    setDefaultDisposition(disposition)
    setRemovalDisposition(disposition)
    setError(null)
    try {
      await window.dotden.den.rememberUnsubscribeDisposition(disposition)
    } catch (caught) {
      setError(messageOf(caught, 'Could not remember that unsubscribe default.'))
    }
  }

  return (
    <section className="space-y-4">
      <header className="space-y-1">
        <h3 className="text-foreground text-base font-semibold">Workspace subscriptions</h3>
        <p className="text-muted-foreground text-sm leading-relaxed">
          Choose which Workspaces this environment applies. Removing one asks whether to keep its
          local files here or remove this environment’s copies.
        </p>
      </header>

      {error ? (
        <p className="text-dd-red-400 text-xs" role="alert">
          {error}
        </p>
      ) : null}

      {!state ? (
        <p className="text-muted-foreground flex items-center gap-2 text-sm" role="status">
          <Loader2 className="size-4 animate-spin" /> Loading Workspace subscriptions…
        </p>
      ) : state.workspaces.length === 0 ? (
        <p className="text-muted-foreground text-sm">Your Den has no Workspaces yet.</p>
      ) : (
        <div className="border-border bg-card divide-border divide-y rounded-lg border">
          {state.workspaces.map((workspace) => (
            <label
              key={workspace.id}
              className="flex items-center gap-3 px-4 py-3 text-sm"
            >
              <input
                type="checkbox"
                className="accent-dd-ember-500 size-4"
                checked={workspace.subscribed}
                disabled={busy}
                onChange={() => {
                  if (workspace.subscribed) {
                    setRemovalDisposition(defaultDisposition)
                    setRememberRemoval(false)
                    setPendingRemoval(workspace)
                  } else {
                    void subscribe(workspace.id)
                  }
                }}
              />
              <Layers className="text-muted-foreground size-4" />
              <span className="text-foreground flex-1 font-medium">{workspace.label}</span>
              <span className="text-muted-foreground text-xs">
                {workspace.subscribed ? 'Subscribed' : 'Not subscribed'}
              </span>
            </label>
          ))}
        </div>
      )}

      {state?.emptyDenWarning ? (
        <p className="text-dd-amber-400 text-xs" role="alert">
          {state.emptyDenWarning}
        </p>
      ) : null}

      <div className="border-border bg-card flex items-center justify-between gap-4 rounded-lg border p-4">
        <div>
          <p className="text-foreground text-sm font-medium">Default when unsubscribing</p>
          <p className="text-muted-foreground text-xs">
            Pre-selects the keep/remove choice next time.
          </p>
        </div>
        <select
          className="border-input bg-background text-foreground rounded border px-2 py-1.5 text-sm"
          value={defaultDisposition}
          disabled={busy || !state}
          aria-label="Default unsubscribe choice"
          onChange={(event) =>
            void saveDefaultDisposition(event.target.value as UnsubscribeDisposition)
          }
        >
          <option value="keep">Keep files here</option>
          <option value="remove">Remove local copies</option>
        </select>
      </div>

      <ConfirmDialog
        open={pendingRemoval !== null}
        onOpenChange={(open) => {
          if (!open) setPendingRemoval(null)
        }}
        tone={removalDisposition === 'remove' ? 'destructive' : 'default'}
        title={`Unsubscribe from ${pendingRemoval?.label ?? 'Workspace'}?`}
        body={
          <div className="space-y-3">
            <p>
              This environment will stop applying Files from{' '}
              <span className="text-foreground font-medium">{pendingRemoval?.label}</span>. Other
              environments keep their subscriptions.
            </p>
            <fieldset className="space-y-2">
              <legend className="text-foreground text-xs font-medium">
                Files already on this environment
              </legend>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  className="accent-dd-ember-500 mt-1"
                  name="unsubscribe-disposition"
                  value="keep"
                  checked={removalDisposition === 'keep'}
                  onChange={() => setRemovalDisposition('keep')}
                />
                <span>Keep them as local files</span>
              </label>
              <label className="flex items-start gap-2 text-sm">
                <input
                  type="radio"
                  className="accent-dd-ember-500 mt-1"
                  name="unsubscribe-disposition"
                  value="remove"
                  checked={removalDisposition === 'remove'}
                  onChange={() => setRemovalDisposition('remove')}
                />
                <span>Remove this environment’s copies</span>
              </label>
            </fieldset>
            <label className="flex items-center gap-2 text-xs">
              <input
                type="checkbox"
                className="accent-dd-ember-500 size-3.5"
                checked={rememberRemoval}
                onChange={(event) => setRememberRemoval(event.target.checked)}
              />
              Remember this choice
            </label>
          </div>
        }
        confirmLabel="Unsubscribe"
        confirmDisabled={busy}
        onConfirm={() => void confirmUnsubscribe()}
      />
    </section>
  )
}

function messageOf(caught: unknown, fallback: string): string {
  return caught instanceof Error && caught.message ? caught.message : fallback
}
