import { useEffect, useState } from 'react'
import { Loader2, Shield } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { ConfirmDialog } from '@/shared/components/ConfirmDialog'
import type { AutomationLevel } from '../../../../main/foundation/apply/automation-policy'

/**
 * AutomationTab — the Settings → Automation tab (issues 2-12 + 2-13, stories 27–32; design:
 * screens/settings.md "Automation").
 *
 * The headline Settings tab: a **risk-graded ladder** of automation levels laid out
 * **safest → riskiest** (Manual → Auto-sync → Auto-apply → YOLO), so the user sees exactly
 * what each rung opts into before choosing (ADR 0006's automation ladder). Each rung is a
 * `SelectRow` — a radio with a leading ember dot when selected (ember = the sole interactive
 * hue) plus a trailing functional-tone `Pill` that grades the risk: **Default** on Manual,
 * **Warned** (amber) on Auto-apply, **Strongly warned** (red) on YOLO. The Pill is the ONLY
 * non-ember colour here, and it is never an interactive control — it just labels risk.
 *
 * The level is **environment-local** (CONTEXT.md "Auto-sync"): each environment decides its
 * own rung, read/written over the `automation:*` IPC seam. Every level is **off until
 * explicitly turned on** — selecting one never retroactively changes how the environment
 * already behaved (acceptance criterion: enabling is the only thing that turns a rung on).
 *
 * Turning on the two riskier rungs gates behind an enable-time {@link ConfirmDialog}:
 * - **Auto-apply** (amber, default-tone dialog) names exactly what STAYS manual — Conflicts,
 *   the uncommitted-edit guard, and incoming deletions — so the user enables it understanding
 *   the boundary;
 * - **YOLO** (issue 2-13) is the **strongly-warned** top rung: a destructive-tone (red,
 *   alert-triangle) dialog that spells out the trade-off — it ALSO auto-commits your local
 *   edits and merges everything on its own — while reaffirming the one sacred boundary that
 *   still holds (a true conflict is never auto-resolved). The name + the red treatment + the
 *   copy make the trade-off obvious before it can be turned on (acceptance criterion).
 *
 * The safety itself is enforced in the main process by the invariant owners (ADR 0008); this
 * copy mirrors that guarantee so the UI never overpromises. The persistent `Shield` note at
 * the bottom restates the never-relax invariants for every rung — including YOLO.
 */
