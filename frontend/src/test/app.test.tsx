import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, vi } from 'vitest'

import { AppProviders } from '../providers'
import { AppShell } from '../components/AppShell'
import { CaptureRoute } from '../routes/CaptureRoute'
import { TasksRoute } from '../routes/TasksRoute'

function renderWithRoute(initialEntries: string[]) {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <AppShell />,
        children: [
          {
            index: true,
            element: <CaptureRoute />
          },
          {
            path: 'tasks',
            element: <TasksRoute />
          }
        ]
      }
    ],
    { initialEntries }
  )

  return render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  )
}

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    }
  })
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn(() =>
      jsonResponse({
        signed_in: true,
        user: { id: 'user-1', email: 'user@example.com', display_name: 'Gust User' },
        timezone: 'UTC',
        inbox_group_id: 'inbox-1',
        csrf_token: 'csrf-token'
      })
    )
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('app shell', () => {
  it('renders the capture route by default', async () => {
    renderWithRoute(['/'])

    expect(await screen.findByRole('heading', { name: 'Capture' })).toBeInTheDocument()
    expect(screen.getByText('Voice-first foundation')).toBeInTheDocument()
  })

  it('renders the tasks route', () => {
    renderWithRoute(['/tasks'])

    expect(screen.getByRole('heading', { name: 'Tasks' })).toBeInTheDocument()
    expect(screen.getByText('Inbox')).toBeInTheDocument()
  })
})
