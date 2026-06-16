/**
 * CommitMessageRenderer unit tests.
 *
 * Asserts the renderer resolves the closed placeholder set from a template, reports
 * WHICH template produced the message (the UI surface in issue 1-04), and degrades
 * gracefully on unknown tokens (never crash a Commit).
 */
import { describe, expect, it } from 'vitest'
import { DEFAULT_COMMIT_TEMPLATE, renderCommitMessage } from '../commit-message-renderer.js'

describe('renderCommitMessage', () => {
  it('resolves fileCount/fileList/environment from the default template and reports provenance', () => {
    const rendered = renderCommitMessage({
      targetPaths: ['.zshrc', '.gitconfig'],
      environmentLabel: 'this-mac',
    })

    expect(rendered.message).toBe('Commit 2 file(s) from this-mac: .zshrc, .gitconfig')
    expect(rendered.templateId).toBe('default')
    expect(rendered.templateLabel).toBe('Default')
  })

  it('uses a supplied custom template and reports its id/label', () => {
    const rendered = renderCommitMessage(
      { targetPaths: ['.zshrc'], environmentLabel: 'laptop' },
      { id: 'terse', label: 'Terse', body: 'up {{fileCount}}' },
    )

    expect(rendered.message).toBe('up 1')
    expect(rendered.templateId).toBe('terse')
    expect(rendered.templateLabel).toBe('Terse')
  })

  it('leaves unknown tokens verbatim rather than throwing', () => {
    const rendered = renderCommitMessage(
      { targetPaths: ['.zshrc'], environmentLabel: 'laptop' },
      { id: 'x', label: 'X', body: '{{fileCount}} {{unknown}}' },
    )

    expect(rendered.message).toBe('1 {{unknown}}')
  })

  it('exposes a stable built-in default template', () => {
    expect(DEFAULT_COMMIT_TEMPLATE.id).toBe('default')
    expect(DEFAULT_COMMIT_TEMPLATE.body).toContain('{{fileCount}}')
  })
})