export function AutomationTab() {
  const [level, setLevel] = useState<AutomationLevel | null>(null)
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  // Each riskier rung is a two-step gate: clicking it opens its enable-time dialog, and only
  // Confirm actually persists the level (Cancel leaves the prior rung). Separate flags so the
  // amber Auto-apply warning and the red strongly-warned YOLO warning never collide.
  const [warnAutoApply, setWarnAutoApply] = useState(false)
  const [warnYolo, setWarnYolo] = useState(false)

  // Load this environment's current automation level once on mount.
  useEffect(() => {
    let alive = true
    window.dotden.automation
      .getLevel()
      .then((loaded) => {
        if (alive) setLevel(loaded)
      })
      .catch((caught: unknown) => {
        if (alive) setError(messageOf(caught, 'Could not load your automation level.'))
      })
    return () => {
      alive = false
    }
  }, [])

  /**
   * Persist a new level. Flips the UI optimistically, writes via IPC (which re-arms the
   * automation-dependent services in the main process), and reverts + surfaces the error on
   * failure — never fail silently. The main process rejects any non-selectable rung, so an
   * unbuilt level can never be persisted from here.
   */
  async function commit(next: AutomationLevel) {
    if (!level || next === level) return
    const previous = level
    setLevel(next) // optimistic
    setSaving(true)
    setError(null)
    try {
      await window.dotden.automation.setLevel(next)
    } catch (caught) {
      setLevel(previous) // revert the optimistic flip
      setError(messageOf(caught, 'Could not change your automation level.'))
    } finally {
      setSaving(false)
    }
  }

  /**
   * Handle a rung selection. The two riskier rungs route through an enable-time warning first
   * (the user must acknowledge the trade-off): **Auto-apply** behind the amber "what stays
   * manual" dialog, **YOLO** behind the red strongly-warned dialog. Every other selectable
   * rung commits straight away. Selecting the rung you are already on is a no-op.
   */
  function select(next: AutomationLevel) {
    if (next === level) return
    if (next === 'auto-apply') {
      setWarnAutoApply(true) // gate behind the amber warning dialog
      return
    }
    if (next === 'yolo') {
      setWarnYolo(true) // gate behind the red, strongly-warned dialog (issue 2-13)
      return
    }
    void commit(next)
  }

  if (!level) {
    return (
      <div className="text-muted-foreground flex items-center gap-2 p-8 text-sm">
        {error ? (
          <span className="text-dd-red-400" role="alert">
            {error}
          </span>
        ) : (
          <>
            <Loader2 className="size-4 animate-spin" /> Loading automation…
          </>
        )}
      </div>
    )
  }

  return (
    <div className="flex max-w-2xl flex-col gap-8 p-8">
      <header className="space-y-1">
        <h2 className="text-foreground text-xl font-semibold tracking-tight">Automation</h2>
        <p className="text-muted-foreground text-sm leading-relaxed">
          How much dotden does on its own. Each level builds on the one above it — pick the least
          automatic one you’re comfortable with. This setting is{' '}
          <span className="text-foreground font-medium">specific to this computer</span>.
        </p>
      </header>

      {error ? (
        <p className="text-dd-red-400 text-xs" role="alert">
          {error}
        </p>
      ) : null}

      {/* The risk-graded ladder, safest → riskiest (design: settings.md "Automation"). */}
      <div
        role="radiogroup"
        aria-label="Automation level"
        className="border-border bg-card divide-border divide-y rounded-lg border"
      >
        {AUTOMATION_LEVELS.map((rung) => (
          <SelectRow
            key={rung.value}
            rung={rung}
            selected={rung.value === level}
            disabled={saving}
            onSelect={() => select(rung.value)}
          />
        ))}
      </div>

      {/* The persistent never-relax note — restates the invariants that hold at EVERY rung. */}
      <div className="border-dd-ember-900 bg-dd-ember-950 flex items-start gap-3 rounded-lg border p-4">
        <Shield className="text-dd-ember-400 mt-0.5 size-5 shrink-0" />
        <div className="space-y-1">
          <p className="text-foreground text-sm font-medium">Some things always ask you first</p>
          <p className="text-muted-foreground text-xs leading-relaxed">
            No matter how much you automate, dotden{' '}
            <span className="text-foreground font-medium">never resolves a conflict for you</span>,
            never overwrites a file you’ve edited but not committed, and{' '}
            <span className="text-foreground font-medium">always confirms a deletion</span> before
            removing a file. These can’t be turned off.
          </p>
        </div>
      </div>

      {/* Auto-apply enable-time warning — names exactly what stays manual (acceptance criterion). */}
      <ConfirmDialog
        open={warnAutoApply}
        onOpenChange={setWarnAutoApply}
        badge={<Shield className="size-5" />}
        title="Turn on Auto-apply?"
        body={
          <>
            Clean incoming changes will be applied to this computer automatically, without you
            reviewing each one.{' '}
            <span className="text-foreground font-medium">
              Conflicts, files you’ve edited but not committed, and deletions still stop and ask you
            </span>{' '}
            — those are never applied on their own. You can switch back to manual any time.
          </>
        }
        confirmLabel="Turn on Auto-apply"
        confirmDisabled={saving}
        onConfirm={() => void commit('auto-apply')}
      />

      {/* YOLO enable-time warning — STRONGLY warned (issue 2-13). Destructive tone (red Confirm +
          alert-triangle badge) makes the trade-off unmistakable before it can be turned on, while
          reaffirming the one boundary that still holds: a true conflict is never auto-resolved. */}
      <ConfirmDialog
        open={warnYolo}
        onOpenChange={setWarnYolo}
        tone="destructive"
        title="Turn on YOLO mode?"
        body={
          <>
            dotden will run fully hands-off on this computer:{' '}
            <span className="text-foreground font-medium">
              it will commit your local edits for you, push them, and merge and apply everything on
              its own
            </span>{' '}
            — with no review. This is the most automated, least cautious setting.{' '}
            <span className="text-foreground font-medium">
              Even so, a real conflict still stops and asks you
            </span>{' '}
            — dotden never picks a side for you. You can switch back to manual any time.
          </>
        }
        confirmLabel="Turn on YOLO mode"
        confirmDisabled={saving}
        onConfirm={() => void commit('yolo')}
      />
    </div>
  )
}

/** A risk tone for a rung's trailing Pill (functional colour; never interactive). */
type RungTone = 'default' | 'warned' | 'strongly-warned'

