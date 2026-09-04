import { render, screen, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { MemoryRouter } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { DesktopTaskDetailModal } from '../components/DesktopTaskDetailModal'
import { NotificationsProvider } from '../components/Notifications'
import {
  createSubtask,
  getTaskDetail,
  updateSubtask,
  updateTask,
  type GroupSummary,
  type SessionStatus,
  type TaskDetail,
} from '../lib/api'

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return {
    ...actual,
    createSubtask: vi.fn(),
    deleteSubtask: vi.fn(),
    getTaskDetail: vi.fn(),
    updateSubtask: vi.fn(),
    updateTask: vi.fn(),
  }
})

const mockedCreateSubtask = vi.mocked(createSubtask)
const mockedGetTaskDetail = vi.mocked(getTaskDetail)
const mockedUpdateSubtask = vi.mocked(updateSubtask)
const mockedUpdateTask = vi.mocked(updateTask)

const session: SessionStatus = {
  signed_in: true,
  user: { id: 'user-1', email: 'user@example.com', display_name: 'Gust User' },
  timezone: 'UTC',
  inbox_group_id: 'inbox-1',
  csrf_token: 'csrf-token',
}

const groups: GroupSummary[] = [
  {
    id: 'inbox-1',
    name: 'Inbox',
    description: null,
    is_system: true,
    system_key: 'inbox',
    open_task_count: 1,
    completed_task_count: 0,
  },
]

function createClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

function buildTask(overrides: Partial<TaskDetail> = {}): TaskDetail {
  return {
    id: 'task-1',
    title: 'Review extraction contract',
    description: 'Check the structured output rules before rollout.',
    series_id: null,
    status: 'open',
    needs_review: true,
    due_date: null,
    reminder_at: null,
    due_bucket: 'no_date',
    group: { id: 'inbox-1', name: 'Inbox', is_system: true },
    completed_at: null,
    deleted_at: null,
    created_at: '2026-05-15T12:00:00.000Z',
    updated_at: '2026-05-15T12:00:00.000Z',
    recurrence_frequency: null,
    recurrence: null,
    subtasks: [
      {
        id: 'subtask-1',
        title: 'Check retry contract',
        is_completed: false,
        completed_at: null,
      },
    ],
    subtask_count: 1,
    ...overrides,
  }
}

function renderDesktopEditor(task = buildTask()) {
  mockedGetTaskDetail.mockResolvedValue(task)

  return render(
    <QueryClientProvider client={createClient()}>
      <NotificationsProvider>
        <MemoryRouter>
          <DesktopTaskDetailModal
            taskId="task-1"
            isOpen
            onClose={vi.fn()}
            session={session}
            groups={groups}
          />
        </MemoryRouter>
      </NotificationsProvider>
    </QueryClientProvider>
  )
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('DesktopTaskDetailModal', () => {
  it('edits task fields in the desktop modal without using the full-page route', async () => {
    const user = userEvent.setup()
    const savedTask = buildTask({
      due_date: '2026-05-15',
      reminder_at: '2026-05-15T16:00:00.000Z',
      recurrence_frequency: 'weekly',
      recurrence: { frequency: 'weekly', weekday: 5, day_of_month: null, month: null },
    })
    mockedUpdateTask.mockResolvedValue(savedTask)
    renderDesktopEditor()

    expect(await screen.findByRole('dialog', { name: 'Review extraction contract' })).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /Open full page/i })).toHaveAttribute(
      'href',
      '/desktop/tasks/task-1'
    )
    expect(screen.getByRole('button', { name: 'None' })).toHaveClass('bg-primary')

    await user.click(screen.getByRole('button', { name: 'Select a date' }))
    await user.click(await screen.findByRole('button', { name: 'Today' }))
    await user.click(screen.getByRole('button', { name: 'Select date & time' }))
    await user.click((await screen.findAllByRole('button', { name: 'Today' })).at(-1)!)
    await user.click(screen.getByRole('button', { name: 'Done' }))
    await user.click(screen.getByRole('button', { name: 'Weekly' }))
    expect(screen.getByRole('button', { name: 'Weekly' })).toHaveClass('bg-primary')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(mockedUpdateTask).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({
        title: 'Review extraction contract',
        group_id: 'inbox-1',
        due_date: expect.stringMatching(/^\d{4}-\d{2}-\d{2}$/) as string,
        reminder_at: expect.any(String) as string,
        recurrence: expect.objectContaining({ frequency: 'weekly' }) as object,
      }),
      'csrf-token'
    )
  })

  it('adds and updates subtasks from the desktop modal', async () => {
    const user = userEvent.setup()
    mockedCreateSubtask.mockResolvedValue({
      id: 'subtask-2',
      title: 'Confirm review badge copy',
      is_completed: false,
      completed_at: null,
    })
    mockedUpdateSubtask.mockResolvedValue({
      id: 'subtask-1',
      title: 'Check retry contract',
      is_completed: true,
      completed_at: '2026-05-15T12:00:00Z',
    })
    renderDesktopEditor()

    const subtaskInput = await screen.findByRole('textbox', { name: 'Subtask Check retry contract' })
    await user.click(screen.getByRole('button', { name: 'Toggle Check retry contract' }))
    expect(mockedUpdateSubtask).toHaveBeenCalledWith(
      'task-1',
      'subtask-1',
      { is_completed: true },
      'csrf-token'
    )

    await user.type(within(subtaskInput.closest('section')!).getByPlaceholderText('Add a subtask...'), 'Confirm review badge copy')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    expect(mockedCreateSubtask).toHaveBeenCalledWith(
      'task-1',
      'Confirm review badge copy',
      'csrf-token'
    )
  })

  it('automatically shifts reminder to new due date when due date is changed for a task with a reminder', async () => {
    const user = userEvent.setup()
    const today = new Date()
    const overdueDate = new Date(today)
    overdueDate.setDate(today.getDate() - 2)
    const futureDate = new Date(today)
    futureDate.setDate(today.getDate() + 5)
    const dateToken = (value: Date) => value.toISOString().slice(0, 10)
    const overdueToken = dateToken(overdueDate)
    const futureToken = dateToken(futureDate)
    const taskWithReminder = buildTask({
      due_date: overdueToken,
      reminder_at: `${overdueToken}T14:30:00.000Z`,
    })
    const updatedTask = buildTask({
      due_date: futureToken,
      reminder_at: `${futureToken}T14:30:00.000Z`,
    })
    mockedUpdateTask.mockResolvedValue(updatedTask)
    renderDesktopEditor(taskWithReminder)

    expect(await screen.findByRole('dialog', { name: 'Review extraction contract' })).toBeInTheDocument()

    const dueDateLabel = new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric',
      year: 'numeric',
    }).format(overdueDate)
    const dueDateBtn = screen.getByRole('button', { name: dueDateLabel })
    await user.click(dueDateBtn)
    if (futureDate.getMonth() !== overdueDate.getMonth()) {
      await user.click(await screen.findByRole('button', { name: 'next month' }))
    }
    await user.click(await screen.findByRole('button', { name: String(futureDate.getDate()) }))

    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(mockedUpdateTask).toHaveBeenCalledWith(
      'task-1',
      expect.objectContaining({
        due_date: futureToken,
        reminder_at: `${futureToken}T14:30:00.000Z`,
      }),
      'csrf-token'
    )
  })
})
