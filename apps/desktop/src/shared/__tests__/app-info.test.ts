/**
 * app-info pure-helper tests — the About tab's copy derivation (issue 2-16, stories 52–53).
 *
 * The About tab's DECISIONS (what headline each update status shows, and whether it reads as a
 * problem) are pure and live here so they are unit-testable without a renderer (the codebase's
 * renderer tests are pure-logic, no jsdom). The load-bearing rule is HONESTY: an `unavailable`
 * check must read as "couldn't check", never as a reassuring "you're current".
 */
import { describe, expect, it } from 'vitest'
import {
  CHEZMOI_CREDIT,
  describeUpdateStatus,
  isUpdateCheckUnavailable,
  type UpdateCheckResult,
} from '../app-info.js'

/** Build an UpdateCheckResult with sensible defaults the test can override. */
function result(over: Partial<UpdateCheckResult>): UpdateCheckResult {
  return {
    status: 'unavailable',
    currentVersion: '1.2.0',
    latestVersion: null,
    detail: null,
    checkedAt: '2026-06-21T00:00:00.000Z',
    ...over,
  }
}

describe('describeUpdateStatus', () => {
  it('names the running version when up-to-date', () => {
    expect(
      describeUpdateStatus(result({ status: 'up-to-date', latestVersion: '1.2.0' })),
    ).toContain('1.2.0')
  })

  it('names the newer version when an update is available', () => {
    const copy = describeUpdateStatus(
      result({ status: 'update-available', latestVersion: '1.3.0' }),
    )
    expect(copy).toContain('1.3.0')
    expect(copy).toContain('1.2.0')
  })

  it('reads as "couldn\'t check" — never a fake "you\'re up to date" — when unavailable', () => {
    const copy = describeUpdateStatus(result({ status: 'unavailable' }))
    expect(copy.toLowerCase()).toContain("couldn't")
    expect(copy.toLowerCase()).not.toContain('latest')
    expect(copy.toLowerCase()).not.toContain('up to date')
  })
})

describe('isUpdateCheckUnavailable', () => {
  it('flags only the unavailable status as a non-reassuring outcome', () => {
    expect(isUpdateCheckUnavailable(result({ status: 'unavailable' }))).toBe(true)
    expect(isUpdateCheckUnavailable(result({ status: 'up-to-date' }))).toBe(false)
    expect(isUpdateCheckUnavailable(result({ status: 'update-available' }))).toBe(false)
  })
})

describe('CHEZMOI_CREDIT', () => {
  it('credits chezmoi by name with a link (the faithful-wrapper acknowledgement, ADR 0003)', () => {
    expect(CHEZMOI_CREDIT.name).toBe('chezmoi')
    expect(CHEZMOI_CREDIT.url).toContain('chezmoi.io')
    expect(CHEZMOI_CREDIT.blurb.toLowerCase()).toContain('chezmoi')
  })
})
