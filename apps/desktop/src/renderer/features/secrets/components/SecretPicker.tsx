import { AlertDialog } from '@base-ui/react/alert-dialog'
import { Lock } from 'lucide-react'
import { useMemo, useState } from 'react'
import type { DetectedPasswordManager, PasswordManagerId } from '@shared/secrets'
import type { ConvertSecretRequest } from '@shared/den'
import type { PmPreference } from '@shared/secrets'
import { Button } from '@/components/den/button'
import { canConvert, defaultManagerSelection } from '@/features/secrets/lib/pm-picker'

/** Props for {@link SecretPicker}. */
export interface SecretPickerProps {
  /** Whether the picker is shown (controlled — the caller owns open state). */
  readonly open: boolean
  /** Called when the picker requests to close (scrim click, Esc, Back). */
  readonly onOpenChange: (open: boolean) => void
  /** The detected password managers (catalog annotated with availability) for THIS environment. */
  readonly managers: readonly DetectedPasswordManager[]
  /** The remembered "Remember my choice" preference, or null — pre-selects the manager + account. */
  readonly preference: PmPreference | null
  /** The destination-relative File path being converted (e.g. `.aws/credentials`). Shown for context. */
  readonly targetPath: string
  /** Go back to step 1 (the warn step) without converting. */
  readonly onBack: () => void
  /**
   * Convert: write the chezmoi `.tmpl` Secret reference + (optionally) remember the manager. The
   * request carries the manager choice + vault reference (+ account/field/remember) — NEVER the raw
   * secret. The caller forwards it to `window.dotden.den.convertSecret`.
   */
  readonly onConvert: (request: ConvertSecretRequest) => void
  /** Disable the Convert action while the conversion it triggers is in flight. */
  readonly convertDisabled?: boolean
}

/**
 * SecretPicker — Step 2 of the secret flow: the **password-manager picker** that turns a flagged
 * value into a chezmoi Secret reference (issue 2-05, secret-and-errors screen spec).
 *
 * Only the password-manager chooser (step 1 already decided *to* convert). An ember `lock` badge +
 * "Choose your password manager", then one row per v1 manager (1Password / Bitwarden / pass) — each
 * a radio with a trailing status Pill: **green "CLI detected"** when the manager's CLI is present
 * (the row is selectable) or **neutral "Not found"** + the install hint when it is absent (the row
 * is disabled, explaining *why* it can't be picked — never fail silently). 1Password is the default
 * selection whenever `op` is detected, and a remembered choice wins when its CLI is still installed
 * ({@link defaultManagerSelection}). A reference input collects where the secret lives in the vault
 * (`op://vault/item/field`, a Bitwarden item, a pass entry). A **"Remember my choice for the
 * future"** checkbox stores the preferred manager environment-locally (never synced). Footer: Back
 * (Ghost) → step 1; **Convert to Secret reference** (Primary, `lock` lead) → the actual conversion.
 *
 * The synced result is a reference like `op://vault/item/field`; the real secret stays in the vault
 * and only the reference enters the Remote (a **Secret reference**, CONTEXT.md). Rendered over the
 * scrim-dimmed home like {@link import('./SecretWarning.js').SecretWarning} (the modal-over-app
 * precedent). The selection/enablement decisions are the pure {@link import('./pm-picker.js')}
 * helpers, unit-tested without a renderer.
 */
