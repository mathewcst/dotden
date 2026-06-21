/**
 * secret-scanner — unit tests for the PURE commit-time secret detector (issue 2-03).
 *
 * The scanner is the issue's "scan + warn step" Testing Decision: prove its PURE behavior at
 * the scanner seam. The load-bearing acceptance criteria pinned here:
 * - catches the OBVIOUS secret shapes (token shapes, key blocks, credentials files);
 * - a reasonable FALSE-POSITIVE posture (placeholders / low-entropy values are not flagged);
 * - the masked preview NEVER exposes the full value (the security invariant);
 * - emits findings of shape `{ file, kind, line, maskedValue }` with the right line number.
 *
 * No shell, no I/O — every test feeds the scanner a string, so the whole detector is
 * deterministically testable here (the rest of the slice — the warn surface + the DenService
 * scan-at-commit wiring — is exercised in den-service.e2e.test.ts).
 */
import { describe, expect, it } from 'vitest'
import { maskSecret, scanFile, scanForSecrets, shannonEntropy } from '../secret-scanner.js'
import type { SecretKind } from '../../../../shared/secrets.js'

/** Scan a single file body and return the findings (test ergonomics over scanFile). */
function scan(content: string, file = '.config') {
  return scanFile({ file, content })
}

describe('maskSecret — the security invariant (never expose the full value)', () => {
  it('never contains the full secret value', () => {
    for (const value of [
      'AKIAJQ4R7TZP2WBN5KCD',
      'ghp_1234567890abcdefghijklmnopqrstuvwxyz',
      'short',
      'a'.repeat(64),
      'sk-proj-abcdef0123456789',
    ]) {
      expect(maskSecret(value)).not.toContain(value)
    }
  })

  it('reveals only a short head + tail of a long value, eliding the middle', () => {
    const masked = maskSecret('AKIAJQ4R7TZP2WBN5KCD')
    expect(masked.startsWith('AKIA')).toBe(true) // 4-char head
    expect(masked.endsWith('5KCD')).toBe(true) // 4-char tail
    expect(masked).toContain('•') // middle elided
    // The interior secret bytes are gone — `JQ4R7TZP` (the middle) must not survive.
    expect(masked).not.toContain('JQ4R7TZP')
  })

  it('reveals NOTHING but bullets for a short value (no head/tail leak)', () => {
    const masked = maskSecret('hunter2pw')
    expect(masked).not.toMatch(/[A-Za-z0-9]/) // no plaintext characters at all
    expect(masked).toMatch(/^•+$/)
  })

  it('uses a constant-width bullet run so the hidden length never leaks', () => {
    // Two values with very different middles must mask to the same bullet width.
    const a = maskSecret('AKIA' + 'X'.repeat(10) + 'TAIL')
    const b = maskSecret('AKIA' + 'X'.repeat(200) + 'TAIL')
    const bulletsA = a.replace(/[^•]/g, '').length
    const bulletsB = b.replace(/[^•]/g, '').length
    expect(bulletsA).toBe(bulletsB)
  })
})

