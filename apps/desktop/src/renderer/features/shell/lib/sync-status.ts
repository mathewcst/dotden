import type { RemoteAxisMarker } from '@shared/den'
import type { Busy } from './session-slice'
import type { OperationError } from './operation-error'

export type SyncStatusKind = 'syncing' | 'up-to-date' | 'incoming' | 'push' | 'offline' | 'error'

export interface SyncStatus {
  readonly kind: SyncStatusKind
  readonly label: string
  readonly dotClassName: string
}

export interface SyncStatusInput {
  readonly role: 'a' | 'b'
  readonly remoteAxis: ReadonlyMap<string, RemoteAxisMarker>
  readonly pushQueued: boolean
  readonly busy: Busy | null
  readonly error: OperationError | null
  readonly online: boolean
}

export function syncStatus(input: SyncStatusInput): SyncStatus {
  if (input.role !== 'a') return upToDate()
  if (input.error) {
    return {
      kind: 'error',
      label: 'Sync error',
      dotClassName: 'bg-dd-red-500',
    }
  }
  if (input.busy === 'push') {
    return { kind: 'push', label: 'Pushing', dotClassName: 'bg-dd-blue-500 animate-pulse' }
  }
  if (input.busy === 'list' || input.busy === 'apply') {
    return { kind: 'syncing', label: 'Syncing', dotClassName: 'bg-dd-blue-500 animate-pulse' }
  }
  if (input.pushQueued) {
    return {
      kind: 'offline',
      label: input.online ? 'Push queued' : 'Offline - queued',
      dotClassName: 'bg-dd-amber-500',
    }
  }
  if (input.remoteAxis.size > 0) {
    const conflicts = [...input.remoteAxis.values()].filter((marker) => marker === 'conflict').length
    return {
      kind: 'incoming',
      label:
        conflicts > 0
          ? `${input.remoteAxis.size} incoming, ${conflicts} conflict${conflicts === 1 ? '' : 's'}`
          : `${input.remoteAxis.size} incoming`,
      dotClassName: 'bg-dd-blue-500',
    }
  }
  return upToDate()
}

function upToDate(): SyncStatus {
  return { kind: 'up-to-date', label: 'Up to date', dotClassName: 'bg-dd-green-500' }
}
