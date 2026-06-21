import { useEffect, useState, type ReactNode } from 'react'
import { Loader2, Palette, RotateCcw } from 'lucide-react'
import { Switch } from '@/components/den/switch'
import { cn } from '@/lib/utils'
import {
  applyTheme,
  resolveAppearanceSettings,
  type AppearanceOverride,
  type AppearanceSettings,
  type DefaultApplyBehavior,
  type NotifyOn,
  THEMES,
} from '@/lib/apply-theme'

/**
 * AppearanceTab — the Settings → Appearance tab (issues 2-10 + 2-17, story 54; design:
 * screens/settings.md, extended consistently with the design system).
 *
 * The three appearance settings — app theme, preferred default Apply behaviour, and which
 * cross-environment events notify — follow ADR 0024's synced-vs-local split:
 *
 * - Each value SYNCS through `.dotden/` as a **shared default** (issue 2-10), so a fresh computer
 *   inherits it.
 * - An environment MAY **override it locally** (issue 2-17) without changing it everywhere.
 *
 * The tab surfaces that split with a **scope switch** ("All my computers" vs "Just this computer"):
 *
 * - **All my computers** edits the SYNCED default (`setAppearanceSettings`) — Commits the `.dotden/`
 *   change LOCALLY (ADR 0006) and it travels on the next Sync.
 * - **Just this computer** pins a LOCAL override (`setAppearanceOverride`) — written to `userData`
 *   only, NEVER `.dotden/`, so it shadows the default without changing it for the other computers.
 *
 * The controls always show the **effective** value (synced default overlaid by the local override —
 * local wins). A field that is overridden-here gets a "reset" affordance that clears just that local
 * pin and falls back to the synced default. Saving is optimistic-then-authoritative, mirroring the
 * Sync/Commit tabs, and a failed write reverts the optimistic flip (re-applying the prior theme) —
 * it never fails silently. Default Apply authors a **value only**: it never relaxes an invariant
 * (the AutomationPolicy/ApplyPlanner owners still own the real Apply, ADR 0008).
 */
