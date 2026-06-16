import { useEffect, useState } from 'react'
import { Cloud, Loader2 } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import type { PollCadenceProfile, SyncSettings } from '../../../main/foundation/sync-settings'

/**
 * SyncTab — the Settings → Sync & polling tab (issue 2-08, stories 37–39; design:
 * screens/settings.md "Sync & polling").
 *
 * The first real Settings tab. It surfaces this environment's three **environment-local** Sync
 * preferences (ADR 0024 — per-machine facts, never synced) over the `sync:*` IPC seam:
 *
 * - **Background tray poller** (on/off) — whether dotden watches the Remote in the background to
 *   notify on incoming changes. Detect-only; turning it off stops the background watcher entirely.
 * - **Poll cadence** (`fast` / `relaxed`) — how aggressively the poller checks the Remote. Only
 *   shown while the poller is on (a cadence with nothing polling is meaningless).
 * - **Start at login** (on/off) — whether dotden launches at login so the tray/watcher is present
 *   without the user opening the app (realized via the OS login-item in the main process).
 *
 * It also restates, in plain copy, what **Sync now** does — it **pushes and fetches, but never
 * auto-applies** (transport-not-commit, ADR 0006; the Auto-sync contract, CONTEXT.md) — so the
 * user understands the boundary between transport and the reviewed Apply.
 *
 * Saving is optimistic-then-authoritative: the UI flips immediately, calls
 * `window.dotden.sync.setSettings`, and re-renders from the settings it returns (the source of
 * truth after the main process persisted + re-armed the poller/autostart). A failed write surfaces
 * an inline error and reverts the optimistic flip — it never fails silently.
 */
export function SyncTab() {
  const [settings, setSettings] = useState<SyncSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load this environment's current Sync settings once on mount.
  useEffect(() => {
    let alive = true
    window.dotden.sync
      .getSettings()
      .then((loaded) => {
        if (alive) setSettings(loaded)
      })
      .catch((caught: unknown) => {
        if (alive) setError(messageOf(caught, 'Could not load your Sync settings.'))
      })
    return () => {
      alive = false
    }
  }, [])

  /**
   * Persist a single changed field. Flips the UI optimistically, writes via IPC, then adopts the
   * settings the main process returns (it persisted + re-armed the poller/autostart). On failure,
   * reverts to the previous settings and surfaces the error (never fail silently).
   */
  async function update(patch: Partial<SyncSettings>) {
    if (!settings) return
    const previous = settings
    const next: SyncSettings = { ...settings, ...patch }
    setSettings(next) // optimistic
    setSaving(true)
    setError(null)
    try {
      const persisted = await window.dotden.sync.setSettings(next)
      setSettings(persisted)
    } catch (caught) {
      setSettings(previous) // revert the optimistic flip
      setError(messageOf(caught, 'Could not save your Sync settings.'))
    } finally {
      setSaving(false)
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
            <Loader2 className="size-4 animate-spin" /> Loading Sync settings…
          </>
        )}
      </div>
    )
  }

  return (
    <div className="flex max-w-2xl flex-col gap-8 p-8">
      <header className="space-y-1">
        <h2 className="text-foreground text-xl font-semibold tracking-tight">Sync &amp; polling</h2>
        <p className="text-muted-foreground text-sm leading-relaxed">
          How this computer checks your repo for incoming changes. These settings are{' '}
          <span className="text-foreground font-medium">specific to this environment</span> — they
          aren’t shared with your other computers.
        </p>
      </header>

      {error ? (
        <p className="text-dd-red-400 text-xs" role="alert">
          {error}
        </p>
      ) : null}

      {/* Card of Switch rows + the cadence picker (design: settings.md "Sync & polling"). */}
      <div className="border-border bg-card divide-border divide-y rounded-lg border">
        <SwitchRow
          title="Background watching"
          sub="Check your repo in the background and notify you when another computer changes your Den. Detect-only — it never applies anything on its own."
          checked={settings.pollerEnabled}
          disabled={saving}
          onCheckedChange={(on) => void update({ pollerEnabled: on })}
        />

        {/* The cadence picker is only meaningful while the poller is on. */}
        {settings.pollerEnabled ? (
          <CadenceRow
            value={settings.cadence}
            disabled={saving}
            onChange={(cadence) => void update({ cadence })}
          />
        ) : null}

        <SwitchRow
          title="Start dotden at login"
          sub="Open dotden automatically when you sign in, so it’s watching for incoming changes from the tray without you opening it."
          checked={settings.startOnLogin}
          disabled={saving}
          onCheckedChange={(on) => void update({ startOnLogin: on })}
        />
      </div>

      {/* "What Sync now does" — the transport-not-apply explanation (ADR 0006). */}
      <div className="border-dd-ember-900 bg-dd-ember-950 flex items-start gap-3 rounded-lg border p-4">
        <Cloud className="text-dd-ember-400 mt-0.5 size-5 shrink-0" />
        <div className="space-y-1">
          <p className="text-foreground text-sm font-medium">What “Sync now” does</p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            <span className="text-foreground font-medium">Sync now</span> pushes your committed
            changes to your repo and fetches incoming ones — that’s all. It{' '}
            <span className="text-foreground font-medium">never applies changes to your files</span>
            . Applying incoming changes always stays a manual review, so nothing rewrites your
            config without you seeing it first.
          </p>
        </div>
      </div>
    </div>
  )
}

