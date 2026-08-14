import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'

import { TaskPreviewModal } from '../components/TaskPreviewModal'
import { deleteSubtask, getTaskDetail, type TaskDetail } from '../lib/api'

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return {
    ...actual,
    deleteSubtask: vi.fn(),
    getTaskDetail: vi.fn(),
  }
})

const mockedGetTaskDetail = vi.mocked(getTaskDetail)
const mockedDeleteSubtask = vi.mocked(deleteSubtask)

function createClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
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
    due_date: '2026-05-18',
    reminder_at: '2026-05-18T14:30:00Z',
    due_bucket: 'due_soon',
    group: { id: 'inbox-1', name: 'Inbox', is_system: true },
    completed_at: null,
    deleted_at: null,
    created_at: '2026-05-15T12:00:00.000Z',
    updated_at: '2026-05-15T12:00:00.000Z',
    recurrence_frequency: 'weekly',
    recurrence: {
      frequency: 'weekly',
      weekday: 1,
      day_of_month: null,
      month: null,
    },
    subtasks: [
      {
        id: 'subtask-1',
        title: 'Check retry contract',
        is_completed: false,
        completed_at: null,
      },
      {
        id: 'subtask-2',
        title: 'Confirm review badge copy',
        is_completed: true,
        completed_at: '2026-05-17T12:00:00Z',
      },
    ],
    subtask_count: 2,
    ...overrides,
  }
}

