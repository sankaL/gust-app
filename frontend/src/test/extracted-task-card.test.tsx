import { render, screen, within } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { ExtractedTaskCard } from '../components/ExtractedTaskCard'

describe('extracted task card', () => {
  it('shows wrapping metadata chips, confidence, and the shared approve/discard controls', () => {
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
    expect(screen.getByTitle('Confidence Score: High')).toBeInTheDocument()

    const metadataRow = screen.getByText('Inbox').closest('div')
    if (!metadataRow) {
      throw new Error('Expected metadata chip row')
    }

    expect(metadataRow).toHaveClass('flex-wrap')
    expect(within(metadataRow).getByText('Apr 3')).toBeInTheDocument()
    expect(within(metadataRow).getByText('Weekly')).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Approve' })).toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Discard' })).toBeInTheDocument()
  })
})
