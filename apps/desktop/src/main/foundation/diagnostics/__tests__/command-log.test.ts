/**
 * CommandLog tests — the bounded, redacted-at-write Command record buffer.
 *
 * The important contract is ordering: raw records enter through `record()`, are
 * redacted immediately, then appended. There is no append API for already-raw text.
 */
import { describe, expect, it } from 'vitest'

import { CommandLog } from '../command-log.js'
import { REDACTED_TOKEN } from '../redactor.js'

describe('CommandLog', () => {
  it('records redacted Command records and evicts the oldest at capacity', () => {
    const log = new CommandLog({ capacity: 2, redaction: { homeDir: '/home/mathewcst' } })

    log.record({
      command: 'git',
      args: ['status'],
      exitCode: 0,
      stdout: 'one',
      stderr: '',
      timestamp: 1,
    })
    log.record({
      command: 'git',
      args: ['status'],
      exitCode: 0,
      stdout: 'two',
      stderr: '',
      timestamp: 2,
    })
    log.record({
      command: 'git',
      args: [
        'push',
        'https://user:ghp_1234567890abcdefghijklmnopqrstuvwxyzABCD@github.com/x/y.git',
      ],
      exitCode: 128,
      stdout: '',
      stderr: 'three',
      timestamp: 3,
    })

    const records = log.records()
    expect(records.map((record) => record.timestamp)).toEqual([2, 3])
    expect(JSON.stringify(records)).toContain(REDACTED_TOKEN)
    expect(JSON.stringify(records)).not.toContain('ghp_1234567890abcdefghijklmnopqrstuvwxyzABCD')
  })

  it('records() returns a defensive copy', () => {
    const log = new CommandLog({ capacity: 4 })
    log.record({
      command: 'git',
      args: ['status'],
      exitCode: 0,
      stdout: '',
      stderr: '',
      timestamp: 1,
    })

    const snapshot = log.records() as unknown as unknown[]
    snapshot.push({ tampered: true })

    expect(log.records()).toHaveLength(1)
  })

  it('recordsFor() returns only matching trace records as a defensive copy', () => {
    const log = new CommandLog({ capacity: 4 })
    log.record({
      command: 'git',
      args: ['status'],
      exitCode: 0,
      stdout: 'one',
      stderr: '',
      traceId: 'trace-a',
      timestamp: 1,
    })
    log.record({
      command: 'git',
      args: ['status'],
      exitCode: 0,
      stdout: 'two',
      stderr: '',
      traceId: 'trace-b',
      timestamp: 2,
    })
    log.record({
      command: 'git',
      args: ['status'],
      exitCode: 0,
      stdout: 'three',
      stderr: '',
      traceId: 'trace-a',
      timestamp: 3,
    })

    const records = log.recordsFor('trace-a') as unknown as unknown[]
    expect(records.map((record) => (record as { timestamp: number }).timestamp)).toEqual([1, 3])

    records.push({ tampered: true })
    expect(log.recordsFor('trace-a')).toHaveLength(2)
  })

  it('redacts before appending to the buffer', () => {
    const log = new CommandLog({ capacity: 4 })
    const rawSecret = 'ghp_1234567890abcdefghijklmnopqrstuvwxyzABCD'

    log.record({
      command: 'git',
      args: ['push', rawSecret],
      exitCode: 1,
      stdout: rawSecret,
      stderr: rawSecret,
      timestamp: 1,
    })

    const serialized = JSON.stringify(log.records())
    expect(serialized).toContain(REDACTED_TOKEN)
    expect(serialized).not.toContain(rawSecret)
  })

  it('redacts hydrated records before they enter the buffer', () => {
    const rawSecret = 'ghp_1234567890abcdefghijklmnopqrstuvwxyzABCD'
    const log = new CommandLog({
      capacity: 4,
      initialRecords: [
        {
          command: 'git',
          args: ['push', rawSecret],
          exitCode: 1,
          stdout: rawSecret,
          stderr: rawSecret,
          timestamp: 1,
        },
      ],
    })

    const serialized = JSON.stringify(log.records())
    expect(serialized).toContain(REDACTED_TOKEN)
    expect(serialized).not.toContain(rawSecret)
  })
})