function renderModal(
  props: Partial<ComponentProps<typeof TaskPreviewModal>> = {},
  client = createClient()
) {
  return render(
    <QueryClientProvider client={client}>
      <MemoryRouter initialEntries={['/tasks?task=task-1']}>
        <Routes>
          <Route
            path="/tasks"
            element={
              <>
                <TaskPreviewModal
                  taskId="task-1"
                  isOpen
                  onClose={vi.fn()}
                  {...props}
                />
                <div>Task list route</div>
              </>
            }
          />
          <Route path="/tasks/:taskId" element={<div>Dedicated task page</div>} />
        </Routes>
      </MemoryRouter>
    </QueryClientProvider>
  )
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('TaskPreviewModal', () => {
  it('renders loading and then loaded task information architecture', async () => {
    mockedGetTaskDetail.mockResolvedValue(buildTask())

    renderModal({
      session: {
        signed_in: true,
        user: { id: 'user-1', email: 'user@example.com', display_name: null },
        timezone: 'America/Toronto',
        inbox_group_id: 'inbox-1',
        csrf_token: 'csrf-token',
      },
      groups: [
        {
          id: 'inbox-1',
          name: 'Inbox',
          description: null,
          is_system: true,
          system_key: 'inbox',
          open_task_count: 1,
          completed_task_count: 0,
        },
      ],
    })

    expect(screen.getByText('Loading task')).toBeInTheDocument()
    expect(await screen.findByRole('heading', { name: 'Review extraction contract' })).toBeInTheDocument()
    expect(screen.getByRole('heading', { name: 'Review extraction contract' })).toHaveClass('pl-3.5')
    expect(screen.getByText('Needs review')).toBeInTheDocument()
    expect(screen.getByText('Inbox')).toBeInTheDocument()
    expect(screen.getByText('Check the structured output rules before rollout.')).toBeInTheDocument()
    expect(screen.getAllByText('2 subtasks')).toHaveLength(2)
    expect(screen.getByText('Check retry contract')).toBeInTheDocument()
    expect(screen.getByText('Confirm review badge copy')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
  })

  it('edits the title directly from the preview heading', async () => {
    const user = userEvent.setup()
    mockedGetTaskDetail.mockResolvedValue(buildTask())

    renderModal({
      session: {
        signed_in: true,
        user: { id: 'user-1', email: 'user@example.com', display_name: null },
        timezone: 'America/Toronto',
        inbox_group_id: 'inbox-1',
        csrf_token: 'csrf-token',
      },
      groups: [
        {
          id: 'inbox-1',
          name: 'Inbox',
          description: null,
          is_system: true,
          system_key: 'inbox',
          open_task_count: 1,
          completed_task_count: 0,
        },
      ],
    })

    await user.click(await screen.findByRole('button', { name: 'Review extraction contract' }))
    expect(screen.getByRole('textbox', { name: 'Task title' })).toHaveValue('Review extraction contract')
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument()
  })

  it('shows a sanitized error state when detail loading fails', async () => {
    mockedGetTaskDetail.mockRejectedValue(new Error('Preview failed.'))

    renderModal()

    expect(await screen.findByText('Preview failed.')).toBeInTheDocument()
  })

  it('closes from Escape and the close button', async () => {
    const user = userEvent.setup()
    const onClose = vi.fn()
    mockedGetTaskDetail.mockResolvedValue(buildTask())

    renderModal({ onClose })

    await screen.findByRole('heading', { name: 'Review extraction contract' })
    expect(screen.getByRole('button', { name: 'Close task preview' })).toHaveClass('clay-obsidian')
    await user.keyboard('{Escape}')
    expect(onClose).toHaveBeenCalledTimes(1)

    await user.click(screen.getByRole('button', { name: 'Close task preview' }))
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('does not expose the desktop-only full-page handoff', async () => {
    mockedGetTaskDetail.mockResolvedValue(buildTask())

    renderModal()

    await screen.findByRole('heading', { name: 'Review extraction contract' })
    expect(screen.queryByRole('link', { name: /Open full page/i })).not.toBeInTheDocument()
  })

  it('exposes quick actions for the current task status', async () => {
    const user = userEvent.setup()
    const onComplete = vi.fn()
    const onRestore = vi.fn()
    mockedGetTaskDetail.mockResolvedValue(buildTask())

    renderModal({ onComplete, onRestore })

    await user.click(await screen.findByRole('button', { name: 'Complete' }))
    expect(onComplete).toHaveBeenCalledWith(expect.objectContaining({ id: 'task-1' }))
    expect(screen.queryByRole('button', { name: 'Restore' })).not.toBeInTheDocument()
  })

  it('renders empty-subtask and completed restore states', async () => {
    mockedGetTaskDetail.mockResolvedValue(
      buildTask({
        status: 'completed',
        completed_at: '2026-05-18T15:00:00Z',
        subtasks: [],
        subtask_count: 0,
      })
    )

    renderModal({ onRestore: vi.fn() })

    expect(await screen.findByRole('button', { name: 'Restore' })).toBeInTheDocument()
    expect(screen.getByText('No subtasks yet.')).toBeInTheDocument()
  })

  it('deletes subtasks from the editable task preview modal', async () => {
    const user = userEvent.setup()
    mockedGetTaskDetail.mockResolvedValue(buildTask())
    mockedDeleteSubtask.mockResolvedValue({ deleted: true })

    renderModal({
      session: {
        signed_in: true,
        user: { id: 'user-1', email: 'user@example.com', display_name: null },
        timezone: 'America/Toronto',
        inbox_group_id: 'inbox-1',
        csrf_token: 'csrf-token',
      },
      groups: [
        {
          id: 'inbox-1',
          name: 'Inbox',
          description: null,
          is_system: true,
          system_key: 'inbox',
          open_task_count: 1,
          completed_task_count: 0,
        },
      ],
    })

    await user.click(await screen.findByRole('button', { name: 'Delete Check retry contract' }))

    expect(mockedDeleteSubtask).toHaveBeenCalledWith('task-1', 'subtask-1', 'csrf-token')
  })

  it('enters edit mode on double-clicking context and enables Save Changes upon editing', async () => {
    const user = userEvent.setup()
    mockedGetTaskDetail.mockResolvedValue(buildTask())

    renderModal({
      session: {
        signed_in: true,
        user: { id: 'user-1', email: 'user@example.com', display_name: null },
        timezone: 'America/Toronto',
        inbox_group_id: 'inbox-1',
        csrf_token: 'csrf-token',
      },
      groups: [
        {
          id: 'inbox-1',
          name: 'Inbox',
          description: null,
          is_system: true,
          system_key: 'inbox',
          open_task_count: 1,
          completed_task_count: 0,
        },
      ],
    })

    await screen.findByRole('heading', { name: 'Review extraction contract' })
    expect(screen.queryByLabelText('Task title')).not.toBeInTheDocument()

    // Double-click on the context card to enter edit mode
    await user.dblClick(screen.getByText('Check the structured output rules before rollout.'))

    // Now editable task inputs are rendered
    const titleInput = screen.getByLabelText('Task title')
    expect(titleInput).toBeInTheDocument()

    // Save Changes button is disabled when not dirty
    const saveButton = screen.getByRole('button', { name: 'Save changes' })
    expect(saveButton).toBeDisabled()

    // Edit title
    await user.clear(titleInput)
    await user.type(titleInput, 'Updated extraction contract')

    // Save button is now enabled
    expect(saveButton).toBeEnabled()
  })
})
