import { useEffect, useState } from 'react'
import { Loader2, Shield } from 'lucide-react'
import { Switch } from '@/components/den/switch'
import type { PrivacySettings } from '@shared/settings'

/**
 * PrivacyTab — the Settings → Privacy & telemetry tab (issue 2-14, stories 43–44; design:
 * screens/settings.md "Privacy & telemetry").
 *
 * The **control surface** for telemetry consent. It surfaces this environment's telemetry-consent
 * flags — three INDEPENDENT opt-ins, **all OFF by default** — over the `privacy:*` IPC seam, so
 * out of the box nothing leaves the environment and every off-environment flow is a deliberate
 * opt-in (privacy-by-default; ADR 0001 keeps dotden backend-free):
 *
 * - **Usage analytics** — anonymous, allowlisted usage **wide events** (ADR 0007).
 * - **Crash reports** — a crash/error report (stack + app version) on an unexpected failure.
 * - **Diagnostic logs** — anonymized diagnostic logs attached to a crash report.
 *
 * Each toggle's copy states EXACTLY what it would share, so consent is **informed** — and the
 * `Shield` note restates the structural guarantee: telemetry is Wide-events only, so paths, file
 * contents, secrets, and repo URLs cannot be represented by construction (only the bounded
 * **Allowlisted attribute key** set, CONTEXT.md / ADR 0007).
 *
 * **CONTROL SURFACE ONLY (the load-bearing scope rule, issue 2-14).** Flipping a toggle here
 * persists a stored boolean and NOTHING else — no network call, no telemetry SDK, no egress. The
 * actual egress wiring (the Sentry/Umami clients gated behind these flags) and the first-launch
 * consent screen are PRD 3 (issues 3-09/3-10), which READ this consent. The state persists so PRD
 * 3 can read it, but flipping a toggle here sends nothing anywhere yet.
 *
 * Consent is **environment-local** (ADR 0024): a per-machine decision — a shared/locked-down
 * machine refuses telemetry independently — so it lives in Electron `userData`, never the synced
 * `.dotden/`.
 *
 * Saving is optimistic-then-authoritative, mirroring the Sync/Appearance tabs: the UI flips
 * immediately, calls `window.dotden.privacy.setSettings`, and re-renders from the consent the main
 * process returns. A failed write reverts the optimistic flip and surfaces an inline error — it
 * never fails silently (and a failed consent write must never look like consent was granted).
 */
export function PrivacyTab() {
  const [settings, setSettings] = useState<PrivacySettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load this environment's current telemetry consent once on mount.
  useEffect(() => {
    let alive = true
    window.dotden.privacy
      .getSettings()
      .then((loaded) => {
        if (alive) setSettings(loaded)
      })
      .catch((caught: unknown) => {
        if (alive) setError(messageOf(caught, 'Could not load your privacy settings.'))
      })
    return () => {
      alive = false
    }
  }, [])

  /**
   * Persist a single changed consent flag. Flips the UI optimistically, writes via IPC, then
   * adopts the consent the main process returns. On failure, reverts to the previous consent and
   * surfaces the error — a failed write must never leave the toggle looking opted-in when it is
   * not (never fail silently).
   */
  async function update(patch: Partial<PrivacySettings>) {
    if (!settings) return
    const previous = settings
    const next: PrivacySettings = { ...settings, ...patch }
    setSettings(next) // optimistic
    setSaving(true)
    setError(null)
    try {
      const persisted = await window.dotden.privacy.setSettings(next)
      setSettings(persisted)
    } catch (caught) {
      setSettings(previous) // revert the optimistic flip
      setError(messageOf(caught, 'Could not save your privacy settings.'))
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
            <Loader2 className="size-4 animate-spin" /> Loading privacy settings…
          </>
        )}
      </div>
    )
  }

  return (
    <div className="flex max-w-2xl flex-col gap-8 p-8">
      <header className="space-y-1">
        <h2 className="text-foreground text-xl font-semibold tracking-tight">
          Privacy &amp; telemetry
        </h2>
        <p className="text-muted-foreground text-sm leading-relaxed">
          Everything below is <span className="text-foreground font-medium">off</span> until you
          turn it on. dotden has no backend — nothing leaves this computer unless you opt in here.
        </p>
      </header>

      {error ? (
        <p className="text-dd-red-400 text-xs" role="alert">
          {error}
        </p>
      ) : null}

      {/* Card of independent opt-in Switch rows (design: settings.md "Privacy & telemetry"). */}
      <div className="border-border bg-card divide-border divide-y rounded-lg border">
        {PRIVACY_TOGGLES.map((toggle) => (
          <SwitchRow
            key={toggle.key}
            title={toggle.label}
            sub={toggle.hint}
            checked={settings[toggle.key]}
            disabled={saving}
            onCheckedChange={(on) => void update({ [toggle.key]: on })}
          />
        ))}
      </div>

      {/* The Shield note — the structural guarantee (Wide-events only, ADR 0007). */}
      <div className="border-dd-ember-900 bg-dd-ember-950 flex items-start gap-3 rounded-lg border p-4">
        <Shield className="text-dd-ember-400 mt-0.5 size-5 shrink-0" />
        <div className="space-y-1">
          <p className="text-foreground text-sm font-medium">What can — and can’t — be shared</p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            If you opt in, dotden only ever sends{' '}
            <span className="text-foreground font-medium">anonymous events from a fixed list</span>{' '}
            of allowed fields. Your file paths, file contents, secrets, and repo URL{' '}
            <span className="text-foreground font-medium">can’t be sent</span> — there’s no field
            for them, so they never leave this computer.
          </p>
        </div>
      </div>
    </div>
  )
}

/**
 * The three telemetry consents, in order, keyed onto {@link PrivacySettings}, with the honest
 * copy the tab shows for each (so consent is informed — story 43). Each `hint` states exactly
 * what opting in would share.
 */
const PRIVACY_TOGGLES: readonly {
  key: keyof PrivacySettings
  label: string
  hint: string
}[] = [
  {
    key: 'analyticsEnabled',
    label: 'Share anonymous usage',
    hint: 'Send anonymous events about which features you use, so dotden can be improved. Never your file paths, contents, secrets, or repo URL.',
  },
  {
    key: 'crashReportsEnabled',
    label: 'Send crash reports',
    hint: 'When dotden hits an unexpected error, send the crash details (what failed + the app version) so it can be fixed.',
  },
  {
    key: 'diagnosticLogsEnabled',
    label: 'Attach diagnostic logs',
    hint: 'Include anonymized diagnostic logs with a crash report to help track down hard-to-reproduce problems.',
  },
]

/**
 * A single Settings row with a title, sub-copy, and a trailing {@link Switch} (design-system
 * `SettingsRow` `Trail=Switch`). Mirrors the Sync/Appearance tabs' row; private to this tab.
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

/** Pull a human message off an unknown thrown value, falling back to `fallback`. */
function messageOf(caught: unknown, fallback: string): string {
  return caught instanceof Error && caught.message ? caught.message : fallback
}
