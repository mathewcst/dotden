/**
 * Persistent Command log tests — restart-safe, redacted-at-rest diagnostics.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { mkdtemp, readFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

import { commandLogPath, PersistentCommandLog } from '../command-log-store.js'
import { REDACTED_TOKEN } from '../../foundation/diagnostics/redactor.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dotden-command-log-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

describe('PersistentCommandLog', () => {
  it('writes the redacted ring under userData and reloads it on restart', async () => {
    const rawSecret = 'ghp_1234567890abcdefghijklmnopqrstuvwxyzABCD'
    const log = await PersistentCommandLog.load(dir, { capacity: 4 })

    log.record({
      command: 'git',
      args: ['push', `https://user:${rawSecret}@github.com/dotden/den.git`],
      exitCode: 128,
      stdout: '',
      stderr: `remote rejected ${rawSecret}`,
      traceId: 'trace-a',
      timestamp: 1,
    })

    const file = await readFile(commandLogPath(dir), 'utf8')
    expect(file).toContain(REDACTED_TOKEN)
    expect(file).not.toContain(rawSecret)

    const reloaded = await PersistentCommandLog.load(dir, { capacity: 4 })
    expect(reloaded.records()).toEqual(log.records())
    expect(reloaded.recordsFor('trace-a')).toHaveLength(1)
  })

  it('reflects capacity eviction on disk so the file stays bounded', async () => {
    const log = await PersistentCommandLog.load(dir, { capacity: 2 })

    for (const timestamp of [1, 2, 3]) {
      log.record({
        command: 'git',
        args: ['status'],
        exitCode: 0,
        stdout: String(timestamp),
        stderr: '',
        timestamp,
      })
    }

    const persisted = JSON.parse(await readFile(commandLogPath(dir), 'utf8')) as {
      readonly records: readonly { readonly timestamp: number }[]
    }
    expect(persisted.records.map((record) => record.timestamp)).toEqual([2, 3])
  })
})
