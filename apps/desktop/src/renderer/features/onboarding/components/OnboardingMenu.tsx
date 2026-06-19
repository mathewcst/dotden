import { Check } from 'lucide-react'
import { cn } from '@/shared/lib/utils'
import { RAIL_STEPS, STEP_ORDER, type OnboardingStep } from '../lib/steps'

/**
 * OnboardingMenu — the fixed left rail of the onboarding flow (design: onboarding.md,
 * Figma `OnboardingMenu`).
 *
 * Holds the wordmark, the six-item step rail, and the footer tagline. Each rail item
 * bakes its state from the `current` step (design spec): **done** = ember dot + check,
 * **current** = ember dot + number, **upcoming** = outlined number. When the flow
 * reaches `done`, every rail item reads as complete.
 *
 * Colors bind dd/* semantic tokens (ADR 0017) — `dd-ember-500` for the active accent,
 * the sidebar surface for the rail itself — never literal hex.
 */
export function OnboardingMenu({ current }: { current: OnboardingStep }) {
  const currentIndex = STEP_ORDER.indexOf(current)
  return (
    <nav className="bg-sidebar border-border flex w-[360px] shrink-0 flex-col border-r px-6 py-7">
      {/* Wordmark — the den is home; lowercase brand (brand-and-vocabulary.md). */}
      <div className="text-foreground mb-8 flex items-center gap-2 text-lg font-semibold tracking-tight">
        <span className="bg-dd-ember-500 text-dd-ink-990 grid size-7 place-items-center rounded-md text-sm font-bold">
          d
        </span>
        dotden
      </div>

      <ol className="flex flex-1 flex-col gap-1">
        {RAIL_STEPS.map(({ step, label }, index) => {
          // A step is "done" once the flow has moved past it (or reached the terminal
          // Done screen, which marks the whole rail complete).
          const stepIndex = STEP_ORDER.indexOf(step)
          const isDone = current === 'done' || stepIndex < currentIndex
          const isCurrent = current !== 'done' && step === current
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
                  isDone && 'bg-dd-ember-500 text-dd-ink-990',
                  isCurrent && 'bg-dd-ember-500 text-dd-ink-990',
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
