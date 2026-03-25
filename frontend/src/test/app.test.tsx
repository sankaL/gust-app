import { render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, vi } from 'vitest'

import { AppProviders } from '../providers'
import { AppShell } from '../components/AppShell'
import { CaptureRoute } from '../routes/CaptureRoute'
import { CompletedTasksRoute } from '../routes/CompletedTasksRoute'
import { ManageGroupsRoute } from '../routes/ManageGroupsRoute'
import { TaskDetailRoute } from '../routes/TaskDetailRoute'
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
          },
          {
            path: 'tasks/completed',
            element: <CompletedTasksRoute />
          },
          {
            path: 'tasks/groups',
            element: <ManageGroupsRoute />
          },
          {
            path: 'tasks/:taskId',
            element: <TaskDetailRoute />
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

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === 'string') {
    return input
  }
  if (input instanceof URL) {
    return input.toString()
  }
  return input.url
}

beforeEach(() => {
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input)

      if (url.includes('/auth/session')) {
        return jsonResponse({
          signed_in: true,
          user: { id: 'user-1', email: 'user@example.com', display_name: 'Gust User' },
          timezone: 'UTC',
          inbox_group_id: 'inbox-1',
          csrf_token: 'csrf-token'
        })
      }

      if (url.includes('/groups')) {
        return jsonResponse([
          {
            id: 'inbox-1',
            name: 'Inbox',
            description: null,
            is_system: true,
            system_key: 'inbox',
            open_task_count: 1
          }
        ])
      }

      if (url.includes('/tasks?')) {
        return jsonResponse([
          {
            id: 'task-1',
            title: 'Review extraction contract',
            status: 'open',
            needs_review: true,
            due_date: null,
            reminder_at: null,
            due_bucket: 'no_date',
            group: {
              id: 'inbox-1',
              name: 'Inbox',
              is_system: true
            },
            completed_at: null,
            deleted_at: null
          }
        ])
      }

      return jsonResponse({})
    })
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
  })

  it('fails closed when the tasks route is signed out', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        jsonResponse({
          signed_in: false,
          user: null,
          timezone: null,
          inbox_group_id: null,
          csrf_token: null
        })
      )
    )

    renderWithRoute(['/tasks'])

    expect(await screen.findByText('Session Required')).toBeInTheDocument()
  })
})