/**
 * A single Settings row with a title, sub-copy, and a trailing {@link Switch} (design-system
 * `SettingsRow` `Trail=Switch`). Private to this tab; promoted to its own file once a second tab
 * reuses it (conventions.md "one primary per file").
 */
function SwitchRow({
  title,
  sub,
  checked,
  disabled,
  onCheckedChange,
}: {
  title: string
  sub: string
  checked: boolean
  disabled?: boolean
  onCheckedChange: (checked: boolean) => void
}) {
  return (
    <label className="flex cursor-pointer items-start gap-4 px-4 py-3.5">
      <span className="flex-1">
        <span className="text-foreground block text-sm font-medium">{title}</span>
        <span className="text-muted-foreground block text-xs leading-relaxed">{sub}</span>
      </span>
      <span className="pt-0.5">
        <Switch checked={checked} disabled={disabled} onCheckedChange={onCheckedChange} />
      </span>
    </label>
  )
}

/** The two cadence profiles, in order, with the plain copy the Sync tab shows for each. */
const CADENCE_OPTIONS: readonly { value: PollCadenceProfile; label: string; hint: string }[] = [
  { value: 'fast', label: 'Lively', hint: 'Checks every few minutes — notice changes promptly.' },
  {
    value: 'relaxed',
    label: 'Relaxed',
    hint: 'Checks less often — easier on battery on a quiet machine.',
  },
]

/**
 * The poll-cadence picker row (design: settings.md "Sync & polling" poll-cadence row). A small
 * segmented control between the two named cadence profiles — interactive ember on the selected
 * option, muted on the rest (ember = the sole interactive hue, design system).
 */
function CadenceRow({
  value,
  disabled,
  onChange,
}: {
  value: PollCadenceProfile
  disabled?: boolean
  onChange: (cadence: PollCadenceProfile) => void
}) {
  const activeHint = CADENCE_OPTIONS.find((o) => o.value === value)?.hint
  return (
    <div className="flex items-start gap-4 px-4 py-3.5">
      <span className="flex-1">
        <span className="text-foreground block text-sm font-medium">How often to check</span>
        <span className="text-muted-foreground block text-xs leading-relaxed">{activeHint}</span>
      </span>
      <div className="border-border bg-background flex shrink-0 items-center gap-1 rounded-md border p-0.5">
        {CADENCE_OPTIONS.map((option) => {
          const selected = option.value === value
          return (
            <button
              key={option.value}
              type="button"
              disabled={disabled}
              aria-pressed={selected}
              onClick={() => onChange(option.value)}
              className={cn(
                'rounded px-2.5 py-1 text-xs font-medium transition-colors disabled:opacity-50',
                selected
                  ? 'bg-primary text-primary-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {option.label}
            </button>
          )
        })}
      </div>
    </div>
  )
}

/** Pull a human message off an unknown thrown value, falling back to `fallback`. */
function messageOf(caught: unknown, fallback: string): string {
  return caught instanceof Error && caught.message ? caught.message : fallback
}
