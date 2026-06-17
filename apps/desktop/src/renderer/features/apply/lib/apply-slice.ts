/**
 * The `apply` slice — the inbound half of the change lifecycle (ADR 0006), in the scoped
 * `den-session` store (ADR 0027, Phase 2).
 *
 * It owns the incoming/Remote-axis session state and the two full-window review surfaces: the
 * incoming Files for a reviewed Apply (env B), the per-File Remote-axis markers + source label
 * that drive the tree decoration lane + the "N incoming from <env>" banner (issue 1-09), and the
 * `reviewing`/`resolving` flags that swap the den window for the Review & Apply / Conflict
 * resolution surfaces. Actions ported 1:1 from the old `Workspace.tsx`.
 *
 * `list` (env B Detect) and the review surfaces' close handlers reach the session slice via
 * `get()` (selectFile, reloadTree). The IPC surface is injected for node-testability.
 */
import type { DotdenApi } from '../../../../shared/ipc-api'
import type { IncomingReviewItem, RemoteAxisMarker } from '../../../../main/foundation/den-service'
import type { DenSessionGet, DenSessionSet } from '../../shell/lib/den-session-store'

/** The `apply` slice's state + actions (combined into {@link DenSession}). */
export interface ApplySlice {
  /** env B: incoming Files for a reviewed Apply (the 1-04 detect→apply half). */
  incoming: readonly IncomingReviewItem[]
  /** The Remote axis (issue 1-09): the incoming/conflict marker per File for the decoration lane. */
  remoteAxis: ReadonlyMap<string, RemoteAxisMarker>
  /** The source environment label for the top-level "N incoming from <env>" banner. */
  incomingFrom: string
  /** Whether the dedicated Review & Apply surface is open (the banner/card CTA opens it). */
  reviewing: boolean
  /** Whether the Conflict resolution surface is open (issue 1-11). */
  resolving: boolean

  /** Fetch the Remote axis for THIS environment: the markers + source label (run on load + Sync). */
  refreshIncoming(): Promise<void>
  /** env B Detect: list incoming Files so the inspector callout + Review & Apply button wake up. */
  list(): void
  /** Open/close the Review & Apply surface. */
  setReviewing(reviewing: boolean): void
  /** Open/close the Conflict resolution surface. */
  setResolving(resolving: boolean): void
}

/** Build the `apply` slice, closing over the injected {@link DotdenApi}. */
export function createApplySlice(api: DotdenApi) {
  return (set: DenSessionSet, get: DenSessionGet): ApplySlice => ({
    incoming: [],
    remoteAxis: new Map(),
    incomingFrom: 'another environment',
    reviewing: false,
    resolving: false,

    // Fetch the Remote axis (issue 1-09): the incoming/conflict markers per File + the source
    // environment label. Failures here must never break the local tree, so it surfaces a soft
    // error rather than throwing out of the caller.
    refreshIncoming: async () => {
      try {
        const summary = await api.den.incomingSummary()
        set({
          remoteAxis: new Map(summary.items.map((i) => [i.targetPath, i.marker])),
          incomingFrom: summary.fromEnvironmentLabel,
        })
      } catch (caught) {
        set({
          error:
            caught instanceof Error
              ? caught.message
              : 'Could not check the Remote for incoming changes.',
        })
      }
    },

    // Detect lists incoming Files so the inspector callout + the "Review & Apply" button wake up;
    // the actual reviewed Apply happens on the dedicated Review & Apply surface (issue 1-09).
    list: () =>
      void get().run('list', async () => {
        const items = await api.den.listIncoming()
        set({ incoming: items })
        await get().selectFile(items[0]?.targetPath ?? null)
      }),

    setReviewing: (reviewing) => set({ reviewing }),
    setResolving: (resolving) => set({ resolving }),
  })
}
