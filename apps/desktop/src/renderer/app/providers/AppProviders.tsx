import type { ReactNode } from 'react'
import { TooltipProvider } from '@/components/ui/tooltip'

/**
 * AppProviders — the root plumbing context tree.
 *
 * This is the documented "providers exception" (ADR 0036): root providers are app *plumbing*,
 * not the branded rendered surface, so `app/providers/**` may mount a default shadcn primitive
 * straight from `components/ui/` — no `components/den/` wrapper required. (The boundaries gate of
 * ADR 0035 grants only `providers` and `den` the right to import `ui`; this is why the
 * `TooltipProvider` mount lives here and not inline in `App.tsx`, which may not touch `ui/`.)
 *
 * Today it mounts only the shadcn {@link TooltipProvider}. The sonner `<Toaster/>` joins it here
 * in Phase B when the custom toast is swapped for sonner; the den-session lifecycle stays its own
 * `key={role}`-remounting provider ({@link ../providers/DenSessionProvider}, mounted per route).
 */
export function AppProviders({ children }: { children: ReactNode }) {
  return <TooltipProvider delay={100}>{children}</TooltipProvider>
}
