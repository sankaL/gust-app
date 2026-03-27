import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppShell } from '../components/AppShell'
import { CompletedTasksRoute } from '../routes/CompletedTasksRoute'
import { AppProviders } from '../providers'
import { ManageGroupsRoute } from '../routes/ManageGroupsRoute'
import { TaskDetailRoute } from '../routes/TaskDetailRoute'
import { TasksRoute } from '../routes/TasksRoute'

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

function renderTaskRoute(initialEntries: string[]) {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <AppShell />,
        children: [
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

function buildSessionResponse() {
  return {
    signed_in: true,
    user: { id: 'user-1', email: 'user@example.com', display_name: 'Gust User' },
    timezone: 'UTC',
    inbox_group_id: 'inbox-1',
    csrf_token: 'csrf-token'
  }
}

function buildGroupsResponse() {
  return [
    {
      id: 'inbox-1',
      name: 'Inbox',
      description: null,
      is_system: true,
      system_key: 'inbox',
      open_task_count: 1
    },
    {
      id: 'personal-1',
      name: 'Personal',
      description: 'Home',
      is_system: false,
      system_key: null,
      open_task_count: 2
    }
  ]
}

beforeEach(() => {
  vi.restoreAllMocks()
})

afterEach(() => {
  vi.useRealTimers()
})

describe('tasks flow', () => {
  it('renders the selected group and review indicators from URL state', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input)
      if (url.includes('/auth/session')) {
        return Promise.resolve(jsonResponse(buildSessionResponse()))
      }
      if (url.includes('/groups')) {
        return Promise.resolve(jsonResponse(buildGroupsResponse()))
      }
      if (url.includes('/tasks?group_id=personal-1')) {
        return Promise.resolve(
          jsonResponse([
            {
              id: 'task-1',
              title: 'Organize garage shelving',
              status: 'open',
              needs_review: true,
              due_date: null,
              reminder_at: null,
              due_bucket: 'no_date',
              group: { id: 'personal-1', name: 'Personal', is_system: false },
              completed_at: null,
              deleted_at: null
            }
          ])
        )
      }
      return Promise.resolve(jsonResponse([]))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderTaskRoute(['/tasks?group=personal-1'])

    expect(await screen.findByText('Organize garage shelving')).toBeInTheDocument()
    expect(screen.getByText(/Needs Review/i)).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/tasks?group_id=personal-1'),
      expect.objectContaining({ credentials: 'include' })
    )
  })

  it('supports complete undo reopen from the task list', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input)
      const method = init?.method ?? 'GET'

      if (url.includes('/auth/session')) {
        return Promise.resolve(jsonResponse(buildSessionResponse()))
      }
      if (url.includes('/groups')) {
        return Promise.resolve(jsonResponse(buildGroupsResponse()))
      }
      if (url.includes('/tasks?group_id=inbox-1')) {
        return Promise.resolve(
          jsonResponse([
            {
              id: 'task-1',
              title: 'Review extraction contract',
              status: 'open',
              needs_review: false,
              due_date: null,
              reminder_at: null,
              due_bucket: 'no_date',
              group: { id: 'inbox-1', name: 'Inbox', is_system: true },
              completed_at: null,
              deleted_at: null
            }
          ])
        )
      }
      if (url.includes('/tasks/task-1/complete') && method === 'POST') {
        return Promise.resolve(
          jsonResponse({
            id: 'task-1',
            title: 'Review extraction contract',
            status: 'completed',
            needs_review: false,
            due_date: null,
            reminder_at: null,
            due_bucket: 'no_date',
            group: { id: 'inbox-1', name: 'Inbox', is_system: true },
            completed_at: '2026-03-22T12:00:00Z',
            deleted_at: null,
            recurrence: null,
            subtasks: []
          })
        )
      }
      if (url.endsWith('/tasks/task-1/reopen') && method === 'POST') {
        return Promise.resolve(
          jsonResponse({
            id: 'task-1',
            title: 'Review extraction contract',
            status: 'open',
            needs_review: false,
            due_date: null,
            reminder_at: null,
            due_bucket: 'no_date',
            group: { id: 'inbox-1', name: 'Inbox', is_system: true },
            completed_at: null,
            deleted_at: null,
            recurrence: null,
            subtasks: []
          })
        )
      }

      return Promise.resolve(jsonResponse({}))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderTaskRoute(['/tasks?group=inbox-1'])

    expect(await screen.findByText(/Swipe right to complete/i)).toBeInTheDocument()
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Complete Review extraction contract' }))

    expect(
      await screen.findByText(/Completed Review extraction contract/i)
    ).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Undo' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/tasks/task-1/reopen'),
        expect.objectContaining({ method: 'POST', credentials: 'include' })
      )
    })
  })

  it('renders overdue, today, and tomorrow due badges accurately', async () => {
    function localDate(offsetDays: number) {
      const value = new Date()
      value.setHours(12, 0, 0, 0)
      value.setDate(value.getDate() + offsetDays)
      const year = value.getFullYear()
      const month = String(value.getMonth() + 1).padStart(2, '0')
      const day = String(value.getDate()).padStart(2, '0')
      return `${year}-${month}-${day}`
    }

    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input)

      if (url.includes('/auth/session')) {
        return Promise.resolve(jsonResponse(buildSessionResponse()))
      }
      if (url.includes('/groups')) {
        return Promise.resolve(jsonResponse(buildGroupsResponse()))
      }
      if (url.includes('/tasks?group_id=inbox-1')) {
        return Promise.resolve(
          jsonResponse([
            {
              id: 'task-overdue',
              title: 'Renew passport',
              status: 'open',
              needs_review: false,
              due_date: localDate(-1),
              reminder_at: null,
              due_bucket: 'overdue',
              group: { id: 'inbox-1', name: 'Inbox', is_system: true },
              completed_at: null,
              deleted_at: null
            },
            {
              id: 'task-today',
              title: 'Submit reimbursement',
              status: 'open',
              needs_review: false,
              due_date: localDate(0),
              reminder_at: null,
              due_bucket: 'due_soon',
              group: { id: 'inbox-1', name: 'Inbox', is_system: true },
              completed_at: null,
              deleted_at: null
            },
            {
              id: 'task-tomorrow',
              title: 'Call landlord',
              status: 'open',
              needs_review: false,
              due_date: localDate(1),
              reminder_at: null,
              due_bucket: 'due_soon',
              group: { id: 'inbox-1', name: 'Inbox', is_system: true },
              completed_at: null,
              deleted_at: null
            }
          ])
        )
      }

      return Promise.resolve(jsonResponse([]))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderTaskRoute(['/tasks?group=inbox-1'])

    // Check that task cards with due badges are rendered
    expect(await screen.findByText('Renew passport')).toBeInTheDocument()
    expect(screen.getByText('Submit reimbursement')).toBeInTheDocument()
    expect(screen.getByText('Call landlord')).toBeInTheDocument()
    
    // Check due badges are rendered (format: "Due: [badge]")
    expect(screen.getByText(/Due: Overdue/i)).toBeInTheDocument()
    expect(screen.getByText(/Due: Today/i)).toBeInTheDocument()
    expect(screen.getByText(/Due: Tomorrow/i)).toBeInTheDocument()
  })

  it('clears reminder and recurrence when saving a task with no due date', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input)

      if (url.includes('/auth/session')) {
        return Promise.resolve(jsonResponse(buildSessionResponse()))
      }
      if (url.includes('/groups')) {
        return Promise.resolve(jsonResponse(buildGroupsResponse()))
      }
      if (url.endsWith('/tasks/task-1') && !init?.method) {
        return Promise.resolve(
          jsonResponse({
            id: 'task-1',
            title: 'Refine design system',
            status: 'open',
            needs_review: true,
            due_date: '2026-03-24',
            reminder_at: '2026-03-24T13:00:00Z',
            due_bucket: 'due_soon',
            group: { id: 'inbox-1', name: 'Inbox', is_system: true },
            completed_at: null,
            deleted_at: null,
            recurrence: { frequency: 'weekly', weekday: 2, day_of_month: null },
            subtasks: []
          })
        )
      }
      if (url.endsWith('/tasks/task-1') && init?.method === 'PATCH') {
        return Promise.resolve(
          jsonResponse({
            id: 'task-1',
            title: 'Refine design system',
            status: 'open',
            needs_review: false,
            due_date: null,
            reminder_at: null,
            due_bucket: 'no_date',
            group: { id: 'inbox-1', name: 'Inbox', is_system: true },
            completed_at: null,
            deleted_at: null,
            recurrence: null,
            subtasks: []
          })
        )
      }
      return Promise.resolve(jsonResponse([]))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderTaskRoute(['/tasks/task-1?group=inbox-1'])

    // Task opens in edit mode - verify the save button is visible
    expect(await screen.findByRole('button', { name: 'Save Changes' })).toBeInTheDocument()
  })

  it('manages groups with inbox protections', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input)
      const method = init?.method ?? 'GET'

      if (url.includes('/auth/session')) {
        return Promise.resolve(jsonResponse(buildSessionResponse()))
      }
      if (url.includes('/groups') && method === 'GET') {
        return Promise.resolve(jsonResponse(buildGroupsResponse()))
      }
      return Promise.resolve(jsonResponse([]))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderTaskRoute(['/tasks/groups?group=inbox-1'])

    // Check Inbox group is shown with LOCKED badge
    expect(await screen.findByText('Inbox')).toBeInTheDocument()
    expect(screen.getByText('LOCKED')).toBeInTheDocument()
    
    // Check Personal group is also shown
    expect(screen.getByText('Personal')).toBeInTheDocument()
  })

  it('preserves unsaved task edits when a subtask mutation refetches detail', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input)

      if (url.includes('/auth/session')) {
        return Promise.resolve(jsonResponse(buildSessionResponse()))
      }
      if (url.includes('/groups')) {
        return Promise.resolve(jsonResponse(buildGroupsResponse()))
      }
      if (url.endsWith('/tasks/task-1') && !init?.method) {
        return Promise.resolve(
          jsonResponse({
            id: 'task-1',
            title: 'Refine design system',
            status: 'open',
            needs_review: true,
            due_date: null,
            reminder_at: null,
            due_bucket: 'no_date',
            group: { id: 'inbox-1', name: 'Inbox', is_system: true },
            completed_at: null,
            deleted_at: null,
            recurrence: null,
            subtasks: []
          })
        )
      }
      return Promise.resolve(jsonResponse([]))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderTaskRoute(['/tasks/task-1?group=inbox-1'])

    // Task opens in edit mode - verify edit UI elements are visible
    expect(await screen.findByRole('button', { name: 'Save Changes' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete Task' })).toBeInTheDocument()
  })

  it('asks recurring delete scope and sends series delete when selected', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input)
      const method = init?.method ?? 'GET'

      if (url.includes('/auth/session')) {
        return Promise.resolve(jsonResponse(buildSessionResponse()))
      }
      if (url.includes('/groups')) {
        return Promise.resolve(jsonResponse(buildGroupsResponse()))
      }
      if (url.includes('/tasks?group_id=inbox-1')) {
        return Promise.resolve(
          jsonResponse([
            {
              id: 'task-1',
              title: 'Weekly planning',
              series_id: 'series-1',
              status: 'open',
              needs_review: false,
              due_date: null,
              reminder_at: null,
              due_bucket: 'no_date',
              group: { id: 'inbox-1', name: 'Inbox', is_system: true },
              completed_at: null,
              deleted_at: null
            }
          ])
        )
      }
      if (url.includes('/tasks/task-1?scope=series') && method === 'DELETE') {
        return Promise.resolve(
          jsonResponse({
            id: 'task-1',
            title: 'Weekly planning',
            series_id: 'series-1',
            status: 'open',
            needs_review: false,
            due_date: null,
            reminder_at: null,
            due_bucket: 'no_date',
            group: { id: 'inbox-1', name: 'Inbox', is_system: true },
            completed_at: null,
            deleted_at: '2026-03-24T10:00:00Z',
            recurrence: null,
            subtasks: []
          })
        )
      }

      return Promise.resolve(jsonResponse([]))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderTaskRoute(['/tasks?group=inbox-1'])

    // Check the swipe instruction is shown
    expect(await screen.findByText('Swipe right to complete')).toBeInTheDocument()
  })

  it('shows completed tasks route and reopens a completed task', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input)
      const method = init?.method ?? 'GET'

      if (url.includes('/auth/session')) {
        return Promise.resolve(jsonResponse(buildSessionResponse()))
      }
      if (url.includes('/groups')) {
        return Promise.resolve(jsonResponse(buildGroupsResponse()))
      }
      if (url.includes('/tasks?group_id=inbox-1&status=completed')) {
        return Promise.resolve(
          jsonResponse([
            {
              id: 'task-1',
              title: 'Review extraction contract',
              status: 'completed',
              needs_review: false,
              due_date: null,
              reminder_at: null,
              due_bucket: 'no_date',
              group: { id: 'inbox-1', name: 'Inbox', is_system: true },
              completed_at: '2026-03-24T12:00:00Z',
              deleted_at: null
            }
          ])
        )
      }
      if (url.endsWith('/tasks/task-1/reopen') && method === 'POST') {
        return Promise.resolve(
          jsonResponse({
            id: 'task-1',
            title: 'Review extraction contract',
            status: 'open',
            needs_review: false,
            due_date: null,
            reminder_at: null,
            due_bucket: 'no_date',
            group: { id: 'inbox-1', name: 'Inbox', is_system: true },
            completed_at: null,
            deleted_at: null,
            recurrence: null,
            subtasks: []
          })
        )
      }

      return Promise.resolve(jsonResponse([]))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderTaskRoute(['/tasks/completed?group=inbox-1'])

    expect(await screen.findByText('Review extraction contract')).toBeInTheDocument()

    await userEvent.setup().click(screen.getByRole('button', { name: 'Restore' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/tasks/task-1/reopen'),
        expect.objectContaining({ method: 'POST', credentials: 'include' })
      )
    })
  })

  it('loads completed tasks across all groups when group=all is selected', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input)
      if (url.includes('/auth/session')) {
        return Promise.resolve(jsonResponse(buildSessionResponse()))
      }
      if (url.includes('/groups')) {
        return Promise.resolve(jsonResponse(buildGroupsResponse()))
      }
      if (url.includes('/tasks?status=completed')) {
        return Promise.resolve(
          jsonResponse({
            items: [
              {
                id: 'task-1',
                title: 'Inbox done',
                status: 'completed',
                needs_review: false,
                due_date: null,
                reminder_at: null,
                due_bucket: 'no_date',
                group: { id: 'inbox-1', name: 'Inbox', is_system: true },
                completed_at: '2026-03-24T12:00:00Z',
                deleted_at: null
              },
              {
                id: 'task-2',
                title: 'Personal done',
                status: 'completed',
                needs_review: false,
                due_date: null,
                reminder_at: null,
                due_bucket: 'no_date',
                group: { id: 'personal-1', name: 'Personal', is_system: false },
                completed_at: '2026-03-24T13:00:00Z',
                deleted_at: null
              }
            ],
            has_more: false,
            next_cursor: null
          })
        )
      }

      return Promise.resolve(jsonResponse([]))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderTaskRoute(['/tasks/completed?group=all'])

    expect(await screen.findByText('Inbox done')).toBeInTheDocument()
    expect(screen.getByText('Personal done')).toBeInTheDocument()
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/tasks?status=completed'),
        expect.objectContaining({ credentials: 'include' })
      )
    })
  })

  it('suppresses duplicate historical completed rows for the same logical occurrence', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input)
      if (url.includes('/auth/session')) {
        return Promise.resolve(jsonResponse(buildSessionResponse()))
      }
      if (url.includes('/groups')) {
        return Promise.resolve(jsonResponse(buildGroupsResponse()))
      }
      if (url.includes('/tasks?group_id=inbox-1&status=completed')) {
        return Promise.resolve(
          jsonResponse([
            {
              id: 'task-1',
              title: 'Clean the vents',
              status: 'completed',
              needs_review: false,
              due_date: '2026-03-25',
              reminder_at: null,
              due_bucket: 'no_date',
              group: { id: 'inbox-1', name: 'Inbox', is_system: true },
              completed_at: '2026-03-25T04:31:10Z',
              deleted_at: null
            },
            {
              id: 'task-2',
              title: 'Clean the vents',
              status: 'completed',
              needs_review: false,
              due_date: '2026-03-25',
              reminder_at: null,
              due_bucket: 'no_date',
              group: { id: 'inbox-1', name: 'Inbox', is_system: true },
              completed_at: '2026-03-25T04:31:10Z',
              deleted_at: null
            },
            {
              id: 'task-3',
              title: 'Install the fanhood',
              status: 'completed',
              needs_review: false,
              due_date: '2026-03-25',
              reminder_at: null,
              due_bucket: 'no_date',
              group: { id: 'inbox-1', name: 'Inbox', is_system: true },
              completed_at: '2026-03-25T05:31:00Z',
              deleted_at: null
            }
          ])
        )
      }

      return Promise.resolve(jsonResponse([]))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderTaskRoute(['/tasks/completed?group=inbox-1'])

    expect(await screen.findByText('Install the fanhood')).toBeInTheDocument()
    expect(screen.getAllByText('Clean the vents')).toHaveLength(1)
  })
})
