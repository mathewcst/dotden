/**
 * pm-detect — installed-password-manager detection (issue 2-05).
 *
 * Step 2 of the secret flow offers a manager only when its CLI is actually present on THIS
 * environment (acceptance criteria 2–4): dotden bundles chezmoi but NOT the password manager
 * (scope-v1 "Secrets"), so it must detect `op`/`bw`/`pass` and guide rather than assume. The
 * result is a per-environment list of {@link DetectedPasswordManager} — each catalog manager
 * (from {@link PASSWORD_MANAGERS}) annotated with whether its CLI resolves here.
 *
 * Detected-CLI presence is **environment-local, never synced** (acceptance criterion 10): it is a
 * property of *this* computer's installed tools, so it is computed live and never written into the
 * synced `.myenv/` (ADR 0024). This module performs no persistence — it just probes.
 *
 * The probe is **injectable** ({@link DetectPasswordManagersOptions.probe}) so the model is
 * unit-testable without depending on what is installed on the test box; production uses the real
 * PATH probe ({@link cliOnPath}), which runs `which`/`where` through the no-shell
 * {@link runCommand} primitive (no shell = no injection surface; a non-zero exit = not found).
 */
import { runCommand } from './process.js'
import {
  PASSWORD_MANAGERS,
  type PasswordManagerId,
  type PasswordManagerInfo,
} from './secret-reference.js'

/**
 * One catalog manager annotated with this environment's detection result — exactly what the
 * picker renders: the static {@link PasswordManagerInfo} fields plus `available`. An unavailable
 * manager keeps its `installHint` so the disabled option can explain why it can't be picked.
 */
export interface DetectedPasswordManager extends PasswordManagerInfo {
  /** True iff this manager's CLI resolved on this environment's PATH (the option is selectable). */
  readonly available: boolean
}

/** Options for {@link detectPasswordManagers} — the injectable probe seam (tests fake it). */
export interface DetectPasswordManagersOptions {
  /**
   * Probe whether a CLI binary name is resolvable on PATH. Defaults to {@link cliOnPath} (a real
   * `which`/`where` lookup). Injected in tests with a deterministic stub. A probe that throws is
   * treated as "not installed" (a flaky lookup must never crash the picker).
   */
  readonly probe?: (cli: string) => Promise<boolean>
}

/**
 * Probe whether `cli` is resolvable on the current PATH — the production detection primitive.
 *
 * Uses the platform's own resolver (`where` on Windows, `which` on POSIX) through the no-shell
 * {@link runCommand}: a zero exit means the binary was found, a non-zero exit (or a spawn error)
 * means it was not. We do NOT execute the manager itself — detection must not unlock a vault or
 * trigger a credential prompt; it only asks "is the CLI installed?".
 *
 * @param cli The binary name to look up (`op` / `bw` / `pass`).
 * @returns True when the binary resolves on PATH, false otherwise. Never throws.
 */
export async function cliOnPath(cli: string): Promise<boolean> {
  const finder = process.platform === 'win32' ? 'where' : 'which'
  try {
    // A short timeout guards against a wedged resolver; a found binary returns instantly.
    const result = await runCommand(finder, [cli], { timeoutMs: 5_000 })
    return result.stdout.trim().length > 0
  } catch {
    // Non-zero exit (not found) or spawn error ⇒ treat as not installed.
    return false
  }
}

/**
 * Detect which v1 password managers are installed on THIS environment (issue 2-05).
 *
 * Probes each catalog manager's CLI and returns the full catalog annotated with `available`, in
 * display order (1Password first). EVERY manager is returned — an absent one is `available: false`
 * with its install hint intact (acceptance criterion 4), never dropped — so the picker can show
 * the disabled option with its "why" rather than silently hiding it.
 *
 * 1Password is offered as a ready (default-selected) option automatically when `op` is detected
 * (acceptance criterion 3): it is first in the catalog, so the picker selects the first available
 * option, which is `op` whenever it is present.
 *
 * @param options Optional injected probe (tests); defaults to the real PATH lookup.
 * @returns The annotated catalog in display order.
 */
export async function detectPasswordManagers(
  options: DetectPasswordManagersOptions = {},
): Promise<readonly DetectedPasswordManager[]> {
  const probe = options.probe ?? cliOnPath
  // Probe all managers concurrently — independent PATH lookups, no ordering dependency.
  return Promise.all(
    PASSWORD_MANAGERS.map(async (manager) => {
      // Assigned in both the try and catch below, so no initializer is needed (and an
      // initial `false` would be a dead store — ESLint 10's no-useless-assignment).
      let available: boolean
      try {
        available = await probe(manager.cli)
      } catch {
        // A throwing probe = treat as not installed (flaky lookup never crashes the picker).
        available = false
      }
      return { ...manager, available }
    }),
  )
}

/** Re-export the id type so consumers can `import { type PasswordManagerId } from './pm-detect.js'`. */
export type { PasswordManagerId }