export function SecretPicker({
  open,
  onOpenChange,
  managers,
  preference,
  targetPath,
  onBack,
  onConvert,
  convertDisabled = false,
}: SecretPickerProps) {
  // Pre-select per the pure rule (remembered choice if still installed, else first available, else
  // none). The parent re-mounts this modal per convert session via a `key`, so this initializer
  // runs fresh each time and no prior selection bleeds in (no reset effect — react-patterns).
  const [selected, setSelected] = useState<PasswordManagerId | null>(() =>
    defaultManagerSelection(managers, preference),
  )
  // The vault reference the user types (op://… / item name / entry path).
  const [reference, setReference] = useState('')
  // (1Password) the optional non-default account — adds `--account` to the template when set.
  const [account, setAccount] = useState(() => preference?.account ?? '')
  // The "Remember my choice for the future" toggle (environment-local).
  const [remember, setRemember] = useState(false)

  // The selected manager's catalog info (for the reference placeholder + 1Password account field).
  const selectedManager = useMemo(
    () => managers.find((m) => m.id === selected) ?? null,
    [managers, selected],
  )

  // Convert is enabled only with a selectable manager + a non-empty reference (pure rule).
  const convertReady = canConvert(managers, selected, reference)

  const handleConvert = () => {
    if (!selected || !convertReady) return
    onConvert({
      targetPath,
      manager: selected,
      reference: reference.trim(),
      // Only forward the account for 1Password (the other managers ignore it).
      account: selected === 'op' && account.trim().length > 0 ? account.trim() : undefined,
      remember,
    })
    onOpenChange(false)
  }

  return (
    <AlertDialog.Root open={open} onOpenChange={onOpenChange}>
      <AlertDialog.Portal>
        {/* Scrim — the dark app stays dimly visible behind the modal (modal-over-app pattern). */}
        <AlertDialog.Backdrop className="bg-dd-black/40 fixed inset-0 z-50" />
        <AlertDialog.Popup className="bg-card text-card-foreground border-border fixed top-1/2 left-1/2 z-50 w-[35rem] max-w-[calc(100vw-2rem)] -translate-x-1/2 -translate-y-1/2 rounded-xl border p-5 shadow-lg">
          {/* Ember lock badge — converting is a safe, recommended action (ember, not amber/red). */}
          <div
            className="bg-dd-ember-950 text-dd-ember-400 mb-3 inline-flex size-9 items-center justify-center rounded-full"
            aria-hidden
          >
            <Lock className="size-5" />
          </div>
          <AlertDialog.Title className="text-base font-semibold">
            Choose your password manager
          </AlertDialog.Title>
          <AlertDialog.Description className="text-muted-foreground mt-2 text-sm leading-relaxed">
            The value in <span className="text-foreground font-mono text-xs">{targetPath}</span>{' '}
            will be replaced with a reference to your vault. The real secret stays in your password
            manager and only the reference syncs.
          </AlertDialog.Description>

          {/* One SelectRow per manager: radio + trailing status Pill. A detected CLI is selectable;
              an absent CLI is disabled with its install hint (acceptance criteria 2–4). */}
          <fieldset className="mt-4 grid gap-2">
            {managers.map((manager) => {
              const isSelected = selected === manager.id
              return (
                <label
                  key={manager.id}
                  className={`flex items-start gap-3 rounded-md border p-3 text-sm ${
                    manager.available
                      ? `cursor-pointer ${isSelected ? 'border-dd-ember-500 bg-dd-ember-950/40' : 'border-border bg-card'}`
                      : 'border-border bg-muted/40 cursor-not-allowed opacity-60'
                  }`}
                >
                  <input
                    type="radio"
                    name="pm-choice"
                    className="accent-dd-ember-500 mt-0.5 size-4"
                    checked={isSelected}
                    disabled={!manager.available}
                    onChange={() => setSelected(manager.id)}
                  />
                  <span className="flex-1">
                    <span className="flex items-center justify-between gap-2">
                      <span className="text-foreground font-medium">{manager.label}</span>
                      {/* Status Pill: green "CLI detected" / neutral "Not found". */}
                      {manager.available ? (
                        <span className="bg-dd-green-950 text-dd-green-400 shrink-0 rounded-full px-2 py-0.5 text-[0.625rem] font-semibold tracking-wide uppercase">
                          CLI detected
                        </span>
                      ) : (
                        <span className="bg-muted text-muted-foreground shrink-0 rounded-full px-2 py-0.5 text-[0.625rem] font-semibold tracking-wide uppercase">
                          Not found
                        </span>
                      )}
                    </span>
                    {/* An absent CLI explains WHY it can't be picked (never fail silently). */}
                    {!manager.available ? (
                      <span className="text-muted-foreground mt-1 block text-xs">
                        {manager.installHint}
                      </span>
                    ) : null}
                  </span>
                </label>
              )
            })}
          </fieldset>

          {/* The vault reference — where the secret lives. Shape hint comes from the selected
              manager's catalog example (op://vault/item/field, an item name, an entry path). */}
          <div className="mt-4 grid gap-1.5">
            <label htmlFor="secret-reference" className="text-foreground text-xs font-medium">
              Reference
            </label>
            <input
              id="secret-reference"
              type="text"
              className="border-border bg-card text-foreground focus:border-dd-ember-500 w-full rounded-md border px-3 py-2 font-mono text-xs outline-none"
              placeholder={selectedManager?.referenceExample ?? 'op://vault/item/field'}
              value={reference}
              onChange={(event) => setReference(event.target.value)}
            />
            {/* 1Password: an optional non-default account (adds --account to the template). */}
            {selected === 'op' ? (
              <input
                type="text"
                className="border-border bg-card text-foreground focus:border-dd-ember-500 mt-1 w-full rounded-md border px-3 py-2 font-mono text-xs outline-none"
                placeholder="account (optional, e.g. my.1password.com)"
                value={account}
                onChange={(event) => setAccount(event.target.value)}
              />
            ) : null}
          </div>

          {/* "Remember my choice for the future" — environment-local, never synced. */}
          <label className="mt-4 flex cursor-pointer items-start gap-2">
            <input
              type="checkbox"
              className="accent-dd-ember-500 mt-0.5 size-3.5"
              checked={remember}
              onChange={() => setRemember((value) => !value)}
            />
            <span className="text-muted-foreground text-xs">
              Remember my choice for the future. Sends future conversions straight to this manager
              on this computer (this choice stays on this computer; it is never synced).
            </span>
          </label>

          {/* Footer — Back (Ghost) → step 1 / Convert to Secret reference (Primary, lock lead). */}
          <div className="mt-5 flex justify-end gap-2">
            {/* "Back" is the spec's Ghost slot; the local Button has no ghost variant, so use the
                quietest available (outline) — same treatment as the warn step's Cancel. */}
            <Button variant="outline" size="sm" onClick={onBack}>
              Back
            </Button>
            <Button
              variant="default"
              size="sm"
              disabled={convertDisabled || !convertReady}
              onClick={handleConvert}
            >
              <Lock className="size-4" />
              Convert to Secret reference
            </Button>
          </div>
        </AlertDialog.Popup>
      </AlertDialog.Portal>
    </AlertDialog.Root>
  )
}
