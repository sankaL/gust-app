import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppShell } from '../components/AppShell'
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
  vi.unstubAllGlobals()
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
    expect(screen.getByText('Needs review')).toBeInTheDocument()
    expect(fetchMock).toHaveBeenCalledWith(
      expect.stringContaining('/tasks?group_id=personal-1'),
      expect.objectContaining({ credentials: 'include' })
    )
  })

  it('supports delete undo restore from the task list', async () => {
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
      if (url.endsWith('/tasks/task-1') && method === 'DELETE') {
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
            deleted_at: '2026-03-22T12:00:00Z',
            recurrence: null,
            subtasks: []
          })
        )
      }
      if (url.endsWith('/tasks/task-1/restore')) {
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

    expect(await screen.findByText('Swipe left to delete')).toBeInTheDocument()
    await userEvent
      .setup()
      .click(screen.getByRole('button', { name: 'Delete Review extraction contract' }))

    expect(
      await screen.findByText(/Deleted Review extraction contract/i)
    ).toBeInTheDocument()
    await userEvent.setup().click(screen.getByRole('button', { name: 'Undo' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/tasks/task-1/restore'),
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

    const overdueTitle = await screen.findByText('Renew passport')
    const overdueCard = overdueTitle.closest('article')
    const todayCard = screen.getByText('Submit reimbursement').closest('article')
    const tomorrowCard = screen.getByText('Call landlord').closest('article')

    expect(overdueCard).not.toBeNull()
    expect(todayCard).not.toBeNull()
    expect(tomorrowCard).not.toBeNull()
    expect(within(overdueCard as HTMLElement).getByText('Overdue')).toBeInTheDocument()
    expect(within(todayCard as HTMLElement).getByText('Today')).toBeInTheDocument()
    expect(within(tomorrowCard as HTMLElement).getByText('Tomorrow')).toBeInTheDocument()
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
            needs_review: false,
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
    const user = userEvent.setup()

    const dueDateInput = await screen.findByLabelText('Due date')
    await user.clear(dueDateInput)
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    await waitFor(() => {
      const patchCall = fetchMock.mock.calls.find(
        ([input, init]) =>
          requestUrl(input).endsWith('/tasks/task-1') && init?.method === 'PATCH'
      )
      expect(patchCall).toBeDefined()
      expect(patchCall?.[1]?.body).toContain('"due_date":null')
      expect(patchCall?.[1]?.body).toContain('"reminder_at":null')
      expect(patchCall?.[1]?.body).toContain('"recurrence":null')
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
      if (url.endsWith('/groups') && method === 'POST') {
        return Promise.resolve(
          jsonResponse(
            {
              id: 'travel-1',
              name: 'Travel',
              description: 'Trips',
              is_system: false,
              system_key: null,
              open_task_count: 0
            },
            { status: 201 }
          )
        )
      }
      if (url.endsWith('/groups/personal-1') && method === 'PATCH') {
        return Promise.resolve(
          jsonResponse({
            id: 'personal-1',
            name: 'Personal Admin',
            description: 'Home',
            is_system: false,
            system_key: null,
            open_task_count: 2
          })
        )
      }
      return Promise.resolve(jsonResponse({ deleted: true }))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderTaskRoute(['/tasks/groups?group=inbox-1'])
    const user = userEvent.setup()

    expect(await screen.findByText('Locked Inbox')).toBeInTheDocument()
    await user.type(screen.getByPlaceholderText('Group name'), 'Travel')
    await user.type(screen.getByPlaceholderText('Optional description for AI routing'), 'Trips')
    await user.click(screen.getByRole('button', { name: 'Create Group' }))

    const personalInputs = screen.getAllByDisplayValue('Personal')
    await user.clear(personalInputs[0])
    await user.type(personalInputs[0], 'Personal Admin')
    await user.click(screen.getAllByRole('button', { name: 'Save Group' })[1])

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/groups/personal-1'),
        expect.objectContaining({ method: 'PATCH', credentials: 'include' })
      )
    })
  })

  it('preserves unsaved task edits when a subtask mutation refetches detail', async () => {
    let taskTitle = 'Refine design system'
    const subtasks = [
      { id: 'subtask-1', title: 'Audit tokens', is_completed: false, completed_at: null }
    ]

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
            title: taskTitle,
            status: 'open',
            needs_review: false,
            due_date: null,
            reminder_at: null,
            due_bucket: 'no_date',
            group: { id: 'inbox-1', name: 'Inbox', is_system: true },
            completed_at: null,
            deleted_at: null,
            recurrence: null,
            subtasks
          })
        )
      }
      if (url.endsWith('/tasks/task-1/subtasks') && method === 'POST') {
        subtasks.push({
          id: 'subtask-2',
          title: 'Document spacing changes',
          is_completed: false,
          completed_at: null
        })
        return Promise.resolve(
          jsonResponse(
            {
              id: 'subtask-2',
              title: 'Document spacing changes',
              is_completed: false,
              completed_at: null
            },
            { status: 201 }
          )
        )
      }

      return Promise.resolve(jsonResponse([]))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderTaskRoute(['/tasks/task-1?group=inbox-1'])
    const user = userEvent.setup()

    const titleInput = await screen.findByLabelText('Task title')
    await user.clear(titleInput)
    await user.type(titleInput, 'Refine launch design system')
    await user.type(screen.getByPlaceholderText('Add a subtask...'), 'Document spacing changes')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/tasks/task-1/subtasks'),
        expect.objectContaining({ method: 'POST', credentials: 'include' })
      )
    })

    await act(async () => {
      await Promise.resolve()
    })

    expect(screen.getByLabelText('Task title')).toHaveValue('Refine launch design system')
  })
})
