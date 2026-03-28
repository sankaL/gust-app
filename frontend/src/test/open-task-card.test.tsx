import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { OpenTaskCard } from '../components/OpenTaskCard'

describe('open task card metadata layout', () => {
  it('keeps expanded metadata rows single-line with truncation and preserves action buttons', async () => {
    const groupName = 'Operations and Long-Running Cross-Team Planning Group'
    const user = userEvent.setup()

    render(
      <OpenTaskCard
        task={{
          id: 'task-1',
          title: 'Check on Loku Caters orders page',
          description: 'Review the current implementation of actions on the orders page.',
          status: 'open',
          needs_review: false,
          due_date: '2026-04-03',
          reminder_at: '2026-03-29T13:00:00Z',
          due_bucket: 'due_soon',
          recurrence_frequency: 'weekly',
          group: { id: 'group-1', name: groupName, is_system: false },
          completed_at: null,
          deleted_at: null,
          subtask_count: 12
        }}
        onOpen={vi.fn()}
        onComplete={vi.fn()}
        onDelete={vi.fn()}
        isBusy={false}
      />
    )

    await user.click(screen.getByRole('button', { name: 'Expand Check on Loku Caters orders page' }))

    const subtaskReminderRow = screen.getByText(/Reminder:/i).parentElement
    if (!subtaskReminderRow) {
      throw new Error('Expected subtask and reminder row')
    }

    expect(subtaskReminderRow).toHaveClass('flex-nowrap')
    expect(subtaskReminderRow).toHaveClass('overflow-hidden')
    expect(subtaskReminderRow.className).toContain('text-[0.66rem]')
    expect(screen.getByText(/Reminder:/i)).toHaveClass('min-w-0')
    expect(screen.getByText(/Reminder:/i)).toHaveClass('truncate')

    const bottomMetadataRow = screen.getByText(groupName).parentElement
    if (!bottomMetadataRow) {
      throw new Error('Expected group, due date, recurrence row')
    }

    expect(bottomMetadataRow).toHaveClass('flex-nowrap')
    expect(bottomMetadataRow).toHaveClass('overflow-hidden')
    expect(bottomMetadataRow.className).toContain('text-[0.62rem]')
    expect(screen.getByText(groupName)).toHaveClass('max-w-[44%]')
    expect(screen.getByText(groupName)).toHaveClass('shrink')
    expect(screen.getByText(groupName)).toHaveClass('truncate')
    expect(screen.getByText(/^Due:/)).toBeInTheDocument()
    expect(screen.getByText('WEEKLY')).toHaveClass('shrink-0')
    expect(screen.getByRole('button', { name: 'Delete Check on Loku Caters orders page' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Complete Check on Loku Caters orders page' })).toBeInTheDocument()
  })
})
