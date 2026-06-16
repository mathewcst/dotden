/**
 * UpdateCheck tests — the placeholder update-check engine behind the About tab (issue 2-16).
 *
 * The engine's load-bearing rule is HONESTY: with no published feed it must report `unavailable`
 * (with a reason), never a fake "you're up to date" (never fail silently). These tests pin that
 * placeholder behaviour AND the shape it will take once issue 3-20 drops in a real feed (so the
 * IPC + UI contract is locked before the real engine exists).
 */
import { describe, expect, it } from 'vitest'
import { checkForUpdates, noFeed, type UpdateFeed } from '../update-check.js'

describe('checkForUpdates', () => {
  it('reports unavailable WITH a reason when no feed is configured (the placeholder, issue 2-16)', async () => {
    const result = await checkForUpdates('1.2.0', noFeed)
    expect(result.status).toBe('unavailable')
    expect(result.currentVersion).toBe('1.2.0')
    expect(result.latestVersion).toBeNull()
    // Never a silent failure: the reason is always present so the tab can explain "couldn't check".
    expect(result.detail).toBeTruthy()
  })

  it('defaults to the noFeed placeholder when no feed is passed', async () => {
    const result = await checkForUpdates('0.0.0')
    expect(result.status).toBe('unavailable')
    expect(result.detail).toBeTruthy()
  })

  it('reports up-to-date when a feed says the latest equals current (issue 3-20 shape)', async () => {
    const feed: UpdateFeed = { latest: async () => ({ latestVersion: '1.2.0' }) }
    const result = await checkForUpdates('1.2.0', feed)
    expect(result.status).toBe('up-to-date')
    expect(result.latestVersion).toBe('1.2.0')
    expect(result.detail).toBeNull()
  })

  it('reports update-available, naming the newer version, when a feed advertises one (issue 3-20 shape)', async () => {
    const feed: UpdateFeed = { latest: async () => ({ latestVersion: '1.3.0' }) }
    const result = await checkForUpdates('1.2.0', feed)
    expect(result.status).toBe('update-available')
    expect(result.latestVersion).toBe('1.3.0')
    expect(result.currentVersion).toBe('1.2.0')
  })

  it('passes the current version to the feed so a real feed can compare without re-reading it', async () => {
    let seen: string | null = null
    const feed: UpdateFeed = {
      latest: async (current) => {
        seen = current
        return { unavailable: 'no feed' }
      },
    }
    await checkForUpdates('9.9.9', feed)
    expect(seen).toBe('9.9.9')
  })
})
