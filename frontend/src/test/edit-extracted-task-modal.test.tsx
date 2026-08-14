import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { EditExtractedTaskModal } from '../components/EditExtractedTaskModal'
import { createSubtask, createTask, updateExtractedTask, type ExtractedTask, type GroupSummary } from '../lib/api'

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return {
    ...actual,
    createTask: vi.fn(),
    createSubtask: vi.fn(),
    updateExtractedTask: vi.fn(),
  }
})

const mockedUpdateExtractedTask = vi.mocked(updateExtractedTask)
const mockedCreateTask = vi.mocked(createTask)
const mockedCreateSubtask = vi.mocked(createSubtask)

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

function buildExtractedTask(overrides: Partial<ExtractedTask> = {}): ExtractedTask {
  return {
    id: 'extracted-1',
    capture_id: 'capture-1',
    title: 'Clean the vents',
    description: null,
    group_id: 'inbox-1',
    group_name: 'Inbox',
    due_date: null,
    reminder_at: null,
    recurrence_frequency: null,
    recurrence_weekday: null,
    recurrence_day_of_month: null,
    recurrence_month: null,
    top_confidence: 0.94,
    needs_review: false,
    status: 'pending',
    subtask_titles: ['Remove lint screen'],
    created_at: '2026-05-15T12:00:00Z',
    updated_at: '2026-05-15T12:00:00Z',
    ...overrides,
  }
}

afterEach(() => {
  vi.clearAllMocks()
})

