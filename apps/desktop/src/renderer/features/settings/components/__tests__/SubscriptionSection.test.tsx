// @vitest-environment happy-dom

import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { installDotdenTestApi } from '@/test/dotden-test-api'
import { SubscriptionSection } from '../SubscriptionSection'

const loadedState = {
  registered: true,
  emptyDenWarning: null,
  workspaces: [
    { id: 'personal', label: 'Personal', subscribed: true },
    { id: 'work', label: 'Work', subscribed: false },
  ],
}

afterEach(() => {
  cleanup()
  vi.restoreAllMocks()
})

describe('SubscriptionSection', () => {
  it('subscribes to an unchecked Workspace immediately', async () => {
    const setSubscriptions = vi.fn(async () => ({
      ...loadedState,
      workspaces: loadedState.workspaces.map((workspace) => ({
        ...workspace,
        subscribed: true,
      })),
    }))
    installDotdenTestApi({
      den: {
        subscriptionState: vi.fn(async () => loadedState),
        setSubscriptions,
        unsubscribeDisposition: vi.fn(async () => 'keep' as const),
      },
    })

    render(<SubscriptionSection />)

    fireEvent.click(await screen.findByRole('checkbox', { name: /work/i }))

    await waitFor(() => expect(setSubscriptions).toHaveBeenCalledWith(['personal', 'work']))
  })

  it('unsubscribes with the remembered keep default', async () => {
    const unsubscribeWorkspace = vi.fn(async () => ({
      ...loadedState,
      workspaces: loadedState.workspaces.map((workspace) =>
        workspace.id === 'personal' ? { ...workspace, subscribed: false } : workspace,
      ),
    }))
    installDotdenTestApi({
      den: {
        subscriptionState: vi.fn(async () => loadedState),
        unsubscribeDisposition: vi.fn(async () => 'keep' as const),
        unsubscribeWorkspace,
      },
    })

    render(<SubscriptionSection />)

    fireEvent.click(await screen.findByRole('checkbox', { name: /personal/i }))
    fireEvent.click(await screen.findByRole('button', { name: /unsubscribe/i }))

    await waitFor(() => expect(unsubscribeWorkspace).toHaveBeenCalledWith('personal', 'keep'))
  })

  it('can remove local copies and remember that default', async () => {
    const unsubscribeWorkspace = vi.fn(async () => ({
      ...loadedState,
      workspaces: loadedState.workspaces.map((workspace) =>
        workspace.id === 'personal' ? { ...workspace, subscribed: false } : workspace,
      ),
    }))
    const rememberUnsubscribeDisposition = vi.fn(async () => undefined)
    installDotdenTestApi({
      den: {
        subscriptionState: vi.fn(async () => loadedState),
        unsubscribeDisposition: vi.fn(async () => 'keep' as const),
        unsubscribeWorkspace,
        rememberUnsubscribeDisposition,
      },
    })

    render(<SubscriptionSection />)

    fireEvent.click(await screen.findByRole('checkbox', { name: /personal/i }))
    fireEvent.click(await screen.findByRole('radio', { name: /remove this environment/i }))
    fireEvent.click(screen.getByRole('checkbox', { name: /remember this choice/i }))
    fireEvent.click(screen.getByRole('button', { name: /unsubscribe/i }))

    await waitFor(() =>
      expect(rememberUnsubscribeDisposition).toHaveBeenCalledWith('remove'),
    )
    expect(unsubscribeWorkspace).toHaveBeenCalledWith('personal', 'remove')
  })

  it('surfaces subscription update failures and recovers busy state', async () => {
    installDotdenTestApi({
      den: {
        subscriptionState: vi.fn(async () => loadedState),
        unsubscribeDisposition: vi.fn(async () => 'keep' as const),
        setSubscriptions: vi.fn(async () => {
          throw new Error('subscription failed')
        }),
      },
    })

    render(<SubscriptionSection />)

    const work = await screen.findByRole('checkbox', { name: /work/i })
    fireEvent.click(work)

    expect((await screen.findByRole('alert')).textContent).toContain('subscription failed')
    expect((screen.getByRole('checkbox', { name: /work/i }) as HTMLInputElement).disabled).toBe(
      false,
    )
  })
})
