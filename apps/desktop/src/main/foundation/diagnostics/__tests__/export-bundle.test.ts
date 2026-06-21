/**
 * Diagnostics export tests — the support handoff is always redacted, even if future UI state
 * allows viewing unredacted session output.
 */
import { describe, expect, it } from 'vitest'

import { buildDiagnosticsBundle } from '../export-bundle.js'
import { REDACTED_TOKEN } from '../redactor.js'

describe('buildDiagnosticsBundle', () => {
  it('includes app/OS facts and command records', () => {
    const bundle = JSON.parse(
      buildDiagnosticsBundle({
        appVersion: '1.2.3',
        platform: 'linux',
        generatedAt: '2026-06-21T00:00:00.000Z',
        records: [
          {
            command: 'git',
            args: ['status'],
            exitCode: 0,
            stdout: 'clean',
            stderr: '',
            traceId: 'trace-a',
            timestamp: 1,
          },
        ],
      }),
    ) as Record<string, unknown>

    expect(bundle).toMatchObject({
      dotdenDiagnosticsVersion: 1,
      appVersion: '1.2.3',
      platform: 'linux',
      recordCount: 1,
    })
    expect(bundle.records).toEqual([
      {
        command: 'git',
        args: ['status'],
        exitCode: 0,
        stdout: 'clean',
        stderr: '',
        traceId: 'trace-a',
        timestamp: '1970-01-01T00:00:00.001Z',
      },
    ])
  })

  it('re-redacts records at export, even if a raw-looking record reaches the assembler', () => {
    const rawSecret = 'ghp_1234567890abcdefghijklmnopqrstuvwxyzABCD'
    const bundle = buildDiagnosticsBundle({
      appVersion: '1.2.3',
      platform: 'linux',
      generatedAt: '2026-06-21T00:00:00.000Z',
      records: [
        {
          command: 'git',
          args: ['push', `https://user:${rawSecret}@github.com/acme/den.git`],
          exitCode: 128,
          stdout: rawSecret,
          stderr: `Authorization: Bearer ${rawSecret}`,
          timestamp: 1,
        },
      ],
    })

    expect(bundle).toContain(REDACTED_TOKEN)
    expect(bundle).not.toContain(rawSecret)
  })
})
