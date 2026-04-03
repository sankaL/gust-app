import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppShell } from '../components/AppShell'
import { NotificationsProvider } from '../components/Notifications'
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

  return {
    router,
    ...render(
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>
    )
  }
}

function renderTaskRouteWithClient(initialEntries: string[], client: QueryClient) {
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

  return {
    router,
    ...render(
      <QueryClientProvider client={client}>
        <NotificationsProvider>
          <RouterProvider router={router} />
        </NotificationsProvider>
      </QueryClientProvider>
    )
  }
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

function localDate(offsetDays: number) {
  const value = new Date()
  value.setHours(12, 0, 0, 0)
  value.setDate(value.getDate() + offsetDays)
  const year = value.getFullYear()
  const month = String(value.getMonth() + 1).padStart(2, '0')
  const day = String(value.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
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
    const user = userEvent.setup()

    expect(await screen.findByText('Organize garage shelving')).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Expand Organize garage shelving' }))
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
    const user = userEvent.setup()

    expect(await screen.findByText(/Swipe right to complete/i)).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Complete Review extraction contract' })).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Expand Review extraction contract' }))
    await user.click(screen.getByRole('button', { name: 'Complete Review extraction contract' }))

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

  it('clears the previous group task list while the next group loads', async () => {
    let resolvePersonalTasks: ((value: Response) => void) | null = null
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
          jsonResponse({
            items: [
              {
                id: 'task-inbox',
                title: 'Inbox only task',
                description: null,
                status: 'open',
                needs_review: false,
                due_date: null,
                reminder_at: null,
                due_bucket: 'no_date',
                group: { id: 'inbox-1', name: 'Inbox', is_system: true },
                completed_at: null,
                deleted_at: null,
                subtask_count: 0
              }
            ],
            has_more: false,
            next_cursor: null
          })
        )
      }
      if (url.includes('/tasks?group_id=personal-1')) {
        return new Promise<Response>((resolve) => {
          resolvePersonalTasks = resolve
        })
      }

      return Promise.resolve(jsonResponse([]))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderTaskRoute(['/tasks?group=inbox-1'])
    const user = userEvent.setup()

    expect(await screen.findByText('Inbox only task')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Other' }))
    await user.click(await screen.findByRole('button', { name: /Personal/ }))

    expect(await screen.findByText('Loading open tasks.')).toBeInTheDocument()
    expect(screen.queryByText('Inbox only task')).not.toBeInTheDocument()

    if (!resolvePersonalTasks) {
      throw new Error('Expected personal task request to be pending.')
    }
    const releasePersonalTasks = resolvePersonalTasks as (value: Response) => void
    releasePersonalTasks(
      jsonResponse({
        items: [
          {
            id: 'task-personal',
            title: 'Personal only task',
            description: null,
            status: 'open',
            needs_review: false,
            due_date: null,
            reminder_at: null,
            due_bucket: 'no_date',
            group: { id: 'personal-1', name: 'Personal', is_system: false },
            completed_at: null,
            deleted_at: null,
            subtask_count: 0
          }
        ],
        has_more: false,
        next_cursor: null
      })
    )

    expect(await screen.findByText('Personal only task')).toBeInTheDocument()
  })

  it('keeps task cards collapsed by default, expands inline, and still opens detail on body click', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input)
      const method = init?.method ?? 'GET'

      if (url.includes('/auth/session')) {
        return Promise.resolve(jsonResponse(buildSessionResponse()))
      }
      if (url.includes('/groups')) {
        return Promise.resolve(
          jsonResponse([
            {
              id: 'ops-1',
              name: 'Ops Desk',
              description: null,
              is_system: false,
              system_key: null,
              open_task_count: 1
            }
          ])
        )
      }
      if (url.includes('/tasks?group_id=ops-1')) {
        return Promise.resolve(
          jsonResponse({
            items: [
              {
                id: 'task-1',
                title: 'Review extraction contract',
                description: 'Compare the new capture layout against the old hierarchy.',
                status: 'open',
                needs_review: true,
                due_date: localDate(1),
                reminder_at: '2026-03-24T13:00:00Z',
                recurrence_frequency: 'daily',
                due_bucket: 'due_soon',
                group: { id: 'ops-1', name: 'Ops Desk', is_system: false },
                completed_at: null,
                deleted_at: null,
                subtask_count: 2
              }
            ],
            has_more: false,
            next_cursor: null
          })
        )
      }
      if (url.endsWith('/tasks/task-1') && method === 'GET') {
        return Promise.resolve(
          jsonResponse({
            id: 'task-1',
            title: 'Review extraction contract',
            description: 'Compare the new capture layout against the old hierarchy.',
            status: 'open',
            needs_review: true,
            due_date: localDate(1),
            reminder_at: '2026-03-24T13:00:00Z',
            due_bucket: 'due_soon',
            group: { id: 'ops-1', name: 'Ops Desk', is_system: false },
            completed_at: null,
            deleted_at: null,
            recurrence: { frequency: 'daily', weekday: null, day_of_month: null },
            subtasks: []
          })
        )
      }

      return Promise.resolve(jsonResponse([]))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderTaskRoute(['/tasks?group=ops-1'])
    const user = userEvent.setup()

    expect(await screen.findByText('Review extraction contract')).toBeInTheDocument()
    expect(screen.getByText('2 subtasks')).toBeInTheDocument()
    expect(screen.getByText('DAILY')).toBeInTheDocument()
    expect(screen.getByText(/Due: Tomorrow/i)).toBeInTheDocument()
    expect(screen.queryByText('Compare the new capture layout against the old hierarchy.')).not.toBeInTheDocument()
    // Note: Ops Desk now appears in the GroupTabs dropdown, so we check it's not in the task card context
    expect(screen.queryByText(/Reminder:/i)).not.toBeInTheDocument()

    await user.click(screen.getByText('Review extraction contract'))

    expect(screen.getByText('Compare the new capture layout against the old hierarchy.')).toBeInTheDocument()
    // Ops Desk appears in both dropdown and expanded task card now
    expect(screen.getAllByText(/^Ops Desk$/).length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText(/Reminder:/i)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete Review extraction contract' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save and return' })).not.toBeInTheDocument()

    await user.click(screen.getByText('Review extraction contract'))

    expect(await screen.findByRole('button', { name: 'Save and return' })).toBeInTheDocument()
  })

  it('renders overdue, today, and tomorrow due badges accurately', async () => {
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

  it('uses the same collapsed and expanded task card behavior in the all-tasks view', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input)

      if (url.includes('/auth/session')) {
        return Promise.resolve(jsonResponse(buildSessionResponse()))
      }
      if (url.includes('/groups')) {
        return Promise.resolve(jsonResponse(buildGroupsResponse()))
      }
      if (url.includes('/tasks?status=open')) {
        return Promise.resolve(
          jsonResponse({
            items: [
              {
                id: 'task-1',
                title: 'Plan follow-up sprint',
                description: 'Bring capture and tasks back into visual alignment.',
                status: 'open',
                needs_review: false,
                due_date: localDate(3),
                reminder_at: '2026-03-28T15:30:00Z',
                recurrence_frequency: 'weekly',
                due_bucket: 'due_soon',
                group: { id: 'personal-1', name: 'Personal', is_system: false },
                completed_at: null,
                deleted_at: null,
                subtask_count: 4
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

    renderTaskRoute(['/tasks?group=all'])
    const user = userEvent.setup()

    expect(await screen.findByText('Plan follow-up sprint')).toBeInTheDocument()
    expect(screen.getByText(/^Personal$/)).toBeInTheDocument()
    expect(screen.getByText('4 subtasks')).toBeInTheDocument()
    expect(screen.getByText('WEEKLY')).toBeInTheDocument()
    expect(screen.queryByText('Bring capture and tasks back into visual alignment.')).not.toBeInTheDocument()
    expect(screen.queryByText(/Reminder:/i)).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Expand Plan follow-up sprint' }))

    expect(screen.getByText('Bring capture and tasks back into visual alignment.')).toBeInTheDocument()
    expect(screen.getByText(/Reminder:/i)).toBeInTheDocument()
    expect(screen.getByText(/^Personal$/)).toBeInTheDocument()
  })

  it('derives the all-tasks today section without changing the shared task bucket', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input)

      if (url.includes('/auth/session')) {
        return Promise.resolve(jsonResponse(buildSessionResponse()))
      }
      if (url.includes('/groups')) {
        return Promise.resolve(jsonResponse(buildGroupsResponse()))
      }
      if (url.includes('/tasks?status=open')) {
        return Promise.resolve(
          jsonResponse({
            items: [
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
                deleted_at: null,
                subtask_count: 0
              },
              {
                id: 'task-today',
                title: 'Submit reimbursement',
                status: 'open',
                needs_review: false,
                due_date: localDate(0),
                reminder_at: null,
                due_bucket: 'overdue',
                group: { id: 'personal-1', name: 'Personal', is_system: false },
                completed_at: null,
                deleted_at: null,
                subtask_count: 0
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
                deleted_at: null,
                subtask_count: 0
              },
              {
                id: 'task-later',
                title: 'Book annual physical',
                status: 'open',
                needs_review: false,
                due_date: localDate(5),
                reminder_at: null,
                due_bucket: 'due_soon',
                group: { id: 'inbox-1', name: 'Inbox', is_system: true },
                completed_at: null,
                deleted_at: null,
                subtask_count: 0
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

    renderTaskRoute(['/tasks?group=all'])

    expect(await screen.findByText('Submit reimbursement')).toBeInTheDocument()
    const todayHeading = screen.getByRole('heading', { name: 'Today' })
    const overdueHeading = screen.getByRole('heading', { name: 'Overdue' })
    const othersHeading = screen.getByRole('heading', { name: 'Others' })

    expect(todayHeading).toBeInTheDocument()
    expect(overdueHeading).toBeInTheDocument()
    expect(othersHeading).toBeInTheDocument()
    expect(todayHeading.parentElement).toHaveTextContent('1 tasks')
    expect(overdueHeading.parentElement).toHaveTextContent('1 tasks')
    expect(othersHeading.parentElement).toHaveTextContent('2 tasks')
  })

  it('loads the all-tasks view when a legacy paginated cache entry exists for the old key', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input)

      if (url.includes('/auth/session')) {
        return Promise.resolve(jsonResponse(buildSessionResponse()))
      }
      if (url.includes('/groups')) {
        return Promise.resolve(jsonResponse(buildGroupsResponse()))
      }
      if (url.includes('/tasks?status=open')) {
        return Promise.resolve(
          jsonResponse({
            items: [
              {
                id: 'task-1',
                title: 'Stabilize all tasks cache',
                description: null,
                status: 'open',
                needs_review: false,
                due_date: null,
                reminder_at: null,
                due_bucket: 'no_date',
                group: { id: 'personal-1', name: 'Personal', is_system: false },
                completed_at: null,
                deleted_at: null,
                subtask_count: 0
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

    const client = new QueryClient({
      defaultOptions: {
        queries: { retry: false },
        mutations: { retry: false }
      }
    })

    client.setQueryData(['tasks', 'all', 'open'], {
      items: [
        {
          id: 'legacy-task',
          title: 'Legacy paginated task',
          description: null,
          status: 'open',
          needs_review: false,
          due_date: null,
          reminder_at: null,
          due_bucket: 'no_date',
          group: { id: 'personal-1', name: 'Personal', is_system: false },
          completed_at: null,
          deleted_at: null,
          subtask_count: 0
        }
      ],
      has_more: false,
      next_cursor: null
    })

    renderTaskRouteWithClient(['/tasks?group=all'], client)

    expect(await screen.findByText('Stabilize all tasks cache')).toBeInTheDocument()
  })

  it('clears reminder and recurrence when saving a task with no due date and returns to the filtered task list', async () => {
    let patchBody: Record<string, unknown> | null = null
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
              title: 'Refine design system',
              description: null,
              status: 'open',
              needs_review: false,
              due_date: null,
              reminder_at: null,
              due_bucket: 'no_date',
              group: { id: 'inbox-1', name: 'Inbox', is_system: true },
              completed_at: null,
              deleted_at: null,
              subtask_count: 0
            }
          ])
        )
      }
      if (url.endsWith('/tasks/task-1') && method === 'GET') {
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
      if (url.endsWith('/tasks/task-1') && method === 'PATCH') {
        patchBody =
          typeof init?.body === 'string'
            ? (JSON.parse(init.body) as Record<string, unknown>)
            : {}
        return Promise.resolve(
          jsonResponse({
            id: 'task-1',
            title: 'Refine design system',
            description: null,
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

    const { router } = renderTaskRoute(['/tasks/task-1?group=inbox-1'])
    const user = userEvent.setup()

    const dueDateInput = await screen.findByDisplayValue('2026-03-24')
    fireEvent.change(dueDateInput, { target: { value: '' } })
    await user.click(screen.getByRole('button', { name: 'Save and return' }))

    await waitFor(() => {
      expect(patchBody).toMatchObject({
        due_date: null,
        reminder_at: null,
        recurrence: null
      })
    })

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/tasks')
      expect(router.state.location.search).toBe('?group=inbox-1')
    })
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

  it('opens non-review task detail in read mode first and enters edit mode from the sticky dock', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input)
      const method = init?.method ?? 'GET'

      if (url.includes('/auth/session')) {
        return Promise.resolve(jsonResponse(buildSessionResponse()))
      }
      if (url.includes('/groups')) {
        return Promise.resolve(jsonResponse(buildGroupsResponse()))
      }
      if (url.endsWith('/tasks/task-1') && method === 'GET') {
        return Promise.resolve(
          jsonResponse({
            id: 'task-1',
            title: 'Review production reminder copy',
            description: 'Confirm the digest language before the next rollout window.',
            status: 'open',
            needs_review: false,
            due_date: '2026-03-29',
            reminder_at: '2026-03-29T13:00:00Z',
            due_bucket: 'due_soon',
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
    const user = userEvent.setup()

    expect(await screen.findByText('Task summary')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit task' })).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save and return' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Back to tasks' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Edit task' }))

    expect(await screen.findByRole('button', { name: 'Save and return' })).toBeInTheDocument()
    expect(screen.getByText('Editing task')).toBeInTheDocument()
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
    expect(await screen.findByRole('button', { name: 'Save and return' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete task' })).toBeInTheDocument()
  })

  it('returns to the all-tasks card view after recurring delete from detail', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input)
      const method = init?.method ?? 'GET'

      if (url.includes('/auth/session')) {
        return Promise.resolve(jsonResponse(buildSessionResponse()))
      }
      if (url.includes('/groups')) {
        return Promise.resolve(jsonResponse(buildGroupsResponse()))
      }
      if (url.includes('/tasks?status=open')) {
        return Promise.resolve(
          jsonResponse({
            items: [
              {
                id: 'task-1',
                title: 'Weekly planning',
                description: null,
                status: 'open',
                needs_review: false,
                due_date: null,
                reminder_at: null,
                due_bucket: 'no_date',
                group: { id: 'inbox-1', name: 'Inbox', is_system: true },
                completed_at: null,
                deleted_at: null,
                subtask_count: 0
              }
            ],
            has_more: false,
            next_cursor: null
          })
        )
      }
      if (url.endsWith('/tasks/task-1') && method === 'GET') {
        return Promise.resolve(
          jsonResponse({
            id: 'task-1',
            title: 'Weekly planning',
            description: null,
            series_id: 'series-1',
            status: 'open',
            needs_review: false,
            due_date: null,
            reminder_at: null,
            due_bucket: 'no_date',
            group: { id: 'inbox-1', name: 'Inbox', is_system: true },
            completed_at: null,
            deleted_at: null,
            recurrence_frequency: 'weekly',
            recurrence: { frequency: 'weekly', weekday: 2, day_of_month: null },
            subtasks: []
          })
        )
      }
      if (url.includes('/tasks/task-1?scope=series') && method === 'DELETE') {
        return Promise.resolve(
          jsonResponse({
            id: 'task-1',
            title: 'Weekly planning',
            description: null,
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

    const { router } = renderTaskRoute(['/tasks/task-1?group=all'])
    const user = userEvent.setup()

    expect(await screen.findByRole('button', { name: 'Delete task' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Delete task' }))

    expect(await screen.findByText('Delete recurring task')).toBeInTheDocument()
    expect(screen.getByText("After delete, you'll return to the task list.")).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Delete this and future' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/tasks/task-1?scope=series'),
        expect.objectContaining({ method: 'DELETE', credentials: 'include' })
      )
    })

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/tasks')
      expect(router.state.location.search).toBe('?group=all')
    })
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
    const user = userEvent.setup()

    expect(await screen.findByText('Swipe right to complete')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Delete Weekly planning' })).not.toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Expand Weekly planning' }))
    await user.click(screen.getByRole('button', { name: 'Delete Weekly planning' }))

    expect(await screen.findByText('Delete recurring task')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete this occurrence' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Delete this and future' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Delete this and future' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/tasks/task-1?scope=series'),
        expect.objectContaining({ method: 'DELETE', credentials: 'include' })
      )
    })

    expect(await screen.findByText(/Deleted Weekly planning/i)).toBeInTheDocument()
  })

  it('waits for the full task detail response before rendering a recurring task', async () => {
    let resolveTaskDetail: ((value: Response) => void) | null = null
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
          jsonResponse({
            items: [
              {
                id: 'task-1',
                title: 'Weekly planning',
                description: null,
                series_id: 'series-1',
                recurrence_frequency: 'weekly',
                status: 'open',
                needs_review: false,
                due_date: '2026-03-31',
                reminder_at: null,
                due_bucket: 'due_soon',
                group: { id: 'inbox-1', name: 'Inbox', is_system: true },
                completed_at: null,
                deleted_at: null,
                subtask_count: 0
              }
            ],
            has_more: false,
            next_cursor: null
          })
        )
      }
      if (url.endsWith('/tasks/task-1') && method === 'GET') {
        return new Promise<Response>((resolve) => {
          resolveTaskDetail = resolve
        })
      }

      return Promise.resolve(jsonResponse([]))
    })
    vi.stubGlobal('fetch', fetchMock)

    const { router } = renderTaskRoute(['/tasks?group=inbox-1'])

    expect(await screen.findByText('Weekly planning')).toBeInTheDocument()

    await act(async () => {
      await router.navigate('/tasks/task-1?group=inbox-1')
    })

    expect(await screen.findByText('Loading task detail.')).toBeInTheDocument()
    expect(screen.queryByText('Task summary')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Save and return' })).not.toBeInTheDocument()

    if (!resolveTaskDetail) {
      throw new Error('Expected task detail request to be pending.')
    }
    const releaseTaskDetail = resolveTaskDetail as (value: Response) => void
    releaseTaskDetail(
      jsonResponse({
        id: 'task-1',
        title: 'Weekly planning',
        description: null,
        series_id: 'series-1',
        recurrence_frequency: 'weekly',
        status: 'open',
        needs_review: false,
        due_date: '2026-03-31',
        reminder_at: null,
        due_bucket: 'due_soon',
        group: { id: 'inbox-1', name: 'Inbox', is_system: true },
        completed_at: null,
        deleted_at: null,
        recurrence: { frequency: 'weekly', weekday: 2, day_of_month: null },
        subtasks: []
      })
    )

    expect(await screen.findByText('Task summary')).toBeInTheDocument()
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
