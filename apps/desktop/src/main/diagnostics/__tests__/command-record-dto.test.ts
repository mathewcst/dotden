import { describe, expect, it } from 'vitest'

import { REDACTED_TOKEN } from '../../foundation/diagnostics/redactor.js'
import { toRedactedCommandRecordDto } from '../command-record-dto.js'

describe('toRedactedCommandRecordDto', () => {
  it('re-redacts records before exposing them to the renderer', () => {
    const rawSecret = 'ghp_1234567890abcdefghijklmnopqrstuvwxyzABCD'
    const dto = toRedactedCommandRecordDto({
      command: 'git',
      args: ['push', rawSecret],
      exitCode: 128,
      stdout: rawSecret,
      stderr: `Authorization: Bearer ${rawSecret}`,
      traceId: 'trace-a',
      timestamp: 1,
    })

    const serialized = JSON.stringify(dto)
    expect(serialized).toContain(REDACTED_TOKEN)
    expect(serialized).not.toContain(rawSecret)
    expect(dto).not.toHaveProperty('stdout')
    expect(dto).not.toHaveProperty('stderr')
  })
})
