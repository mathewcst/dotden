import { useEffect, useState } from 'react'
import { Loader2, Palette } from 'lucide-react'
import { Switch } from '@/components/ui/switch'
import { cn } from '@/lib/utils'
import {
  applyTheme,
  type AppearanceSettings,
  type DefaultApplyBehavior,
  type NotifyOn,
  THEMES,
} from '@/lib/apply-theme'

/**
 * AppearanceTab — the Settings → Appearance tab (issue 2-10, story 54; design:
 * screens/settings.md, extended consistently with the design system).
 *
 * The **producing surface** for the two remaining synced settings story 54 names (the third,
 * the commit template, is the Commit tab, issue 2-09):
 *
 * - **Theme** — dotden is dark-only, so the choice is which warm **accent** the (sole
 *   interactive) hue uses ({@link THEMES}). Selecting one applies it **live** to the whole app
 *   (a single class toggle on `<html>` via {@link applyTheme}) — genuinely applied appearance,
 *   not a stored-but-inert flag — and persists it as a synced default.
 * - **Default Apply / notification preferences** — the preferred default Apply behaviour
 *   (`review` vs `apply-all`) and which cross-environment events fire an OS notification
 *   (`incoming` / `conflict` / `applied`). These author **values only**: setting them never
 *   relaxes an invariant (the AutomationPolicy/ApplyPlanner owners still own the real Apply,
 *   ADR 0008) and sends nothing across environments by itself — the sync-as-default plumbing is
 *   issue 2-17, exactly as for the commit template.
 *
 * Both controls are **user-authored preference**, so they sync as defaults through `.myenv/`
 * (ADR 0024); saving Commits the change LOCALLY (ADR 0006) and it travels on the next Sync.
 *
 * Saving is optimistic-then-authoritative, mirroring the Sync/Commit tabs: the UI flips
 * immediately (and the theme paints immediately), writes via IPC, then adopts the returned
 * source of truth. A failed write reverts the optimistic flip (re-applying the prior theme) and
 * surfaces an inline error — it never fails silently.
 */
export function AppearanceTab() {
  const [settings, setSettings] = useState<AppearanceSettings | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Load this Den's current appearance settings once on mount.
  useEffect(() => {
    let alive = true
    window.dotden.den
      .appearanceSettings()
      .then((loaded) => {
        if (!alive) return
        setSettings(loaded)
        // Paint the persisted theme as soon as we know it (the tab is reached from the live app,
        // where App.tsx already applied it on launch; re-applying here is harmless + keeps the
        // tab self-consistent if it is the first thing rendered).
        applyTheme(loaded.theme)
      })
      .catch((caught: unknown) => {
        if (alive) setError(messageOf(caught, 'Could not load your appearance settings.'))
      })
    return () => {
      alive = false
    }
  }, [])

  /**
   * Persist a changed field. Flips the UI optimistically (and paints the theme immediately when
   * `theme` changed), writes via IPC, then adopts the returned settings. On failure, reverts to
   * the previous settings — re-applying the previous theme — and surfaces the error.
   */
  async function update(patch: Partial<AppearanceSettings>) {
    if (!settings) return
    const previous = settings
    const next: AppearanceSettings = { ...settings, ...patch }
    setSettings(next) // optimistic
    if (next.theme !== previous.theme) applyTheme(next.theme) // paint immediately
    setSaving(true)
    setError(null)
    try {
      const persisted = await window.dotden.den.setAppearanceSettings(next)
      setSettings(persisted)
      applyTheme(persisted.theme)
    } catch (caught) {
      setSettings(previous) // revert the optimistic flip
      applyTheme(previous.theme) // …and the live theme
      setError(messageOf(caught, 'Could not save your appearance settings.'))
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
            <Loader2 className="size-4 animate-spin" /> Loading appearance settings…
          </>
        )}
      </div>
    )
  }

  return (
    <div className="flex max-w-2xl flex-col gap-10 p-8">
      <header className="space-y-1">
        <h2 className="text-foreground text-xl font-semibold tracking-tight">Appearance</h2>
        <p className="text-muted-foreground text-sm leading-relaxed">
          How dotden looks and behaves by default. These are{' '}
          <span className="text-foreground font-medium">shared defaults</span> — they sync to your
          other computers, where you can still override them.
        </p>
      </header>

      {error ? (
        <p className="text-dd-red-400 text-xs" role="alert">
          {error}
        </p>
      ) : null}

      {/* ── Theme ────────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <div className="flex items-center gap-2">
          <Palette className="text-dd-ember-400 size-4" />
          <h3 className="text-foreground text-sm font-semibold">Theme</h3>
        </div>
        <p className="text-muted-foreground text-xs leading-relaxed">
          dotden is a warm, dark app. Pick the accent that tints it.
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {THEMES.map((theme) => {
            const selected = theme.id === settings.theme
            return (
              <button
                key={theme.id}
                type="button"
                disabled={saving}
                aria-pressed={selected}
                title={theme.description}
                onClick={() => void update({ theme: theme.id })}
                className={cn(
                  'flex flex-col items-start gap-2 rounded-lg border p-3 text-left transition-colors disabled:opacity-50',
                  selected
                    ? 'border-dd-ember-500 bg-dd-ember-950'
                    : 'border-border bg-card hover:border-dd-ember-700',
                )}
              >
                <span
                  className="size-5 rounded-full ring-1 ring-white/10"
                  style={{ backgroundColor: theme.swatchVar }}
                  aria-hidden
                />
                <span className="text-foreground text-sm font-medium">{theme.label}</span>
              </button>
            )
          })}
        </div>
      </section>

      {/* ── Default Apply behaviour ──────────────────────────────────────── */}
      <section className="space-y-3">
        <h3 className="text-foreground text-sm font-semibold">When changes come in</h3>
        <p className="text-muted-foreground text-xs leading-relaxed">
          Your preferred default for incoming changes from another computer. dotden{' '}
          <span className="text-foreground font-medium">always confirms deletions</span> and{' '}
          <span className="text-foreground font-medium">never auto-resolves conflicts</span>,
          whichever you pick.
        </p>
        <div className="border-border bg-card divide-border flex flex-col divide-y rounded-lg border">
          {DEFAULT_APPLY_OPTIONS.map((option) => (
            <ChoiceRow
              key={option.value}
              title={option.label}
              sub={option.hint}
              selected={option.value === settings.defaultApply}
              disabled={saving}
              onSelect={() => void update({ defaultApply: option.value })}
            />
          ))}
        </div>
      </section>

      {/* ── Notification preferences ─────────────────────────────────────── */}
      <section className="space-y-3">
        <h3 className="text-foreground text-sm font-semibold">Notify me when</h3>
        <p className="text-muted-foreground text-xs leading-relaxed">
          Which cross-computer events show an OS notification. dotden only ever{' '}
          <span className="text-foreground font-medium">tells you</span> — a notification never
          applies anything on its own.
        </p>
        <div className="border-border bg-card divide-border flex flex-col divide-y rounded-lg border">
          {NOTIFY_OPTIONS.map((option) => (
            <SwitchRow
              key={option.key}
              title={option.label}
              sub={option.hint}
              checked={settings.notifyOn[option.key]}
              disabled={saving}
              onCheckedChange={(on) =>
                void update({ notifyOn: { ...settings.notifyOn, [option.key]: on } })
              }
            />
          ))}
        </div>
      </section>
    </div>
  )
}

