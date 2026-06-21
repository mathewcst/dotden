import type { AutomationLevel } from '../../../shared/apply.js'
import type {
  AutoApplyResult,
  TrayPollerAutomationAction,
  YoloSyncResult,
} from '../../../shared/den.js'

export interface AutomationDispatchDen {
  autoApplyIncoming(traceId: string): Promise<AutoApplyResult>
  yoloSync(traceId: string): Promise<YoloSyncResult>
}

export interface AutomationDispatchPorts {
  readLevel(): Promise<AutomationLevel>
  den(): Promise<AutomationDispatchDen>
  notifyIncoming(): void
  notifyConflict(): void
  notifyApplied(fileCount: number): void
  pushAction(action: TrayPollerAutomationAction): void
}

/**
 * Dispatch one detected incoming move according to this environment's automation rung.
 *
 * TrayPoller stays detect-only and Electron-free. This adapter layers the runtime policy on top:
 * Manual/Auto-sync prompt for review, Auto-apply applies clean incoming then surfaces holds, and
 * YOLO runs the full hands-off sync while still routing conflicts to the resolver.
 */
export async function dispatchIncomingAutomation(
  traceId: string,
  ports: AutomationDispatchPorts,
): Promise<void> {
  const level = await ports.readLevel()

  if (level === 'yolo') {
    surfaceYoloResult(await (await ports.den()).yoloSync(traceId), ports)
    return
  }

  if (level === 'auto-apply') {
    surfaceAutoApplyResult(await (await ports.den()).autoApplyIncoming(traceId), ports)
    return
  }

  ports.notifyIncoming()
  ports.pushAction('refresh')
}

function surfaceAutoApplyResult(result: AutoApplyResult, ports: AutomationDispatchPorts): void {
  ports.pushAction('refresh')
  if (result.applied.applied.length > 0) ports.notifyApplied(result.applied.applied.length)
  if (result.needsReview.length > 0) {
    ports.notifyIncoming()
    ports.pushAction('review')
  }
}

function surfaceYoloResult(result: YoloSyncResult, ports: AutomationDispatchPorts): void {
  ports.pushAction('refresh')
  if (result.autoApplied.applied.applied.length > 0) {
    ports.notifyApplied(result.autoApplied.applied.applied.length)
  }
  if (result.conflicts.length > 0) {
    ports.notifyConflict()
    ports.pushAction('resolve')
    return
  }
  if (result.autoApplied.needsReview.length > 0) {
    ports.notifyIncoming()
    ports.pushAction('review')
  }
}