/** One ladder rung's presentation metadata (the SelectRow content). */
interface Rung {
  /** The persisted automation level this rung selects. */
  readonly value: AutomationLevel
  /** Rung title (dotden vocabulary). */
  readonly title: string
  /** Plain-language description of what this rung makes automatic. */
  readonly sub: string
  /** The trailing Pill's label + tone, grading the rung's risk. */
  readonly pill: { readonly label: string; readonly tone: RungTone }
}

/**
 * The four ladder rungs, **safest → riskiest** (design: settings.md "Automation"). All four
 * are selectable as of issue 2-13 (Manual default · Auto-sync · Auto-apply warned · YOLO
 * strongly warned); the two riskier rungs gate behind an enable-time confirmation.
 */
const AUTOMATION_LEVELS: readonly Rung[] = [
  {
    value: 'manual',
    title: 'Manual',
    sub: 'Nothing happens on its own. You commit, sync, and apply changes yourself. dotden just watches and tells you when another computer has changes.',
    pill: { label: 'Default', tone: 'default' },
  },
  {
    value: 'auto-sync',
    title: 'Auto-sync',
    sub: 'Your committed changes push automatically, and incoming changes are fetched and announced. Applying them still stays a manual review.',
    pill: { label: 'Low risk', tone: 'default' },
  },
  {
    value: 'auto-apply',
    title: 'Auto-apply',
    sub: 'Clean incoming changes apply on their own — no review. Conflicts, files you’ve edited but not committed, and deletions still ask you first.',
    pill: { label: 'Warned', tone: 'warned' },
  },
  {
    value: 'yolo',
    title: 'YOLO mode',
    sub: 'Fully hands-off — also commits your local edits for you and merges everything on its own. Even here, a real conflict still stops and asks you.',
    pill: { label: 'Strongly warned', tone: 'strongly-warned' },
  },
]

/**
 * One ladder rung as a `SelectRow` (design-system `SelectRow`): a leading ember radio dot
 * when selected, a title + description, and a trailing functional-tone risk {@link Pill}.
 * `disabled` is the in-flight guard — every rung is momentarily non-interactive while a level
 * change is being persisted, so a double-click can't race two writes; it is NOT a per-rung
 * availability flag (all four rungs are selectable as of issue 2-13).
 */
function SelectRow({
  rung,
  selected,
  disabled,
  onSelect,
}: {
  rung: Rung
  selected: boolean
  disabled?: boolean
  onSelect: () => void
}) {
  return (
    <button
      type="button"
      role="radio"
      aria-checked={selected}
      disabled={disabled}
      onClick={onSelect}
      className={cn(
        'flex w-full items-start gap-3 px-4 py-3.5 text-left transition-colors',
        disabled ? 'cursor-not-allowed opacity-50' : 'hover:bg-secondary/30',
      )}
    >
      {/* Leading radio — ember when selected (the sole interactive hue). */}
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
        <span className="flex items-center gap-2">
          <span className="text-foreground text-sm font-medium">{rung.title}</span>
        </span>
        <span className="text-muted-foreground mt-0.5 block text-xs leading-relaxed">
          {rung.sub}
        </span>
      </span>
      {/* Trailing risk Pill — functional colour only, never interactive (design system). */}
      <Pill label={rung.pill.label} tone={rung.pill.tone} />
    </button>
  )
}

/**
 * A trailing risk {@link Pill} (design-system `Pill`). It is a pure label, never an
 * interactive control, so it uses functional status tones — neutral for Default/Low-risk,
 * **amber** for Warned (Auto-apply), **red** for Strongly-warned (YOLO) — keeping ember
 * reserved as the one interactive hue (design system functional-colour discipline).
 */
function Pill({ label, tone }: { label: string; tone: RungTone }) {
  return (
    <span
      className={cn(
        'mt-0.5 shrink-0 rounded-full border px-2 py-0.5 text-[10px] font-medium whitespace-nowrap',
        tone === 'default' && 'border-border text-muted-foreground',
        tone === 'warned' && 'border-dd-amber-500/40 bg-dd-amber-950 text-dd-amber-400',
        tone === 'strongly-warned' && 'border-dd-red-500/40 bg-dd-red-950 text-dd-red-400',
      )}
    >
      {label}
    </span>
  )
}

/** Pull a human message off an unknown thrown value, falling back to `fallback`. */
function messageOf(caught: unknown, fallback: string): string {
  return caught instanceof Error && caught.message ? caught.message : fallback
}
