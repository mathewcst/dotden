import { Check } from 'lucide-react'
import { cn } from '@/lib/utils'
import { RETURNING_RAIL_STEPS, RETURNING_STEP_ORDER, type ReturningStep } from '../lib/returningSteps'

/**
 * ReturningMenu — the fixed left rail of the second-environment flow (design:
 * returning-environment.md, Figma `ReturningMenu`).
 *
 * Mirrors `OnboardingMenu`'s done/current/upcoming recipe (the design reuses the onboarding
 * shell unchanged): **done** = ember dot + check, **current** = ember dot + number,
 * **upcoming** = outlined number. The 4th item — **Review & Apply** — is the handoff to the
 * app, which has no wizard shell, so it stays `upcoming` in every variant per the spec.
 *
 * Colors bind dd/* semantic tokens (ADR 0017) — never literal hex.
 */
export function ReturningMenu({ current }: { current: ReturningStep }) {
  const currentIndex = RETURNING_STEP_ORDER.indexOf(current)
  return (
    <nav className="bg-sidebar border-border flex w-[360px] shrink-0 flex-col border-r px-6 py-7">
      {/* Wordmark — lowercase brand (brand-and-vocabulary.md). */}
      <div className="text-foreground mb-8 flex items-center gap-2 text-lg font-semibold tracking-tight">
        <span className="bg-dd-ember-500 text-dd-ink-990 grid size-7 place-items-center rounded-md text-sm font-bold">
          d
        </span>
        dotden
      </div>

      <p className="text-muted-foreground mb-4 text-xs">Welcome back — set up this environment</p>

      <ol className="flex flex-1 flex-col gap-1">
        {RETURNING_RAIL_STEPS.map(({ step, label }, index) => {
          const stepIndex = RETURNING_STEP_ORDER.indexOf(step)
          // Review & Apply (the app handoff) NEVER reads done/current in the rail — it stays
          // upcoming in every variant (the design spec), because it has no wizard shell.
          const isHandoff = step === 'review'
          const isDone = !isHandoff && stepIndex < currentIndex
          const isCurrent = !isHandoff && step === current
          return (
            <li
              key={step}
              className={cn(
                'flex items-center gap-3 rounded-md px-2 py-2 text-sm',
                isCurrent ? 'text-foreground font-medium' : 'text-muted-foreground',
              )}
            >
              <span
                className={cn(
                  'grid size-6 shrink-0 place-items-center rounded-full text-xs font-semibold',
                  (isDone || isCurrent) && 'bg-dd-ember-500 text-dd-ink-990',
                  !isDone && !isCurrent && 'border-border text-muted-foreground border',
                )}
                aria-hidden
              >
                {isDone ? <Check className="size-3.5" /> : index + 1}
              </span>
              {label}
            </li>
          )
        })}
      </ol>

      <p className="text-muted-foreground mt-6 text-xs leading-relaxed">
        Your setup, in a space that feels like home on any computer.
      </p>
    </nav>
  )
}
