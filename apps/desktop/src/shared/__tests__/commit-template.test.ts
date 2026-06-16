/**
 * Unit tests for the commit-message template renderer (issue 2-09).
 *
 * The renderer is the SINGLE source of truth for both the Commit tab's live preview and (via
 * PRD2#17) the real Commit message, and it is the no-shell privacy seam — so it is TDD'd here:
 * deterministic interpolation, the darwin→macos rename, app-clock date/time, the closed-set
 * guarantee (unknown `$tokens` left verbatim), and the default rendering exactly the spec sample.
 */
import { describe, expect, it } from 'vitest'
import {
  COMMIT_TEMPLATE_VARIABLES,
  DEFAULT_COMMIT_MESSAGE_TEMPLATE,
  normalizeOs,
  renderCommitTemplate,
  resolveCommitTemplateValues,
  type CommitTemplateContext,
} from '../commit-template'

/** A fixed context so date/time fields are deterministic (app clock handed in, never a shell). */
function context(overrides: Partial<CommitTemplateContext> = {}): CommitTemplateContext {
  return {
    data: { os: 'darwin', arch: 'arm64', hostname: 'work-laptop' },
    environment: 'this-mac',
    fileCount: 3,
    // 2026-06-16 09:42 local — drives $year/$month/$day/$hour/$minute/$date/$time.
    now: new Date(2026, 5, 16, 9, 42, 7),
    ...overrides,
  }
}

describe('renderCommitTemplate', () => {
  it('renders the default template to the spec sample (darwin shown as macos)', () => {
    expect(renderCommitTemplate(DEFAULT_COMMIT_MESSAGE_TEMPLATE, context())).toBe(
      '[macos-sync-2026-06-16]',
    )
  })

  it('interpolates every variable from chezmoi data + the app clock', () => {
    const template =
      '$os $arch $hostname $environment $year $month $day $hour $minute $date $time $filecount'
    expect(renderCommitTemplate(template, context())).toBe(
      'macos arm64 work-laptop this-mac 2026 06 16 09 42 2026-06-16 09:42 3',
    )
  })

  it('leaves an unknown $token verbatim instead of throwing (never fail silently / never crash)', () => {
    // $nope is not in the closed set so it stays verbatim; $os/$year still resolve.
    expect(renderCommitTemplate('$os-$nope-$year', context())).toBe('macos-$nope-2026')
  })

  it('does not match a known name embedded in a longer word ($year ≠ $yearly)', () => {
    expect(renderCommitTemplate('$yearly', context())).toBe('$yearly')
  })

  it('keeps a longer name from being split by a shorter one ($filecount, not $file…)', () => {
    expect(renderCommitTemplate('$filecount', context({ fileCount: 7 }))).toBe('7')
  })

  it('zero-pads month/day/hour/minute', () => {
    const early = context({ now: new Date(2026, 0, 3, 4, 5, 0) })
    expect(renderCommitTemplate('$date $time', early)).toBe('2026-01-03 04:05')
  })

  it('passes a non-darwin os through unchanged', () => {
    expect(
      renderCommitTemplate('$os', context({ data: { os: 'linux', arch: 'amd64', hostname: 'h' } })),
    ).toBe('linux')
  })
})

describe('normalizeOs', () => {
  it('renames darwin to macos and passes everything else through', () => {
    expect(normalizeOs('darwin')).toBe('macos')
    expect(normalizeOs('linux')).toBe('linux')
    expect(normalizeOs('windows')).toBe('windows')
  })
})

describe('resolveCommitTemplateValues', () => {
  it('exposes a value for every declared variable (the editor’s chip set stays in sync)', () => {
    const values = resolveCommitTemplateValues(context())
    for (const variable of COMMIT_TEMPLATE_VARIABLES) {
      expect(values[variable.name], `missing value for $${variable.name}`).toBeTypeOf('string')
    }
  })
})
