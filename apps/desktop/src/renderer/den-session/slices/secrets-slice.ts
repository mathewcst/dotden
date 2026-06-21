/**
 * The `secrets` slice — the commit-time secret warn + convert flow (issues 2-03/2-05), in the
 * scoped `den-session` store (ADR 0027, Phase 2).
 *
 * It owns the two-step modal state: the amber warn step (the scan findings + the exact paths the
 * user was Committing, so "Commit anyway" can proceed with them) and the password-manager picker
 * (the detected managers + remembered preference + the File being converted). The decisions —
 * which manager is selectable, when Convert is allowed — already live as pure functions in
 * `pm-picker.ts`; this slice owns the FLOW (open the picker, convert + Commit) so the
 * password-manager transitions are testable without rendering the picker.
 *
 * The commit slice opens the warn step (`commitWithScan` → `setSecretWarn`); converting reflects
 * its Commit through the commit slice's `setCommitOutcome` and refreshes the tree/incoming — all
 * via `get()`. The IPC surface is injected for node-testability.
 */
import type { DotdenApi } from '@shared/ipc-api'
import type { SecretFinding } from '@shared/secrets'
import type { ConvertSecretRequest } from '@shared/den'
import type { DetectedPasswordManager } from '@shared/secrets'
import type { PmPreference } from '@shared/secrets'
import type { DenSessionGet, DenSessionSet } from '../store'

/** The pending commit-time secret warn step: the findings to caution about + the paths Committed. */
export interface SecretWarnState {
  readonly findings: readonly SecretFinding[]
  readonly paths: readonly string[]
}

/** The pending step-2 password-manager picker: detected managers + preference + the File converting. */
export interface SecretPickerState {
  readonly managers: readonly DetectedPasswordManager[]
  readonly preference: PmPreference | null
  readonly targetPath: string
}

/** The `secrets` slice's state + actions (combined into {@link DenSession}). */
export interface SecretsSlice {
  /** The open warn step, or null. The scan runs BEFORE the Commit; findings open this step. */
  secretWarn: SecretWarnState | null
  /** The open password-manager picker (step 2), or null. Opened from the warn step's Convert. */
  secretPicker: SecretPickerState | null

  /** Open/close the warn step (the commit slice opens it; the dialog layer closes it). */
  setSecretWarn(state: SecretWarnState | null): void
  /** Open/close the picker (the dialog layer / Back closes it). */
  setSecretPicker(state: SecretPickerState | null): void
  /** Open step 2 for a flagged File: detect managers + read the remembered preference. */
  openConvertPicker(findings: readonly SecretFinding[]): void
  /** Convert the flagged value into a chezmoi `.tmpl` Secret reference + Commit it (issue 2-05). */
  convertSecret(request: ConvertSecretRequest): void
}

/** Build the `secrets` slice, closing over the injected {@link DotdenApi}. */
export function createSecretsSlice(api: DotdenApi) {
  return (set: DenSessionSet, get: DenSessionGet): SecretsSlice => ({
    secretWarn: null,
    secretPicker: null,

    setSecretWarn: (secretWarn) => set({ secretWarn }),
    setSecretPicker: (secretPicker) => set({ secretPicker }),

    // Open step 2 (the password-manager picker) for a flagged File. Detect the installed managers
    // + read this environment's remembered preference (both env-local), then surface the picker.
    // Convert is per-File: we target the FIRST flagged File (the common single-secret case).
    // Detection is read-only feature-detection.
    openConvertPicker: (findings) =>
      void get().run('convert', async () => {
        const targetPath = findings[0]?.file
        if (!targetPath) return
        const [managers, preference] = await Promise.all([
          api.den.detectPasswordManagers(),
          api.den.pmPreference(),
        ])
        set({ secretPicker: { managers, preference, targetPath } })
      }),

    // Convert the flagged value into a chezmoi `.tmpl` Secret reference (issue 2-05): write the
    // reference/template call into source state + Commit it — ONLY the reference enters the Den,
    // the raw secret stays in the vault and chezmoi re-fetches it at Apply time. Refreshes the
    // tree so the now-converted File reflects its committed state.
    convertSecret: (request) =>
      void get().run('convert', async () => {
        const result = await api.den.convertSecret(request)
        get().setCommitOutcome({
          message: result.commit.message,
          pushed: result.commit.pushed,
          queued: result.commit.queued,
        })
        await get().reloadTree()
        if (result.commit.pushed) await get().refreshIncoming()
      }),
  })
}