export function AppearanceTab() {
  /** The synced shared default (what edits "for all my computers" change). */
  const [synced, setSynced] = useState<AppearanceSettings | null>(null)
  /** This computer's sparse local override (only the fields pinned here; `{}` = follow synced). */
  const [override, setOverride] = useState<AppearanceOverride>({})
  /** Whether the controls edit the local override (this computer) or the synced default (all). */
  const [scope, setScope] = useState<EditScope>('all')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // The value the controls bind to: the synced default overlaid by this computer's local override.
  const effective = synced ? resolveAppearanceSettings(synced, override) : null

  // Load this Den's full appearance state (synced · override · effective) once on mount.
  useEffect(() => {
    let alive = true
    window.dotden.den
      .appearanceState()
      .then((state) => {
        if (!alive) return
        setSynced(state.synced)
        setOverride(state.override)
        // Paint the EFFECTIVE theme (App.tsx already applied it on launch; re-applying keeps the
        // tab self-consistent if it is the first thing rendered).
        applyTheme(state.effective.theme)
      })
      .catch((caught: unknown) => {
        if (alive) setError(messageOf(caught, 'Could not load your appearance settings.'))
      })
    return () => {
      alive = false
    }
  }, [])

  /**
   * Apply a field change at the CURRENT scope. In "all" scope it rewrites the synced default; in
   * "this computer" scope it pins (or merges) the field into the local override. Optimistic, paints
   * the theme immediately, writes via IPC, then adopts the returned source of truth; on failure it
   * reverts (re-applying the prior theme) and surfaces the error.
   */
  async function update(patch: Partial<AppearanceSettings>) {
    if (!synced || !effective) return
    const prevSynced = synced
    const prevOverride = override
    const prevTheme = effective.theme

    // Optimistically compute the next state for the active scope.
    const nextSynced = scope === 'all' ? { ...synced, ...patch } : synced
    const nextOverride = scope === 'this' ? { ...override, ...patch } : override
    setSynced(nextSynced)
    setOverride(nextOverride)
    const nextTheme = resolveAppearanceSettings(nextSynced, nextOverride).theme
    if (nextTheme !== prevTheme) applyTheme(nextTheme)

    setSaving(true)
    setError(null)
    try {
      const state =
        scope === 'all'
          ? await window.dotden.den.setAppearanceSettings(nextSynced)
          : await window.dotden.den.setAppearanceOverride(nextOverride)
      setSynced(state.synced)
      setOverride(state.override)
      applyTheme(state.effective.theme)
    } catch (caught) {
      setSynced(prevSynced) // revert the optimistic flip
      setOverride(prevOverride)
      applyTheme(prevTheme) // …and the live theme
      setError(messageOf(caught, 'Could not save your appearance settings.'))
    } finally {
      setSaving(false)
    }
  }

  /** Clear a single local pin (this computer falls back to the synced default for that field). */
  async function resetField(field: keyof AppearanceOverride) {
    if (!synced) return
    const prevOverride = override
    const prevTheme = effective?.theme
    const next: AppearanceOverride = { ...override }
    delete next[field]
    setOverride(next)
    const nextTheme = resolveAppearanceSettings(synced, next).theme
    if (prevTheme && nextTheme !== prevTheme) applyTheme(nextTheme)
    setSaving(true)
    setError(null)
    try {
      const state = await window.dotden.den.setAppearanceOverride(next)
      setSynced(state.synced)
      setOverride(state.override)
      applyTheme(state.effective.theme)
    } catch (caught) {
      setOverride(prevOverride)
      if (prevTheme) applyTheme(prevTheme)
      setError(messageOf(caught, 'Could not reset to the synced default.'))
    } finally {
      setSaving(false)
    }
  }

  if (!synced || !effective) {
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

  /** True when `field` is pinned locally on this computer (shadows the synced default). */
  const pinned = (field: keyof AppearanceOverride): boolean => override[field] !== undefined

  return (
    <div className="flex max-w-2xl flex-col gap-10 p-8">
      <header className="space-y-1">
        <h2 className="text-foreground text-xl font-semibold tracking-tight">Appearance</h2>
        <p className="text-muted-foreground text-sm leading-relaxed">
          How dotden looks and behaves. By default these are{' '}
          <span className="text-foreground font-medium">shared</span> across your computers — but
          you can override any of them on just this one.
        </p>
      </header>

      {/* ── Edit scope: shared default vs. this-computer override ───────────── */}
      <div
        className="border-border bg-card flex w-fit items-center gap-1 rounded-lg border p-1"
        role="radiogroup"
        aria-label="Where these changes apply"
      >
        <ScopeButton active={scope === 'all'} disabled={saving} onClick={() => setScope('all')}>
          All my computers
        </ScopeButton>
        <ScopeButton active={scope === 'this'} disabled={saving} onClick={() => setScope('this')}>
          Just this computer
        </ScopeButton>
      </div>
      <p className="text-muted-foreground -mt-6 text-xs leading-relaxed">
        {scope === 'all'
          ? 'Changes sync to your other computers as the new shared default.'
          : 'Changes stay on this computer only and never sync — they override the shared default here.'}
      </p>

      {error ? (
        <p className="text-dd-red-400 text-xs" role="alert">
          {error}
        </p>
      ) : null}

      {/* ── Theme ────────────────────────────────────────────────────────── */}
      <section className="space-y-3">
        <SectionHeader
          icon={<Palette className="text-dd-ember-400 size-4" />}
          title="Theme"
          pinned={pinned('theme')}
          onReset={() => void resetField('theme')}
          disabled={saving}
        />
        <p className="text-muted-foreground text-xs leading-relaxed">
          dotden is a warm, dark app. Pick the accent that tints it.
        </p>
        <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
          {THEMES.map((theme) => {
            const selected = theme.id === effective.theme
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
        <SectionHeader
          title="When changes come in"
          pinned={pinned('defaultApply')}
          onReset={() => void resetField('defaultApply')}
          disabled={saving}
        />
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
              selected={option.value === effective.defaultApply}
              disabled={saving}
              onSelect={() => void update({ defaultApply: option.value })}
            />
          ))}
        </div>
      </section>

      {/* ── Notification preferences ─────────────────────────────────────── */}
      <section className="space-y-3">
        <SectionHeader
          title="Notify me when"
          pinned={pinned('notifyOn')}
          onReset={() => void resetField('notifyOn')}
          disabled={saving}
        />
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
              checked={effective.notifyOn[option.key]}
              disabled={saving}
              onCheckedChange={(on) =>
                void update({ notifyOn: { ...effective.notifyOn, [option.key]: on } })
              }
            />
          ))}
        </div>
      </section>
    </div>
  )
}

/** Which scope the controls write to: the shared synced default, or this computer's local override. */
type EditScope = 'all' | 'this'

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

/** One segment of the edit-scope switch (shared default vs. this-computer override). Private. */
function ScopeButton({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean
  disabled?: boolean
  onClick: () => void
  children: ReactNode
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={active}
      disabled={disabled}
      onClick={onClick}
      className={cn(
        'rounded-md px-3 py-1.5 text-xs font-medium transition-colors disabled:opacity-50',
        active
          ? 'bg-dd-ember-500 text-dd-ember-950'
          : 'text-muted-foreground hover:text-foreground',
      )}
    >
      {children}
    </button>
  )
}

/**
 * A section heading with an optional "Overridden on this computer" badge + reset-to-synced control
 * (issue 2-17). The badge appears only when the section's field is pinned locally; resetting clears
 * just that local pin so the field follows the synced default again. Private to this tab.
 */
function SectionHeader({
  icon,
  title,
  pinned,
  onReset,
  disabled,
}: {
  icon?: ReactNode
  title: string
  pinned: boolean
  onReset: () => void
  disabled?: boolean
}) {
  return (
    <div className="flex items-center gap-2">
      {icon}
      <h3 className="text-foreground text-sm font-semibold">{title}</h3>
      {pinned ? (
        <span className="flex items-center gap-2">
          <span className="border-dd-ember-700 text-dd-ember-300 rounded-full border px-2 py-0.5 text-[11px] font-medium">
            On this computer
          </span>
          <button
            type="button"
            disabled={disabled}
            onClick={onReset}
            title="Reset to the synced default"
            className="text-muted-foreground hover:text-foreground inline-flex items-center gap-1 text-[11px] disabled:opacity-50"
          >
            <RotateCcw className="size-3" /> Use shared
          </button>
        </span>
      ) : null}
    </div>
  )
}

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
