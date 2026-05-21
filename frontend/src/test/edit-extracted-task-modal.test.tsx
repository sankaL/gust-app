import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { EditExtractedTaskModal } from '../components/EditExtractedTaskModal'
import { updateExtractedTask, type ExtractedTask, type GroupSummary } from '../lib/api'

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return {
    ...actual,
    updateExtractedTask: vi.fn(),
  }
})

const mockedUpdateExtractedTask = vi.mocked(updateExtractedTask)

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
  it('renders, adds, and deletes captured subtasks in the mobile editor', async () => {
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

    expect(screen.getByText('Subtasks')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Delete Remove lint screen' }))
    await user.type(screen.getByPlaceholderText('Add a subtask...'), 'Confirm outside vent airflow')
    await user.click(screen.getByRole('button', { name: 'Add' }))
    await user.click(screen.getByRole('button', { name: 'Save Changes' }))

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
})
