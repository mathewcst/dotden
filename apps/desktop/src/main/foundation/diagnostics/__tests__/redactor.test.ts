/**
 * Diagnostics redactor tests — the security-critical write-side scrubber (ADR 0030).
 *
 * The Command log is useful only if it preserves command shape while ensuring raw
 * credentials never reach the buffer. These tests pin the structure-preserving masks
 * before the redactor is wired into the capture seam.
 */
import { describe, expect, it } from 'vitest'

import { OMITTED_RENDERED_OUTPUT, REDACTED_TOKEN, redactCommandRecord } from '../redactor.js'

const rawSecret = 'ghp_1234567890abcdefghijklmnopqrstuvwxyzABCD'
const home = '/home/mathewcst'

describe('redactCommandRecord', () => {
  it('masks credentials in args and output while preserving URL host structure', () => {
    const record = redactCommandRecord(
      {
        command: 'git',
        args: ['clone', `https://mat:${rawSecret}@github.com/mathewcst/private.git`],
        exitCode: 128,
        stdout: '',
        stderr: `fatal: Authentication failed for https://mat:${rawSecret}@github.com/mathewcst/private.git`,
        timestamp: 1,
      },
      { homeDir: home, username: 'mathewcst' },
    )

    expect(record.args.join(' ')).toContain(`https://mat:${REDACTED_TOKEN}@github.com`)
    expect(record.stderr).toContain(`https://mat:${REDACTED_TOKEN}@github.com`)
    expect(JSON.stringify(record)).not.toContain(rawSecret)
  })

  it('masks Authorization/Bearer headers and known token shapes in both args and output', () => {
    const gitlabToken = 'glpat-1234567890abcdefghijklmnop'
    const record = redactCommandRecord(
      {
        command: 'gh',
        args: ['api', '/user', '-H', `Authorization: Bearer ${rawSecret}`],
        exitCode: 1,
        stdout: `token=${gitlabToken}`,
        stderr: `Authorization: Bearer ${rawSecret}`,
        timestamp: 2,
      },
      { homeDir: home, username: 'mathewcst' },
    )

    const serialized = JSON.stringify(record)
    expect(serialized).toContain(`Authorization: Bearer ${REDACTED_TOKEN}`)
    expect(serialized).toContain(REDACTED_TOKEN)
    expect(serialized).not.toContain(rawSecret)
    expect(serialized).not.toContain(gitlabToken)
  })

  it('keeps op:// references visible while masking resolved values beside them', () => {
    const resolvedValue = 'resolved-password-value'
    const record = redactCommandRecord(
      {
        command: 'op',
        args: ['read', 'op://Private/GitHub/token'],
        exitCode: 0,
        stdout: `op://Private/GitHub/token ${resolvedValue}`,
        stderr: '',
        timestamp: 3,
      },
      { homeDir: home, username: 'mathewcst' },
    )

    expect(record.args.join(' ')).toContain('op://Private/GitHub/token')
    expect(record.stdout).toContain(`op://Private/GitHub/token ${REDACTED_TOKEN}`)
    expect(JSON.stringify(record)).not.toContain(resolvedValue)
  })

  it('collapses home and username to tilde without changing command identity', () => {
    const record = redactCommandRecord(
      {
        command: '/usr/bin/git',
        args: ['-C', '/home/mathewcst/.local/share/chezmoi', 'status'],
        exitCode: 0,
        stdout: 'working tree clean',
        stderr: 'looked in /home/mathewcst/.ssh for mathewcst',
        timestamp: 4,
      },
      { homeDir: home, username: 'mathewcst' },
    )

    expect(record.command).toBe('/usr/bin/git')
    expect(record.args).toContain('~/.local/share/chezmoi')
    expect(record.stderr).toBe('looked in ~/.ssh for ~')
  })

  it('drops stdout for templated or secret-bearing chezmoi commands', () => {
    const record = redactCommandRecord(
      {
        command: '/opt/dotden/chezmoi',
        args: ['apply', '.zshrc'],
        exitCode: 0,
        stdout: 'rendered password with no detectable shape',
        stderr: '',
        timestamp: 5,
      },
      { homeDir: home, username: 'mathewcst' },
    )

    expect(record.stdout).toBe(OMITTED_RENDERED_OUTPUT)
  })
})
