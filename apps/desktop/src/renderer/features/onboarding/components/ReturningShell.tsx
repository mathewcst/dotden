import { useState } from 'react'
import { Loader2 } from 'lucide-react'
import { OBConnectUrl } from './OBConnectUrl'
import { WindowTitleBar } from '@/components/den/window-controls'
import { ReturningMenu } from './ReturningMenu'
import { OBFoundDen, type FoundDenChoice } from './OBFoundDen'
import { OBPickWorkspaces } from './OBPickWorkspaces'
import { nextReturningStep, type ReturningStep } from '../lib/returningSteps'

/**
 * ReturningShell — the window chrome + step router for the second-environment flow
 * (design: returning-environment.md; issue 1-13).
 *
 * The returning journey, faithful to chezmoi end to end: **Connect** (reuses onboarding's
 * `OBConnectUrl` — paste the SAME Remote URL + preflight + `chezmoi init` clone, ADR 0020) →
 * **Find your Den** (the new/returning identity claim) → **Choose Workspaces** (the subscription
 * pick, default all) → register/claim + set subscription, then hand off to **Review & Apply**.
 *
 * The shell owns only the cross-step data (the identity choice + the chosen Workspaces). On the
 * final "Review & Apply" it performs the load-bearing main-process step — `env.claim(id, ws)` for
 * a returning environment or `env.registerNew(ws)` for a new one — which writes this env's
 * subscription into the synced registry BEFORE any Apply (the registry-entry guard's ordering
 * layer, issue 1-13). Then {@link onComplete} routes into the app's Review & Apply surface, where
 * the user reviews the incoming Den and Applies it deliberately (never auto-applied). A File that
 * already exists locally routes through the built Conflict flow (issue 1-11) there.
 *
 * @param onComplete Called once this env is registered/claimed with its subscription, so the App
 *   router opens the app on the second-environment (Review & Apply) surface.
 */
export function ReturningShell({
  onComplete,
  onNewDen,
}: {
  onComplete: () => void
  onNewDen: () => void
}) {
  const [step, setStep] = useState<ReturningStep>('connect')
  // The new/returning identity choice from FoundDen (null until that step is done).
  const [identity, setIdentity] = useState<FoundDenChoice | null>(null)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const advance = () => setStep((current) => nextReturningStep(current))

  // Final step: register (new) or claim (returning) THIS environment with the chosen Workspace
  // subscription — written BEFORE any Apply (the ordering guard) — then hand off to the app's
  // Review & Apply surface. A failure must not strand the user mid-flow: surface it and stay put.
  async function finish(workspaceIds: readonly string[]) {
    setBusy(true)
    setError(null)
    try {
      if (identity?.mode === 'returning' && identity.claimEnvId) {
        // Returning: adopt the chosen entry's id (keeps history/attribution) + its subscription.
        await window.dotden.environment.claim(identity.claimEnvId, workspaceIds)
      } else {
        // New environment: register a fresh identity with the chosen subscription.
        await window.dotden.environment.registerNew(workspaceIds)
      }
      onComplete()
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : 'Setting up this environment failed. Retry.',
      )
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="bg-background text-foreground grid h-screen grid-rows-[40px_1fr]">
      <WindowTitleBar windowsControlsClassName="-mr-3 h-10" />

      <div className="grid min-h-0 grid-cols-[auto_1fr]">
        <ReturningMenu current={step} />

        <main className="flex min-h-0 flex-col overflow-auto px-12 py-10">
          {/* Connect reuses the onboarding paste+preflight screen unchanged (V1-Lean, ADR 0020):
            first and second environment share the identical seam; the flows differ only AFTER
            clone by repo content. On a successful clone we advance to Find your Den. */}
          {step === 'connect' ? (
            <div className="flex flex-col gap-4">
              <OBConnectUrl
                onCancel={() => setError(null)}
                onConnected={(result) => {
                  setError(null)
                  if (result.repositoryKind === 'greenfield') {
                    onNewDen()
                    return
                  }
                  if (result.repositoryKind === 'foreign-chezmoi') {
                    setError(
                      'This repo already has a chezmoi setup. Full adoption is coming later; connect a dotden repo for now.',
                    )
                    return
                  }
                  advance()
                }}
              />
              {error ? (
                <p className="text-dd-red-400 text-xs" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
          ) : null}

          {step === 'found-den' ? (
            <OBFoundDen
              onChoose={(choice) => {
                setIdentity(choice)
                advance()
              }}
            />
          ) : null}

          {step === 'workspaces' ? (
            <div className="flex flex-col gap-4">
              <OBPickWorkspaces onContinue={(ids) => void finish(ids)} />
              {busy ? (
                <p className="text-muted-foreground flex items-center gap-2 text-sm" role="status">
                  <Loader2 className="size-4 animate-spin" /> Setting up this environment&hellip;
                </p>
              ) : null}
              {error ? (
                <p className="text-dd-red-400 text-xs" role="alert">
                  {error}
                </p>
              ) : null}
            </div>
          ) : null}
        </main>
      </div>
    </div>
  )
}
