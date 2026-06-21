// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { RowContextMenu } from '../RowContextMenu'

afterEach(cleanup)

/**
 * Regression for issue 1-08: right-clicking a File row must resolve its `data-item-path`
 * (via `[data-item-path][data-item-type="file"]`) and show the verbs. A row missing
 * `data-item-type` (the old grouped FileRow) left the menu empty.
 */
describe('RowContextMenu', () => {
  it('shows the verbs when right-clicking a row carrying the @pierre/trees attributes', async () => {
    const onVerb = vi.fn()
    render(
      <RowContextMenu onVerb={onVerb}>
        <div>
          <button data-item-path=".zshrc" data-item-type="file" data-type="item">
            .zshrc
          </button>
        </div>
      </RowContextMenu>,
    )

    fireEvent.contextMenu(screen.getByRole('button', { name: '.zshrc' }))

    await waitFor(() => expect(screen.getByText('Commit changes')).toBeTruthy())
    expect(screen.getByText('Apply')).toBeTruthy()
    expect(screen.getByText('Untrack')).toBeTruthy()
    expect(screen.getByText('Delete everywhere')).toBeTruthy()
  })

  it('stays empty when the right-click misses a File row', async () => {
    render(
      <RowContextMenu onVerb={vi.fn()}>
        <div data-testid="empty-area">no rows here</div>
      </RowContextMenu>,
    )

    fireEvent.contextMenu(screen.getByTestId('empty-area'))

    // Give base-ui a tick to open; no verb should ever appear.
    await new Promise((r) => setTimeout(r, 50))
    expect(screen.queryByText('Commit changes')).toBeNull()
  })
})
