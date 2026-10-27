import { render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import userEvent from '@testing-library/user-event'
import { MemoryRouter, Route, Routes } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ComponentProps } from 'react'

import { TaskPreviewModal } from '../components/TaskPreviewModal'
import { deleteSubtask, getTaskDetail, updateSubtask, updateTask, type TaskDetail } from '../lib/api'

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return {
    ...actual,
    deleteSubtask: vi.fn(),
    getTaskDetail: vi.fn(),
    updateSubtask: vi.fn(),
    updateTask: vi.fn(),
  }
})

const mockedGetTaskDetail = vi.mocked(getTaskDetail)
const mockedDeleteSubtask = vi.mocked(deleteSubtask)
const mockedUpdateSubtask = vi.mocked(updateSubtask)
const mockedUpdateTask = vi.mocked(updateTask)

const editableProps = {
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
} satisfies Partial<ComponentProps<typeof TaskPreviewModal>>

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

function modalTree(props: Partial<ComponentProps<typeof TaskPreviewModal>>, client: QueryClient) {
  return (
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

function localDateToken(offsetDays: number, from = new Date()) {
  const date = new Date(from.getFullYear(), from.getMonth(), from.getDate() + offsetDays)
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`
}

/** The edit-mode property row (icon, label, control) whose label is `label`. */
function editRow(label: string) {
  return screen.getByText(label, { selector: 'span' }).parentElement as HTMLElement
}

function renderModal(
  props: Partial<ComponentProps<typeof TaskPreviewModal>> = {},
  client = createClient()
) {
  const view = render(modalTree(props, client))
  return { ...view, rerenderModal: (next: Partial<ComponentProps<typeof TaskPreviewModal>>) => view.rerender(modalTree(next, client)) }
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
    expect(screen.getByRole('dialog', { name: 'Review extraction contract' })).toHaveClass('sheet-h-default')
    expect(screen.getByText('Needs review')).toBeInTheDocument()
    expect(screen.getByText('Inbox')).toBeInTheDocument()
    expect(screen.getByText('Check the structured output rules before rollout.')).toBeInTheDocument()
    expect(screen.getByText('2 subtasks')).toBeInTheDocument()
    expect(screen.queryByText('Task preview')).not.toBeInTheDocument()
    expect(screen.queryByText('Open')).not.toBeInTheDocument()
    expect(screen.getByText('Notes')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Due date/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Reminder/ })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: /Repeats\s*Weekly/ })).toBeInTheDocument()
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

    await user.click(await screen.findByRole('button', { name: 'Edit title' }))
    expect(screen.getByRole('textbox', { name: 'Task title' })).toHaveValue('Review extraction contract')
    expect(screen.getByRole('button', { name: 'Save changes' })).toBeInTheDocument()
  })

  it('shows the title on one line and expands it on tap without entering edit mode', async () => {
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
    })

    const title = await screen.findByRole('button', { name: 'Review extraction contract' })
    expect(title).toHaveAttribute('aria-expanded', 'false')
    expect(title).toHaveClass('truncate')

    await user.click(title)
    expect(title).toHaveAttribute('aria-expanded', 'true')
    expect(title).not.toHaveClass('truncate')
    expect(screen.queryByRole('textbox', { name: 'Task title' })).not.toBeInTheDocument()

    await user.click(title)
    expect(title).toHaveAttribute('aria-expanded', 'false')
  })

  it('mutes empty task properties', async () => {
    mockedGetTaskDetail.mockResolvedValue(
      buildTask({ description: null, reminder_at: null, recurrence: null, recurrence_frequency: null })
    )

    renderModal()

    expect(await screen.findByText('No notes yet.')).toBeInTheDocument()
    expect(screen.getByText('No reminder')).toHaveClass('text-on-surface-variant/60')
    expect(screen.getByText('One-off')).toHaveClass('text-on-surface-variant/60')
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

    // Double-click the notes to enter edit mode
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

  it('keeps the read-only layout in edit mode, with controls in place of values', async () => {
    const user = userEvent.setup()
    mockedGetTaskDetail.mockResolvedValue(buildTask())

    renderModal(editableProps)

    await user.dblClick(await screen.findByText('Check the structured output rules before rollout.'))

    expect(screen.getByRole('textbox', { name: 'Task title' })).toHaveValue('Review extraction contract')
    expect(screen.getByText('Notes')).toBeInTheDocument()
    expect(screen.getByRole('textbox', { name: 'Task description' })).toHaveValue('Check the structured output rules before rollout.')
    for (const label of ['Due date', 'Reminder', 'Repeats', 'Group']) expect(screen.getByText(label)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Weekly' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Monday' })).toBeInTheDocument()
    // The old boxed form had a separate Recurrence panel with frequency pills.
    expect(screen.queryByText('Recurrence')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Daily' })).not.toBeInTheDocument()
  })

  it('opens read-only again after the sheet closes in edit mode', async () => {
    const user = userEvent.setup()
    mockedGetTaskDetail.mockResolvedValue(buildTask())

    const { rerenderModal } = renderModal(editableProps)
    await user.click(await screen.findByRole('button', { name: 'Edit title' }))
    expect(screen.getByRole('textbox', { name: 'Task title' })).toBeInTheDocument()

    rerenderModal({ ...editableProps, isOpen: false })
    rerenderModal({ ...editableProps, isOpen: true })

    expect(await screen.findByRole('heading', { name: 'Review extraction contract' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Task title' })).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Edit title' })).toBeInTheDocument()
  })

  it('returns to read-only after a successful save', async () => {
    const user = userEvent.setup()
    mockedGetTaskDetail.mockResolvedValue(buildTask())
    mockedUpdateTask.mockResolvedValue(buildTask({ title: 'Updated extraction contract' }))

    renderModal(editableProps)
    await user.dblClick(await screen.findByText('Check the structured output rules before rollout.'))
    const titleInput = screen.getByRole('textbox', { name: 'Task title' })
    await user.clear(titleInput)
    await user.type(titleInput, 'Updated extraction contract')
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    expect(await screen.findByRole('button', { name: 'Updated extraction contract' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Task title' })).not.toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Task description' })).not.toBeInTheDocument()
  })

  it('returns to read-only after a second save while the first notice is still showing', async () => {
    const user = userEvent.setup()
    mockedGetTaskDetail.mockResolvedValue(buildTask())
    mockedUpdateTask
      .mockResolvedValueOnce(buildTask({ title: 'First update' }))
      .mockResolvedValueOnce(buildTask({ title: 'Second update' }))

    renderModal(editableProps)
    for (const title of ['First update', 'Second update']) {
      // Full edit mode (the pencil's title-only edit ends on its own when Save is pressed).
      await user.dblClick(await screen.findByText('Check the structured output rules before rollout.'))
      const titleInput = screen.getByRole('textbox', { name: 'Task title' })
      await user.clear(titleInput)
      await user.type(titleInput, title)
      await user.click(screen.getByRole('button', { name: 'Save changes' }))
      expect(await screen.findByRole('button', { name: title })).toBeInTheDocument()
      expect(screen.queryByRole('textbox', { name: 'Task title' })).not.toBeInTheDocument()
    }
    expect(mockedUpdateTask).toHaveBeenCalledTimes(2)
  })

  it('opens read-only again after switching to another task in edit mode', async () => {
    const user = userEvent.setup()
    mockedGetTaskDetail.mockImplementation((id) => Promise.resolve(buildTask(id === 'task-2' ? { id: 'task-2', title: 'Second task' } : {})))

    const { rerenderModal } = renderModal(editableProps)
    await user.click(await screen.findByRole('button', { name: 'Edit title' }))
    expect(screen.getByRole('textbox', { name: 'Task title' })).toBeInTheDocument()

    rerenderModal({ ...editableProps, taskId: 'task-2' })

    expect(await screen.findByRole('heading', { name: 'Second task' })).toBeInTheDocument()
    expect(screen.queryByRole('textbox', { name: 'Task title' })).not.toBeInTheDocument()
  })

  it('shows a date-only reminder in the read-only row', async () => {
    mockedGetTaskDetail.mockResolvedValue(buildTask({ reminder_at: null, reminder_date: '2026-05-20' }))

    renderModal()

    const reminder = await screen.findByText(/May 20, 2026/)
    expect(reminder).not.toHaveClass('text-on-surface-variant/60')
    expect(screen.queryByText('No reminder')).not.toBeInTheDocument()
  })

  it('moves the reminder and weekly repeat with a new due date in edit mode', async () => {
    const user = userEvent.setup()
    const pastDue = localDateToken(-3)
    mockedGetTaskDetail.mockResolvedValue(buildTask({ due_date: pastDue, reminder_at: `${pastDue}T14:30:00Z` }))
    mockedUpdateTask.mockResolvedValue(buildTask())

    renderModal(editableProps)
    await user.dblClick(await screen.findByText('Check the structured output rules before rollout.'))
    await user.click(within(editRow('Due date')).getByRole('button'))
    await user.click(screen.getByRole('button', { name: 'next month' }))
    await user.click(screen.getByRole('button', { name: '15' }))
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(mockedUpdateTask).toHaveBeenCalled())
    const payload = mockedUpdateTask.mock.calls[0][1]
    const now = new Date()
    const nextDue = localDateToken(0, new Date(now.getFullYear(), now.getMonth() + 1, 15))
    expect(payload.due_date).toBe(nextDue)
    expect(new Intl.DateTimeFormat('en-CA', { timeZone: 'America/Toronto' }).format(new Date(payload.reminder_at as string))).toBe(nextDue)
    expect(payload.recurrence).toMatchObject({ frequency: 'weekly', weekday: new Date(`${nextDue}T12:00:00`).getDay() })
  })

  it('clears the reminder and repeat when the due date is cleared in edit mode', async () => {
    const user = userEvent.setup()
    mockedGetTaskDetail.mockResolvedValue(buildTask())
    mockedUpdateTask.mockResolvedValue(buildTask())

    renderModal(editableProps)
    await user.dblClick(await screen.findByText('Check the structured output rules before rollout.'))
    await user.click(within(editRow('Due date')).getByRole('button'))
    await user.click(screen.getByRole('button', { name: 'Clear' }))

    expect(screen.getByText('Needs a due date')).toBeInTheDocument()
    expect(within(editRow('Reminder')).getByRole('button', { name: 'No reminder' })).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Save changes' }))

    await waitFor(() => expect(mockedUpdateTask).toHaveBeenCalled())
    expect(mockedUpdateTask.mock.calls[0][1]).toMatchObject({ due_date: null, reminder_at: null, reminder_date: null, recurrence: null })
  })

  it('toggles subtasks directly from the task preview modal', async () => {
    const user = userEvent.setup()
    mockedGetTaskDetail.mockResolvedValue(buildTask())
    mockedUpdateSubtask.mockResolvedValue({
      id: 'subtask-1',
      title: 'Check retry contract',
      is_completed: true,
      completed_at: '2026-05-18T16:00:00Z',
    })

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

    await user.click(await screen.findByRole('checkbox', { name: 'Toggle Check retry contract' }))

    expect(mockedUpdateSubtask).toHaveBeenCalledWith(
      'task-1',
      'subtask-1',
      { is_completed: true },
      'csrf-token'
    )
  })

  it('prevents further checklist mutations while a subtask update is pending', async () => {
    const user = userEvent.setup()
    const updatedSubtask = {
      id: 'subtask-1',
      title: 'Check retry contract',
      is_completed: true,
      completed_at: '2026-05-18T16:00:00Z',
    }
    let resolveUpdate: (value: typeof updatedSubtask) => void = () => undefined
    mockedGetTaskDetail.mockResolvedValue(buildTask())
    mockedUpdateSubtask.mockImplementation(
      () => new Promise((resolve) => { resolveUpdate = resolve })
    )

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

    const toggle = await screen.findByRole('checkbox', { name: 'Toggle Check retry contract' })
    const remove = screen.getByRole('button', { name: 'Delete Check retry contract' })
    const add = screen.getByRole('button', { name: 'Add' })
    await user.click(toggle)

    await waitFor(() => expect(mockedUpdateSubtask).toHaveBeenCalledTimes(1))
    expect(toggle).toBeDisabled()
    expect(remove).toBeDisabled()
    expect(add).toBeDisabled()

    resolveUpdate(updatedSubtask)
    await waitFor(() => expect(toggle).toBeEnabled())
  })
})
