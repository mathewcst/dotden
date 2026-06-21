// @vitest-environment happy-dom
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { ResizableHandle, ResizablePanel, ResizablePanelGroup } from '../resizable'

/**
 * Smoke coverage for the shared resize primitive used by the shell and History tab.
 * Persistence, pointer math, and keyboard behavior belong to react-resizable-panels; dotden only
 * verifies that our shadcn wrapper renders the one resize idiom every pane now consumes.
 */
describe('Resizable', () => {
  it('renders panels with the shared handle', () => {
    render(
      <ResizablePanelGroup direction="horizontal" autoSaveId="dotden-resizable-test">
        <ResizablePanel defaultSize={40}>Left</ResizablePanel>
        <ResizableHandle withHandle aria-label="Resize test panes" />
        <ResizablePanel defaultSize={60}>Right</ResizablePanel>
      </ResizablePanelGroup>,
    )

    expect(screen.getByText('Left')).toBeTruthy()
    expect(screen.getByText('Right')).toBeTruthy()
    expect(screen.getByLabelText('Resize test panes').getAttribute('role')).toBe('separator')
  })
})
