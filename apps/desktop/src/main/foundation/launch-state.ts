/**
 * Launch routing gate — derives WHICH screen the app opens on (ADR 0026).
 *
 * On boot the renderer shows a `'booting'` splash and asks the main process one question:
 * is THIS environment already set up here? The answer is **derived** from the synced
 * registry + the local clone — never a stored `onboardingComplete` flag (ADR 0003/0024:
 * setup state is chezmoi/registry truth, not a dotden boolean that could drift out of sync).
 *
 * Three states, of which v1 routes only `ready` to the app — the others fall to the landing
 * chooser (see ADR 0026 for why `incomplete` is deliberately NOT auto-resumed: doing so would
 * let a would-be *returning* environment self-register as new, breaking continuous history):
 * - `ready`      — this environment has a registry entry (`EnvironmentRegistry.self()` would
 *                  be non-null) → route to the app;
 * - `incomplete` — the Den is cloned here but this environment is not registered yet → landing;
 * - `fresh`      — nothing cloned here → landing.
 *
 * It is **side-effect-free by construction** (the load-bearing ADR 0026 rule): it reads the
 * local id WITHOUT minting one ({@link readLocalIdentity}), probes the clone with a cheap
 * filesystem check, and reads the synced registry directly. It deliberately does NOT build the
 * lazy `DenService` or call `env:list` — both register/mint as a side effect and assume a
 * working clone that does not exist in the `fresh` state. The gate must neither depend on, nor
 * mutate, the very thing it is gating.
 *
 * Electron-free (ADR 0023): it takes plain directory paths, so it is fully unit-testable in
 * plain Node against tempdirs.
 */
import { access } from 'node:fs/promises'
import { join } from 'node:path'
import { readLocalIdentity } from './environment-identity.js'
import { MyenvStore } from './myenv-store.js'

/** The three launch states the gate distinguishes (ADR 0026). */
export type LaunchStatus = 'fresh' | 'incomplete' | 'ready'

/** The launch-gate result the renderer maps to an initial route. */
export interface LaunchState {
  /** Which setup state THIS environment is in (drives the boot route). */
  readonly status: LaunchStatus
}

/** Inputs the gate needs: the chezmoi source dir + the userData dir (the ADR 0024 split). */
export interface LaunchStateInputs {
  /** The chezmoi source-state dir = the local git clone of the Den (may not exist yet). */
  readonly sourceDir: string
  /** Electron `userData` (holds the environment-local identity); a tempdir in tests. */
  readonly userDataDir: string
}

/**
 * Does `sourceDir` hold a chezmoi-initialized Den, i.e. a git clone?
 *
 * A chezmoi-initialized source dir is a git repo, so the presence of its `.git` entry is the
 * faithful "this machine has cloned the Den" signal (ADR 0026). A cheap `access` probe — no
 * spawn, no chezmoi — keeps the gate fast and dependency-free; any error (missing dir / no
 * clone) is the honest `false`, never a throw.
 */
export async function sourceExists(sourceDir: string): Promise<boolean> {
  try {
    await access(join(sourceDir, '.git'))
    return true
  } catch {
    return false
  }
}

/**
 * Compute the launch gate (ADR 0026) from cheap, side-effect-free reads.
 *
 * `ready` requires BOTH a local id and that the synced registry already lists it — exactly the
 * check {@link EnvironmentRegistry.self} makes, but without building the id-bound registry
 * service (keeping the gate clone-resilient). Because the registry file only exists once
 * cloned, a `ready` result implies a clone; everything short of registered collapses to
 * `incomplete` (cloned) or `fresh` (not) — which v1 both route to the landing chooser.
 */
export async function computeLaunchState(inputs: LaunchStateInputs): Promise<LaunchState> {
  const [id, cloned] = await Promise.all([
    readLocalIdentity(inputs.userDataDir),
    sourceExists(inputs.sourceDir),
  ])
  if (id && cloned) {
    // Read the synced registry directly (degrades to an empty list when absent) and look this
    // environment up by its stable id — the same predicate as a non-null `self()` entry.
    const { environments } = await new MyenvStore(inputs.sourceDir).readEnvironments()
    if (environments.some((entry) => entry.id === id)) return { status: 'ready' }
  }
  return { status: cloned ? 'incomplete' : 'fresh' }
}
