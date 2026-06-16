import { cn } from '@/lib/utils'
import type { Os, Scope } from '../../main/foundation/os-scope'

/**
 * The three desktop OSes dotden v1 scopes between, with their user-facing labels (issue
 * 1-15). The model supports the full `process.platform` union, but the editor offers the
 * desktop three — the v1 surface (CONTEXT.md "Scope": platform = the OS value itself).
 */
const SCOPE_OSES: readonly { os: Os; label: string }[] = [
  { os: 'darwin', label: 'macOS' },
  { os: 'linux', label: 'Linux' },
  { os: 'win32', label: 'Windows' },
]

/**
 * ScopeEditor — the inspector surface for a File's **OS Scope** (issue 1-15).
 *
 * Scope is "the set of OSes where a File or Folder applies" (CONTEXT.md "Scope"). This
 * editor shows the File's EFFECTIVE Scope as toggleable OS chips and writes the user's pick
 * back through `den.setFileScope`. Two faithful-wrapper truths are surfaced honestly (never
 * fail silently):
 *
 * - **Universal (everywhere).** `scope === null` means the File applies on every OS — the
 *   default. Toggling every OS on is the universal Scope; the copy says so.
 * - **Narrowable, never broadenable.** The main process CLAMPS the request to the File's
 *   inherited Folder/Workspace Scope, so a chip the parent does not allow simply does not
 *   stick. The editor reflects the EFFECTIVE Scope the service returns, so the user sees the
 *   clamp rather than a silently-ignored request.
 *
 * The component is presentational: it renders from `scope` and reports the requested new
 * Scope through `onChange`; the caller performs the IPC write + re-reads the effective Scope.
 */
export function ScopeEditor({
  scope,
  disabled,
  onChange,
}: {
  /** The File's current EFFECTIVE Scope (`null` = universal, applies everywhere). */
  scope: Scope
  /** Whether the editor is disabled (an Operation is in flight). */
  disabled: boolean
  /**
   * Requested new Scope. `null` when every OS is selected (universal); otherwise the
   * selected OS subset. The caller writes it via `den.setFileScope` and may receive a
   * NARROWER effective Scope back if the request tried to broaden past the Folder.
   */
  onChange: (scope: Scope) => void
}) {
  // The currently-applied OS set, derived from the effective Scope. Universal (null) ⇒ every
  // OS is "on" (it applies everywhere); a concrete Scope ⇒ exactly its OSes are on.
  const isOn = (os: Os): boolean => scope === null || scope.includes(os)

  // Toggle one OS, then normalize: all-on collapses to the universal Scope (null), and an
  // empty selection stays the empty Scope ("applies nowhere") — a real, representable state.
  const toggle = (os: Os): void => {
    const current = new Set<Os>(scope === null ? SCOPE_OSES.map((o) => o.os) : scope)
    if (current.has(os)) current.delete(os)
    else current.add(os)
    const next = SCOPE_OSES.map((o) => o.os).filter((o) => current.has(o))
    // Every OS selected ⇒ universal Scope (null), the canonical "applies everywhere".
    onChange(next.length === SCOPE_OSES.length ? null : next)
  }

  return (
    <section className="border-border bg-card rounded-md border p-3">
      <h2 className="text-muted-foreground mb-2 text-xs font-semibold tracking-wide">OS SCOPE</h2>
      <div className="flex flex-wrap gap-1.5">
        {SCOPE_OSES.map(({ os, label }) => {
          const on = isOn(os)
          return (
            <button
              key={os}
              type="button"
              disabled={disabled}
              aria-pressed={on}
              onClick={() => toggle(os)}
              className={cn(
                'rounded-full border px-2 py-0.5 text-xs transition-colors',
                on
                  ? 'border-dd-ember-700 bg-dd-ember-950 text-dd-ember-400'
                  : 'border-border text-muted-foreground hover:text-foreground',
                disabled && 'cursor-not-allowed opacity-50',
              )}
            >
              {label}
            </button>
          )
        })}
      </div>
      <p className="text-muted-foreground mt-2 text-xs">
        {scope === null ? (
          'Applies on every OS. Toggle one off to scope this File to specific systems.'
        ) : scope.length === 0 ? (
          'Scoped to no OS — this File applies nowhere. Toggle an OS on to apply it.'
        ) : (
          <>
            Applies only on{' '}
            <span className="text-foreground">
              {scope.map((os) => SCOPE_OSES.find((o) => o.os === os)?.label ?? os).join(', ')}
            </span>
            . A child can narrow within its Folder but never broaden past it.
          </>
        )}
      </p>
    </section>
  )
}
