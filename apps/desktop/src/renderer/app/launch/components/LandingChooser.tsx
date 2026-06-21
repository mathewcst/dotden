import { Button } from '@/components/den/button'
import { WindowTitleBar } from '@/components/den/window-controls'
import { ArrowRight, MonitorSmartphone, Sparkles } from 'lucide-react'

/**
 * LandingChooser — the first-launch fork between setting up a NEW Den and CONNECTING an
 * existing one (issue 1-13).
 *
 * Both paths share the identical paste+preflight Connect seam after this point (ADR 0020);
 * this chooser only routes the user to the right wizard copy — first-run Discover for a new
 * Den, or the returning new-or-returning + subscription flow for an existing one.
 */
export function LandingChooser({ onNew, onConnect }: { onNew: () => void; onConnect: () => void }) {
  return (
    <div className="bg-background text-foreground grid h-screen grid-rows-[40px_1fr]">
      <WindowTitleBar windowsControlsClassName="-mr-3 h-10" />
      <div className="grid min-h-0 place-items-center px-6">
        <div className="flex w-full max-w-lg flex-col gap-8">
          <header className="space-y-3 text-center">
            <div className="text-foreground mx-auto flex w-fit items-center gap-2 text-xl font-semibold tracking-tight">
              <span className="bg-dd-ember-500 text-dd-ink-990 grid size-8 place-items-center rounded-md text-base font-bold">
                d
              </span>
              dotden
            </div>
            <p className="text-muted-foreground text-sm leading-relaxed">
              Manage your Den — your whole configuration — and keep it in sync across every computer
              you work on, through a private git repo you own.
            </p>
          </header>

          <div className="grid gap-3">
            {/* New Den — the first-environment onboarding (issue 1-06). */}
            <button
              type="button"
              className="border-border bg-card hover:border-dd-ember-500 flex items-start gap-3 rounded-lg border p-4 text-left transition-colors"
              onClick={onNew}
            >
              <Sparkles className="text-dd-ember-400 mt-0.5 size-5 shrink-0" />
              <span className="flex-1">
                <span className="text-foreground block font-medium">Set up a new Den</span>
                <span className="text-muted-foreground block text-xs">
                  This is your first computer. Create a repo, Track your configs, and Sync them.
                </span>
              </span>
              <ArrowRight className="text-muted-foreground mt-1 size-4" />
            </button>

            {/* Existing Den — the second-environment returning flow (issue 1-13). */}
            <button
              type="button"
              className="border-border bg-card hover:border-dd-ember-500 flex items-start gap-3 rounded-lg border p-4 text-left transition-colors"
              onClick={onConnect}
            >
              <MonitorSmartphone className="text-dd-ember-400 mt-0.5 size-5 shrink-0" />
              <span className="flex-1">
                <span className="text-foreground block font-medium">Connect an existing Den</span>
                <span className="text-muted-foreground block text-xs">
                  You already set up dotden elsewhere. Connect the same repo, pick your Workspaces,
                  and Apply your Den here.
                </span>
              </span>
              <ArrowRight className="text-muted-foreground mt-1 size-4" />
            </button>
          </div>

          <Button variant="outline" className="mx-auto" onClick={onNew}>
            Not sure? Start a new Den <ArrowRight className="size-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}
