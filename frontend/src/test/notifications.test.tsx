import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider, useNavigate } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { useNotifications } from '../components/Notifications'
import { AppProviders } from '../providers'

function NotificationsDemo() {
  const navigate = useNavigate()
  const { notifyError, notifySuccess } = useNotifications()

  return (
    <div>
      <button type="button" onClick={() => notifySuccess('First message')}>
        First
      </button>
      <button
        type="button"
        onClick={() =>
          notifySuccess('Short message', {
            durationMs: 60,
          })
        }
      >
        Short
      </button>
      <button type="button" onClick={() => notifyError('Second message')}>
        Second
      </button>
      <button
        type="button"
        onClick={() =>
          notifySuccess('Undoable message', {
            actionLabel: 'Undo',
            onAction: () => undefined,
          })
        }
      >
        Undoable
      </button>
      <button
        type="button"
        onClick={() =>
          notifySuccess('Short undoable message', {
            actionLabel: 'Undo',
            onAction: () => undefined,
            durationMs: 180,
          })
        }
      >
        Short Undoable
      </button>
      <button
        type="button"
        onClick={() => {
          notifySuccess('Persists after navigation')
          void navigate('/next')
        }}
      >
        Navigate
      </button>
    </div>
  )
}

function NextScreen() {
  return <p>Next screen</p>
}

function renderNotificationsDemo(initialEntries = ['/']) {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <NotificationsDemo />,
      },
      {
        path: '/next',
        element: <NextScreen />,
      },
    ],
    { initialEntries }
  )

  return render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  )
}

afterEach(() => {
  vi.useRealTimers()
})

describe('notification center', () => {
  it('stacks multiple notifications and renders above floating UI layers', async () => {
    const user = userEvent.setup()
    renderNotificationsDemo()

    await user.click(screen.getByRole('button', { name: 'First' }))
    await user.click(screen.getByRole('button', { name: 'Second' }))

    expect(await screen.findByText('First message')).toBeInTheDocument()
    expect(screen.getByText('Second message')).toBeInTheDocument()

    const viewport = screen.getByText('Second message').closest('section')?.parentElement
    expect(viewport?.className).toContain('z-[80]')
  })

  it('auto-dismisses standard notifications and keeps actionable ones visible longer', async () => {
    const user = userEvent.setup()
    renderNotificationsDemo()

    await user.click(screen.getByRole('button', { name: 'Short' }))
    expect(screen.getByText('Short message')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.queryByText('Short message')).not.toBeInTheDocument()
    })
    await user.click(screen.getByRole('button', { name: 'Short Undoable' }))
    expect(screen.getByText('Short undoable message')).toBeInTheDocument()

    await new Promise((resolve) => window.setTimeout(resolve, 90))
    expect(screen.getByText('Short undoable message')).toBeInTheDocument()

    await waitFor(() => {
      expect(screen.queryByText('Short undoable message')).not.toBeInTheDocument()
    })
  })

  it('supports manual dismiss and survives route transitions', async () => {
    const user = userEvent.setup()
    renderNotificationsDemo()

    await user.click(screen.getByRole('button', { name: 'First' }))
    expect(await screen.findByText('First message')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Dismiss notification' }))
    expect(screen.queryByText('First message')).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Navigate' }))
    expect(await screen.findByText('Next screen')).toBeInTheDocument()
    expect(screen.getByText('Persists after navigation')).toBeInTheDocument()
  })
})
