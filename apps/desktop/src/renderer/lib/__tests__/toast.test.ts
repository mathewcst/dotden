import { afterEach, describe, expect, it, vi } from 'vitest'
import { clearToasts, dismissToast, getToasts, showToast } from '../toast'

afterEach(() => {
  clearToasts()
  vi.useRealTimers()
})

describe('toast store', () => {
  it('keeps newest transient messages capped', () => {
    showToast({ tone: 'info', message: 'one', durationMs: 0 })
    showToast({ tone: 'warning', message: 'two', durationMs: 0 })
    showToast({ tone: 'error', message: 'three', durationMs: 0 })
    showToast({ tone: 'success', message: 'four', durationMs: 0 })

    expect(getToasts().map((toastMessage) => toastMessage.message)).toEqual([
      'two',
      'three',
      'four',
    ])
  })

  it('dismisses manually and after timeout', () => {
    vi.useFakeTimers()

    const manual = showToast({ tone: 'info', message: 'manual', durationMs: 0 })
    showToast({ tone: 'success', message: 'timed', durationMs: 1000 })
    dismissToast(manual)

    expect(getToasts().map((toastMessage) => toastMessage.message)).toEqual(['timed'])
    vi.advanceTimersByTime(1000)
    expect(getToasts()).toEqual([])
  })
})
