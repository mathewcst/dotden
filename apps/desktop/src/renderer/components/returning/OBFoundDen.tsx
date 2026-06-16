import { useEffect, useState } from 'react'
import { GitBranch, Loader2, MonitorSmartphone } from 'lucide-react'
import { Button } from '@/components/ui/button'
import type { ClaimSuggestion } from '../../../main/foundation/environment-registry'

/**
 * The new-or-returning *identity* choice surfaced after the Den is detected (issue 1-13).
 *
 * - `new` — this is a brand-NEW environment; mint a fresh identity.
 * - `returning` — this is a returning environment (a reinstall); CLAIM an existing registry
 *   entry's id so its history/attribution stay continuous (ADR 0024). dotden suggests the
 *   likely match by OS + setup hostname but NEVER auto-merges — the user picks explicitly.
 */
type IdentityChoice = 'new' | 'returning'

/** What {@link OBFoundDen} hands up once the user makes their identity choice. */
export interface FoundDenChoice {
  /** Whether this environment is new or returning. */
  readonly mode: IdentityChoice
  /** When `returning`, the registry entry id the user chose to claim; else `null`. */
  readonly claimEnvId: string | null
}

/**
 * OBFoundDen — returning-flow step 2 (design: returning-environment.md `OBContent/FoundDen`).
 *
 * After Connect clones the Den, this confirms the detected repo and asks the **new-vs-returning
 * identity** question. Returning users pick which existing environment they are (from
 * `env.suggestClaims()`, ranked by OS + setup hostname); new users name this environment. The
 * choice is handed up via {@link onChoose}; the shell carries it to Choose Workspaces.
 *
 * It reuses the 1-05 registry IPC (`window.dotden.environment.suggestClaims`), the SAME
 * detected-Den data the Environments surface reads. dotden never auto-claims — the suggestion
 * is just a default selection the user confirms (ADR 0024).
 *
 * @param onChoose Called with the identity choice once the user proceeds.
 */
export function OBFoundDen({ onChoose }: { onChoose: (choice: FoundDenChoice) => void }) {
  const [mode, setMode] = useState<IdentityChoice>('new')
  const [suggestions, setSuggestions] = useState<readonly ClaimSuggestion[]>([])
  const [claimEnvId, setClaimEnvId] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  // Read the likely returning-claim candidates (ranked by OS + setup hostname). An active
  // guard drops a late reply after unmount (the codebase convention; no setState-in-effect).
  useEffect(() => {
    let active = true
    async function load() {
      try {
        const found = await window.dotden.environment.suggestClaims()
        if (!active) return
        setSuggestions(found)
        // Pre-select the strongest match AND default to "returning" when a candidate exists —
        // a reinstall on a known machine is the common case, but the user can switch to "new".
        if (found.length > 0) {
          setMode('returning')
          setClaimEnvId(found[0]?.entry.id ?? null)
        }
      } catch (caught) {
        if (active) setError(caught instanceof Error ? caught.message : 'Could not read your Den.')
      } finally {
        if (active) setLoading(false)
      }
    }
    void load()
    return () => {
      active = false
    }
  }, [])

  function proceed() {
    onChoose({
      mode,
      // Only a "returning" choice carries a claim id; "new" mints a fresh identity.
      claimEnvId: mode === 'returning' ? claimEnvId : null,
    })
  }

  // A "returning" choice needs a selected entry to claim; "new" is always ready.
  const ready = mode === 'new' || claimEnvId !== null

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <header className="space-y-2">
        <h1 className="text-foreground text-2xl font-semibold tracking-tight">Find your Den</h1>
        <p className="text-muted-foreground text-sm leading-relaxed">
          We connected your repo and found an existing Den. Is this a new environment, or are you
          returning on one you set up before?
        </p>
      </header>

      <div className="border-border bg-card flex items-start gap-3 rounded-md border p-3 text-sm">
        <GitBranch className="text-dd-ember-400 mt-0.5 size-4 shrink-0" />
        <span className="text-muted-foreground">
          Your Den was cloned. Choosing{' '}
          <span className="text-foreground font-medium">returning</span> keeps that
          environment&rsquo;s history and attribution — nothing is merged automatically.
        </span>
      </div>

      {loading ? (
        <p className="text-muted-foreground flex items-center gap-2 text-sm" role="status">
          <Loader2 className="size-4 animate-spin" /> Reading your Den&hellip;
        </p>
      ) : (
        <fieldset className="grid gap-3">
          {/* New environment */}
          <label className="border-border bg-card flex cursor-pointer items-start gap-3 rounded-md border p-4 text-sm">
            <input
              type="radio"
              name="identity"
              className="accent-dd-ember-500 mt-0.5 size-4"
              checked={mode === 'new'}
              onChange={() => setMode('new')}
            />
            <span>
              <span className="text-foreground font-medium">This is a new environment</span>
              <span className="text-muted-foreground block text-xs">
                Set up a fresh identity for this computer. You can rename it any time.
              </span>
            </span>
          </label>

          {/* Returning — claim an existing entry. Only meaningful when candidates exist. */}
          <label className="border-border bg-card flex cursor-pointer items-start gap-3 rounded-md border p-4 text-sm">
            <input
              type="radio"
              name="identity"
              className="accent-dd-ember-500 mt-0.5 size-4"
              checked={mode === 'returning'}
              disabled={suggestions.length === 0}
              onChange={() => setMode('returning')}
            />
            <span className="flex-1">
              <span className="text-foreground font-medium">
                I&rsquo;m returning on an existing environment
              </span>
              {suggestions.length === 0 ? (
                <span className="text-muted-foreground block text-xs">
                  No matching environment to return to was found in your Den.
                </span>
              ) : (
                <span className="text-muted-foreground block text-xs">
                  Pick which environment this is — it keeps its id and history.
                </span>
              )}
              {mode === 'returning' && suggestions.length > 0 ? (
                <ul className="mt-3 grid gap-1.5">
                  {suggestions.map(({ entry, reasons }) => (
                    <li key={entry.id}>
                      <label className="flex cursor-pointer items-center gap-2">
                        <input
                          type="radio"
                          name="claim"
                          className="accent-dd-ember-500 size-3.5"
                          checked={claimEnvId === entry.id}
                          onChange={() => setClaimEnvId(entry.id)}
                        />
                        <MonitorSmartphone className="text-muted-foreground size-3.5" />
                        <span className="text-foreground">{entry.label}</span>
                        <span className="text-muted-foreground text-[11px]">
                          {reasons.includes('hostname-match') ? 'matches this machine' : 'same OS'}
                        </span>
                      </label>
                    </li>
                  ))}
                </ul>
              ) : null}
            </span>
          </label>
        </fieldset>
      )}

      {error ? (
        <p className="text-dd-red-400 text-xs" role="alert">
          {error}
        </p>
      ) : null}

      <div>
        <Button disabled={!ready || loading} onClick={proceed}>
          Choose Workspaces
        </Button>
      </div>
    </div>
  )
}