describe('scanFile — catches the obvious secret shapes', () => {
  const cases: ReadonlyArray<{ name: string; line: string; kind: SecretKind }> = [
    {
      name: 'AWS Access Key ID',
      line: 'aws_access_key_id = AKIAJQ4R7TZP2WBN5KCD',
      kind: 'AWS Access Key ID',
    },
    {
      name: 'AWS Secret Access Key',
      line: 'aws_secret_access_key = wJalrXUtnFEMI/K7MDENG/bPxRfiCYz9q8K2nLmT4Vd',
      kind: 'AWS Secret Access Key',
    },
    {
      name: 'GitHub classic PAT',
      line: 'GITHUB_TOKEN=ghp_1234567890abcdefghijklmnopqrstuvwxyz',
      kind: 'GitHub Token',
    },
    {
      name: 'GitHub fine-grained PAT',
      line: 'token: github_pat_11ABCDEFG0aBcDeFgHiJkLmNoPqRsTuVwXyZ012345',
      kind: 'GitHub Token',
    },
    {
      name: 'GitLab PAT',
      line: 'CI_TOKEN=glpat-aBcDeFgHiJkLmNoPqRsT',
      kind: 'GitLab Personal Access Token',
    },
    {
      name: 'Slack bot token',
      line: 'SLACK=xoxb-2401234567-abcdEFGHijklMNOP',
      kind: 'Slack Token',
    },
    {
      name: 'Google API key',
      line: 'GOOGLE_API_KEY=AIzaSyA1234567890abcdefghijklmnopqrstuv',
      kind: 'Google API Key',
    },
    {
      name: 'Stripe live secret key',
      line: 'STRIPE_KEY=sk_live_4eC39HqLyjWDarjtT1zdp7dc',
      kind: 'Stripe API Key',
    },
    {
      name: 'OpenAI key',
      line: 'OPENAI_API_KEY=sk-abcdefghijklmnopqrstuvwx',
      kind: 'OpenAI API Key',
    },
    {
      name: 'JWT',
      line: 'jwt=eyJhbGciOiJIUzI1NiIsInR5cCI6IkpXVCJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N',
      kind: 'JSON Web Token',
    },
    {
      name: 'PEM private key header',
      line: '-----BEGIN RSA PRIVATE KEY-----',
      kind: 'Private Key',
    },
    {
      name: 'OpenSSH private key header',
      line: '-----BEGIN OPENSSH PRIVATE KEY-----',
      kind: 'Private Key',
    },
    {
      name: 'generic high-entropy api_key',
      line: 'api_key = "9f2c8b1e4a7d6c3f0e5a8b2d1c9f4e7a"',
      kind: 'Generic API Key or Secret',
    },
  ]

  for (const c of cases) {
    it(`flags a ${c.name}`, () => {
      const findings = scan(c.line)
      expect(findings).toHaveLength(1)
      expect(findings[0]?.kind).toBe(c.kind)
    })
  }

  it('emits the exact finding shape { file, kind, line, maskedValue }', () => {
    const content = ['# my creds', 'aws_access_key_id = AKIAJQ4R7TZP2WBN5KCD'].join('\n')
    const [finding] = scan(content, '.aws/credentials')
    expect(finding).toEqual({
      file: '.aws/credentials',
      kind: 'AWS Access Key ID',
      line: 2, // 1-based, the secret is on the second line
      maskedValue: maskSecret('AKIAJQ4R7TZP2WBN5KCD'),
    })
    // The finding's masked preview must not carry the raw secret.
    expect(finding?.maskedValue).not.toContain('AKIAJQ4R7TZP2WBN5KCD')
  })

  it('reports a multi-line file with the right line numbers', () => {
    const content = [
      'export PATH=$HOME/bin', // 1 — clean
      'github_token=ghp_1234567890abcdefghijklmnopqrstuvwxyz', // 2 — secret
      'alias ll="ls -la"', // 3 — clean
      'AWS_KEY=AKIAJQ4R7TZP2WBN5KCD', // 4 — secret
    ].join('\n')
    const findings = scan(content)
    expect(findings.map((f) => f.line)).toEqual([2, 4])
    expect(findings.map((f) => f.kind)).toEqual(['GitHub Token', 'AWS Access Key ID'])
  })

  it('flags the most specific kind once per line (no generic double-count)', () => {
    // A line that is BOTH a credential assignment AND a known GitHub shape must surface as
    // the precise "GitHub Token", exactly once — not also as a generic key.
    const findings = scan('api_token=ghp_1234567890abcdefghijklmnopqrstuvwxyz')
    expect(findings).toHaveLength(1)
    expect(findings[0]?.kind).toBe('GitHub Token')
  })
})

describe('scanFile — reasonable false-positive posture', () => {
  const clean: ReadonlyArray<{ name: string; line: string }> = [
    { name: 'an ordinary path', line: 'export PATH="/usr/local/bin:/usr/bin"' },
    { name: 'a low-entropy password placeholder', line: 'password = changeme' },
    { name: 'a templated reference', line: 'api_key = "${MY_API_KEY}"' },
    { name: 'an angle-bracket placeholder', line: 'token: <your-token-here>' },
    { name: 'an example/redacted value', line: 'secret_key = "your-secret-key-here"' },
    { name: 'a repeated-char fill', line: 'api_key = "xxxxxxxxxxxxxxxxxxxxxxxx"' },
    { name: 'a short low-entropy value', line: 'token = mytoken' },
    { name: 'an English sentence with the word secret', line: '# keep this file secret' },
    { name: 'a git config user line', line: 'email = me@example.com' },
  ]

  for (const c of clean) {
    it(`does NOT flag ${c.name}`, () => {
      expect(scan(c.line)).toHaveLength(0)
    })
  }

  it('does not flag a known placeholder even in AWS-key position', () => {
    // The credentials-file shape with an obvious placeholder value stays quiet.
    expect(scan('aws_secret_access_key = your-secret-access-key-goes-here')).toHaveLength(0)
  })
})

describe('shannonEntropy — the generic-detector heuristic', () => {
  it('is 0 for empty and single-character strings', () => {
    expect(shannonEntropy('')).toBe(0)
    expect(shannonEntropy('aaaaaaaa')).toBe(0)
  })

  it('rates a random key well above an English word', () => {
    expect(shannonEntropy('9f2c8b1e4a7d6c3f0e5a8b2d1c9f4e7a')).toBeGreaterThan(
      shannonEntropy('correcthorse'),
    )
  })
})

describe('scanForSecrets — across the about-to-be-committed set', () => {
  it('returns findings across multiple Files in File-then-line order', () => {
    const findings = scanForSecrets([
      { file: '.zshrc', content: 'export EDITOR=vim\nGH=ghp_1234567890abcdefghijklmnopqrstuvwxyz' },
      { file: '.aws/credentials', content: 'aws_access_key_id = AKIAJQ4R7TZP2WBN5KCD' },
    ])
    expect(findings).toHaveLength(2)
    expect(findings[0]).toMatchObject({ file: '.zshrc', kind: 'GitHub Token', line: 2 })
    expect(findings[1]).toMatchObject({
      file: '.aws/credentials',
      kind: 'AWS Access Key ID',
      line: 1,
    })
  })

  it('returns an empty list when the set has no detectable secret', () => {
    expect(
      scanForSecrets([
        { file: '.zshrc', content: 'export EDITOR=vim\nalias g=git' },
        { file: '.gitconfig', content: '[user]\n  email = me@example.com' },
      ]),
    ).toEqual([])
  })
})
