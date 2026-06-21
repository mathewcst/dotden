import type { ConnectResult } from '@shared/remote'

/**
 * The connect-URL preflight states, mirroring onboarding.md `ConnectURL` variants plus the refusal
 * case for reachable-but-incompatible repos.
 */
export type ConnectState = 'idle' | 'checking' | 'reachable' | 'credential-error' | 'refused'

/** A state is busy only while dotden owns an in-flight git/chezmoi operation. */
export function isConnectBusy(state: ConnectState): boolean {
  return state === 'checking' || state === 'reachable'
}

/**
 * Decide whether a successful `remote.connect` result may advance onboarding or must return the
 * URL step to a recoverable refused state.
 */
export function stateAfterConnectResult(result: ConnectResult): ConnectState {
  return result.repositoryKind === 'foreign-chezmoi' ? 'refused' : 'reachable'
}
