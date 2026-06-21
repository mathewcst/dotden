import type { NotifyOn } from '../../../shared/appearance-settings.js'

/** The OS-notification events a user can gate from Appearance settings. */
export type NotificationKind = keyof NotifyOn

/**
 * Decide whether an OS notification should fire for an event.
 *
 * This is deliberately tiny but centralized: settings author `NotifyOn`, main-process Electron
 * chrome consumes it, and tests lock the contract so a disabled switch cannot become decorative.
 */
export function notificationEnabled(notifyOn: NotifyOn, kind: NotificationKind): boolean {
  return notifyOn[kind]
}