describe('EditExtractedTaskModal', () => {
  it('keeps read-only view by default and edits only the requested sections', async () => {
    const user = userEvent.setup()
    const task = buildExtractedTask()
    const onSave = vi.fn().mockResolvedValue(undefined)
    mockedUpdateExtractedTask.mockResolvedValue({
      ...task,
      subtask_titles: ['Confirm outside vent airflow'],
    })

    render(
      <EditExtractedTaskModal
        task={task}
        groups={groups}
        isOpen
        onClose={vi.fn()}
        onSave={onSave}
        csrfToken="csrf-token"
      />
    )

    const taskHeading = screen.getByRole('heading', { name: 'Clean the vents' })
    expect(taskHeading).toBeInTheDocument()
    expect(taskHeading).not.toHaveClass('sr-only')
    expect(screen.queryByRole('button', { name: 'Edit' })).not.toBeInTheDocument()
    expect(screen.getByRole('dialog')).toHaveClass('!mt-0')
    expect(screen.getByText('Subtasks')).toBeInTheDocument()
    expect(screen.getByText('Remove lint screen')).toBeInTheDocument()

    // Save Changes button starts disabled because there are no edits yet
    const saveButton = screen.getByRole('button', { name: 'Save Changes' })
    expect(saveButton).toBeDisabled()

    // Enter title-only edit mode from the title itself.
    await user.click(screen.getByRole('button', { name: 'Clean the vents' }))
    expect(screen.getByRole('heading', { name: 'Clean the vents' })).toHaveClass('sr-only')
    expect(screen.getByLabelText('Task title')).toBeInTheDocument()
    expect(screen.queryByLabelText('Task description')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Add a subtask...')).not.toBeInTheDocument()

    // Double-clicking subtasks adds only the subtask editor
    await user.dblClick(screen.getByText('Subtasks'))
    expect(screen.getByPlaceholderText('Add a subtask...')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Delete Remove lint screen' }))
    await user.type(screen.getByPlaceholderText('Add a subtask...'), 'Confirm outside vent airflow')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    // Now save button is enabled
    expect(saveButton).toBeEnabled()
    await user.click(saveButton)

    expect(mockedUpdateExtractedTask).toHaveBeenCalledWith(
      'capture-1',
      'extracted-1',
      { subtask_titles: ['Confirm outside vent airflow'] },
      'csrf-token'
    )
    expect(onSave).toHaveBeenCalledWith('extracted-1', {
      subtask_titles: ['Confirm outside vent airflow'],
    })
  })

  it('opens only the section that was clicked or double-clicked', async () => {
    const user = userEvent.setup()
    const task = buildExtractedTask()

    render(
      <EditExtractedTaskModal
        task={task}
        groups={groups}
        isOpen
        onClose={vi.fn()}
        onSave={vi.fn()}
        csrfToken="csrf-token"
      />
    )

    expect(screen.queryByLabelText('Task title')).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Task description')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Add a subtask...')).not.toBeInTheDocument()

    // Clicking context opens only the context editor.
    await user.click(screen.getByText('No description yet.'))
    expect(screen.getByLabelText('Task description')).toBeInTheDocument()
    expect(screen.queryByLabelText('Task title')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Add a subtask...')).not.toBeInTheDocument()

    // Double-clicking subtasks opens that editor too, without turning other fields on.
    await user.dblClick(screen.getByText('Remove lint screen'))
    expect(screen.getByPlaceholderText('Add a subtask...')).toBeInTheDocument()
    expect(screen.getByLabelText('Task description')).toBeInTheDocument()
    expect(screen.queryByLabelText('Task title')).not.toBeInTheDocument()
  })

  it('edits only the title when its read-only heading is double-clicked', async () => {
    const user = userEvent.setup()

    render(
      <EditExtractedTaskModal
        task={buildExtractedTask()}
        groups={groups}
        isOpen
        onClose={vi.fn()}
        onSave={vi.fn()}
        csrfToken="csrf-token"
      />
    )

    await user.dblClick(screen.getByRole('button', { name: 'Clean the vents' }))

    expect(screen.getByLabelText('Task title')).toBeInTheDocument()
    expect(screen.queryByLabelText('Task description')).not.toBeInTheDocument()
    expect(screen.queryByPlaceholderText('Add a subtask...')).not.toBeInTheDocument()
  })

  it('keeps the subtask composer first and places the newest edit immediately below it', async () => {
    const user = userEvent.setup()

    render(
      <EditExtractedTaskModal
        task={buildExtractedTask()}
        groups={groups}
        isOpen
        onClose={vi.fn()}
        onSave={vi.fn()}
        csrfToken="csrf-token"
      />
    )

    await user.dblClick(screen.getByText('Subtasks'))
    await user.type(screen.getByPlaceholderText('Add a subtask...'), 'Newest subtask')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    const subtaskInputs = screen
      .getAllByRole('textbox')
      .filter((input) => input.getAttribute('aria-label')?.startsWith('Subtask '))

    expect(subtaskInputs[0]).toHaveValue('Newest subtask')
    expect(subtaskInputs[0]).toHaveClass('bg-transparent')
  })

  it('validates recurrence before submitting an extracted-task update', async () => {
    const user = userEvent.setup()
    const task = buildExtractedTask({
      due_date: '2026-05-17',
      recurrence_frequency: 'weekly',
      recurrence_weekday: 6,
    })

    render(
      <EditExtractedTaskModal
        task={task}
        groups={groups}
        isOpen
        onClose={vi.fn()}
        onSave={vi.fn()}
        csrfToken="csrf-token"
      />
    )

    await user.click(screen.getByText('Weekly'))
    await user.click(screen.getByRole('button', { name: /Saturday/ }))
    await user.click(screen.getByRole('option', { name: 'Select a day' }))
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

    expect(await screen.findByText('Please select a day of the week for weekly recurrence')).toBeInTheDocument()
    expect(mockedUpdateExtractedTask).not.toHaveBeenCalled()
  })

  it('filters blank subtasks and resumes a failed create without duplicating the parent task', async () => {
    const user = userEvent.setup()
    const onSave = vi.fn().mockResolvedValue(undefined)
    mockedCreateTask.mockResolvedValue({ id: 'task-1' } as Awaited<ReturnType<typeof createTask>>)
    mockedCreateSubtask
      .mockResolvedValueOnce({ id: 'subtask-1' } as Awaited<ReturnType<typeof createSubtask>>)
      .mockRejectedValueOnce(new Error('Subtask request failed'))
      .mockResolvedValueOnce({ id: 'subtask-2' } as Awaited<ReturnType<typeof createSubtask>>)

    render(
      <EditExtractedTaskModal
        task={null}
        groups={groups}
        isOpen
        onClose={vi.fn()}
        onSave={onSave}
        csrfToken="csrf-token"
      />
    )

    await user.type(screen.getByLabelText('Task title'), 'Create ventilation task')
    await user.type(screen.getByPlaceholderText('Add a subtask...'), 'First subtask')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await user.type(screen.getByPlaceholderText('Add a subtask...'), 'Retry subtask')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await user.type(screen.getByPlaceholderText('Add a subtask...'), 'Blank subtask')
    await user.click(screen.getByRole('button', { name: 'Add' }))

    const draftRows = screen.getAllByRole('textbox').filter((input) => input.getAttribute('aria-label')?.startsWith('Subtask '))
    await user.clear(draftRows[0])
    await user.click(screen.getByRole('button', { name: 'Add Task' }))

    expect(await screen.findByText('Subtask request failed')).toBeInTheDocument()
    expect(mockedCreateTask).toHaveBeenCalledTimes(1)
    expect(mockedCreateSubtask).toHaveBeenCalledWith('task-1', 'First subtask', 'csrf-token')
    expect(mockedCreateSubtask).toHaveBeenCalledWith('task-1', 'Retry subtask', 'csrf-token')

    await user.click(screen.getByRole('button', { name: 'Add Task' }))

    await waitFor(() => expect(onSave).toHaveBeenCalledWith('task-1', { title: 'Create ventilation task' }))
    expect(mockedCreateTask).toHaveBeenCalledTimes(1)
    expect(mockedCreateSubtask).toHaveBeenCalledTimes(3)
    expect(mockedCreateSubtask).not.toHaveBeenCalledWith('task-1', '', 'csrf-token')
  })
})
