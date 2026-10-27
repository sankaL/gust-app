import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { OpenTaskCard } from '../components/OpenTaskCard'
import type { TaskSummary } from '../lib/api'

// jsdom's PointerEvent drops clientX/pointerId, so swipe gestures need a MouseEvent-backed shim.
class TestPointerEvent extends MouseEvent {
  pointerId: number
  pointerType: string
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init)
    this.pointerId = init.pointerId ?? 1
    this.pointerType = init.pointerType ?? 'touch'
  }
}
window.PointerEvent = TestPointerEvent as unknown as typeof PointerEvent

function buildTask(overrides: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id: 'task-1',
    title: 'Check on Loku Caters orders page',
    description: 'Review the current implementation of actions on the orders page.',
    series_id: null,
    status: 'open',
    needs_review: false,
    due_date: '2026-04-03',
    reminder_at: '2026-03-29T13:00:00Z',
    due_bucket: 'due_soon',
    recurrence_frequency: 'weekly',
    group: { id: 'group-1', name: 'Operations', is_system: false },
    completed_at: null,
    deleted_at: null,
    created_at: '2026-05-15T12:00:00.000Z',
    updated_at: '2026-05-15T12:00:00.000Z',
    subtask_count: 2,
    ...overrides,
  }
}

describe('open task card timeline layout', () => {
  it('shows the reminder time column, description, and opens the task on a body click', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()

    render(<OpenTaskCard todayIso="2026-04-03" task={buildTask()} onOpen={onOpen} onComplete={vi.fn()} onDelete={vi.fn()} isBusy={false} />)

    expect(screen.getByLabelText('Reminder at 1:00 PM')).toBeInTheDocument()
    expect(screen.getByText('1:00')).toBeInTheDocument()
    expect(screen.getByText('PM')).toBeInTheDocument()
    expect(screen.getByText('Review the current implementation of actions on the orders page.')).toHaveClass('line-clamp-2')

    await user.click(screen.getByRole('button', { name: 'Open Check on Loku Caters orders page' }))
    expect(onOpen).toHaveBeenCalledWith('task-1')
    expect(onOpen).toHaveBeenCalledTimes(1)
  })

  it('falls back to the due date in the time column and flags overdue work', () => {
    render(<OpenTaskCard todayIso="2026-04-10" task={buildTask({ reminder_at: null, due_date: '2026-04-03' })} onOpen={vi.fn()} onComplete={vi.fn()} isBusy={false} />)

    const column = screen.getByLabelText(/^Due /)
    expect(within(column).getByText('3')).toHaveClass('text-tertiary')
    expect(screen.getByText(/Overdue · /)).toBeInTheDocument()
  })

  it('renders wrapping metadata chips with the group, recurrence, and subtask count', () => {
    const groupName = 'Operations and Long-Running Cross-Team Planning Group'
    render(<OpenTaskCard todayIso="2026-04-03" task={buildTask({ group: { id: 'group-1', name: groupName, is_system: false }, subtask_count: 12 })} onOpen={vi.fn()} onComplete={vi.fn()} onDelete={vi.fn()} isBusy={false} showCollapsedGroupLabel />)

    const groupChip = screen.getByText(groupName)
    expect(groupChip).toHaveClass('truncate')
    expect(groupChip.closest('div')).toHaveClass('flex-wrap')
    expect(screen.getByText('Weekly')).toBeInTheDocument()
    expect(screen.getByText('12')).toBeInTheDocument()
  })

  it('hides the group chip inside a single-group list', () => {
    render(<OpenTaskCard todayIso="2026-04-03" task={buildTask()} onOpen={vi.fn()} onComplete={vi.fn()} isBusy={false} />)
    expect(screen.queryByText('Operations')).not.toBeInTheDocument()
  })

  it('completes from the shared check control without opening the task', async () => {
    const user = userEvent.setup()
    const onOpen = vi.fn()
    const onComplete = vi.fn()
    const onDelete = vi.fn()
    const task = buildTask()

    render(<OpenTaskCard todayIso="2026-04-03" task={task} onOpen={onOpen} onComplete={onComplete} onDelete={onDelete} isBusy={false} />)

    await user.click(screen.getByRole('button', { name: 'Delete Check on Loku Caters orders page' }))
    expect(onDelete).toHaveBeenCalledWith(task)

    await user.click(screen.getByRole('button', { name: 'Complete Check on Loku Caters orders page' }))
    await vi.waitFor(() => expect(onComplete).toHaveBeenCalledWith(task))
    expect(onOpen).not.toHaveBeenCalled()
  })

  it('completes on a right swipe and asks to delete on a left swipe', () => {
    const onComplete = vi.fn()
    const onDelete = vi.fn()
    const task = buildTask()
    render(<OpenTaskCard todayIso="2026-04-03" task={task} onOpen={vi.fn()} onComplete={onComplete} onDelete={onDelete} isBusy={false} enableSwipe />)

    const card = screen.getByRole('button', { name: 'Open Check on Loku Caters orders page' })
    fireEvent.pointerDown(card, { clientX: 10, clientY: 10, pointerId: 1 })
    fireEvent.pointerMove(card, { clientX: 130, clientY: 12, pointerId: 1 })
    fireEvent.pointerUp(card, { clientX: 130, clientY: 12, pointerId: 1 })
    return vi.waitFor(() => expect(onComplete).toHaveBeenCalledWith(task)).then(() => {
      fireEvent.pointerDown(card, { clientX: 200, clientY: 10, pointerId: 2 })
      fireEvent.pointerMove(card, { clientX: 60, clientY: 12, pointerId: 2 })
      fireEvent.pointerUp(card, { clientX: 60, clientY: 12, pointerId: 2 })
      expect(onDelete).toHaveBeenCalledWith(task)
    })
  })
})