/** The two default-Apply options, in order, with the plain copy the tab shows for each. */
const DEFAULT_APPLY_OPTIONS: readonly {
  value: DefaultApplyBehavior
  label: string
  hint: string
}[] = [
  {
    value: 'review',
    label: 'Let me review first',
    hint: 'Show incoming changes and apply them only after you look — the safe default.',
  },
  {
    value: 'apply-all',
    label: 'Apply them for me',
    hint: 'Prefer to apply incoming changes without reviewing each File. Conflicts and deletions still ask.',
  },
]

/** The three notification events, in order, keyed onto {@link NotifyOn}, with their copy. */
const NOTIFY_OPTIONS: readonly { key: keyof NotifyOn; label: string; hint: string }[] = [
  {
    key: 'incoming',
    label: 'Another computer changes my Den',
    hint: 'Incoming changes are waiting to be reviewed and applied.',
  },
  {
    key: 'conflict',
    label: 'A conflict needs me',
    hint: 'The same File changed in two places — dotden needs you to resolve it.',
  },
  {
    key: 'applied',
    label: 'Changes were applied for me',
    hint: 'Informational — only happens when you’ve turned on automatic applying.',
  },
]

/**
 * A radio-style choice row: a title, sub-copy, and a leading ember dot when selected
 * (design-system `SelectRow`; ember = the sole interactive hue). Private to this tab.
 */
function ChoiceRow({
  title,
  sub,
  selected,
  disabled,
  onSelect,
}: {
  title: string
  sub: string
  selected: boolean
  disabled?: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      aria-pressed={selected}
      onClick={onSelect}
      className="flex items-start gap-3 px-4 py-3.5 text-left transition-colors disabled:opacity-50"
    >
      <span
        className={cn(
          'mt-0.5 flex size-4 shrink-0 items-center justify-center rounded-full border',
          selected ? 'border-dd-ember-500' : 'border-border',
        )}
        aria-hidden
      >
        {selected ? <span className="bg-dd-ember-500 size-2 rounded-full" /> : null}
      </span>
      <span className="flex-1">
        <span className="text-foreground block text-sm font-medium">{title}</span>
        <span className="text-muted-foreground block text-xs leading-relaxed">{sub}</span>
      </span>
    </button>
  )
}

/**
 * A Settings row with a title, sub-copy, and a trailing {@link Switch} (design-system
 * `SettingsRow` `Trail=Switch`). Mirrors the Sync tab's row; private to this tab.
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
