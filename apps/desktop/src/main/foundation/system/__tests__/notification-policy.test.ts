import { describe, expect, it } from 'vitest'
import { notificationEnabled } from '../notification-policy.js'
import type { NotifyOn } from '../../../../shared/appearance-settings.js'

describe('notification policy', () => {
  it('gates every notification kind from notifyOn', () => {
    const notifyOn: NotifyOn = { incoming: false, conflict: true, applied: false }

    expect(notificationEnabled(notifyOn, 'incoming')).toBe(false)
    expect(notificationEnabled(notifyOn, 'conflict')).toBe(true)
    expect(notificationEnabled(notifyOn, 'applied')).toBe(false)
  })
})
