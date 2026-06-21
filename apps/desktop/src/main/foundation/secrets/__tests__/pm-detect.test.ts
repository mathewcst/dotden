/**
 * pm-detect unit tests — installed-password-manager detection (issue 2-05).
 *
 * Detection is environment-local feature-detection: probe whether each manager's CLI (`op`/`bw`/
 * `pass`) is resolvable on this environment's PATH. The probe is injectable so these tests run with
 * a faked "which" rather than the real filesystem — proving the catalog→option mapping (each
 * manager is enabled iff its CLI is found; an absent CLI carries its install hint) without
 * depending on what happens to be installed on the CI box.
 */
import { describe, expect, it } from 'vitest'
import { detectPasswordManagers } from '../pm-detect.js'

describe('detectPasswordManagers', () => {
  it('marks a manager available when its CLI resolves on PATH', async () => {
    const options = await detectPasswordManagers({ probe: async (cli) => cli === 'op' })
    const op = options.find((o) => o.id === 'op')
    expect(op?.available).toBe(true)
    expect(op?.label).toBe('1Password')
  })

  it('marks a manager unavailable + carries its install hint when the CLI is absent', async () => {
    const options = await detectPasswordManagers({ probe: async (cli) => cli === 'op' })
    const pass = options.find((o) => o.id === 'pass')
    expect(pass?.available).toBe(false)
    // An absent CLI must explain WHY it can't be picked (acceptance criterion 4, never fail silently).
    expect(pass?.installHint.length).toBeGreaterThan(0)
  })

  it('returns every catalog manager (op, bw, pass) in display order', async () => {
    const options = await detectPasswordManagers({ probe: async () => false })
    expect(options.map((o) => o.id)).toEqual(['op', 'bw', 'pass'])
    // All unavailable when nothing is installed — every option disabled, none silently dropped.
    expect(options.every((o) => o.available === false)).toBe(true)
  })

  it('treats a probe that throws as "not installed" rather than failing detection', async () => {
    const options = await detectPasswordManagers({
      probe: async (cli) => {
        if (cli === 'bw') throw new Error('boom')
        return cli === 'op'
      },
    })
    expect(options.find((o) => o.id === 'op')?.available).toBe(true)
    // A probe error is swallowed to "unavailable" — a flaky which never crashes the picker.
    expect(options.find((o) => o.id === 'bw')?.available).toBe(false)
  })
})
