import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ExtractedTaskCard } from '../components/ExtractedTaskCard'

describe('extracted task card', () => {
  it('keeps metadata to one row with a full-detail overflow cue and keeps confidence visible', () => {
    render(
      <ExtractedTaskCard
        task={{
          id: 'capture-task-1',
          capture_id: 'capture-1',
          title: 'Confirm the final card layout',
          description: 'Use the full card width and tighten the metadata rows.',
          group_id: 'inbox-1',
          group_name: 'Inbox',
          due_date: '2026-04-03',
          reminder_at: null,
          recurrence_frequency: 'weekly',
          recurrence_weekday: 5,
          recurrence_day_of_month: null,
          recurrence_month: null,
          top_confidence: 0.92,
          needs_review: false,
          status: 'pending',
          subtask_titles: [],
          created_at: '2026-03-24T10:00:00Z',
          updated_at: '2026-03-24T10:00:00Z'
        }}
        onApprove={vi.fn().mockResolvedValue(undefined)}
        onDiscard={vi.fn().mockResolvedValue(undefined)}
        onClick={vi.fn()}
      />
    )

    expect(screen.getByText('Confirm the final card layout')).toBeInTheDocument()
    expect(screen.getByText('Use the full card width and tighten the metadata rows.')).toBeInTheDocument()
    expect(screen.getByText('High')).toBeInTheDocument()

    const metadataRow = screen.getByText('Inbox').parentElement
    if (!metadataRow) {
      throw new Error('Expected compact metadata row')
    }

    expect(metadataRow).not.toHaveClass('flex-wrap')
    expect(metadataRow).toHaveClass('text-[0.58rem]')
    expect(screen.getByText('Inbox')).toHaveClass('max-w-[42%]')
    expect(within(metadataRow).getByText(/^Due:/)).toBeInTheDocument()
    expect(screen.getByLabelText(/More task details: Inbox · Due: 4\/3\/2026 · WEEKLY/)).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument()
  })
})
