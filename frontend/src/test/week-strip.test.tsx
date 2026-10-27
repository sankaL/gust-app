import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { WeekStrip } from '../components/tasks/WeekStrip'

describe('week strip', () => {
  it('shows yesterday through five days ahead with today selected and due counts', async () => {
    const onSelect = vi.fn()
    render(<WeekStrip todayIso="2026-10-27" selectedIso="2026-10-27" dueCounts={{ '2026-10-28': 2, '2026-10-30': 1 }} onSelect={onSelect} />)

    const tabs = screen.getAllByRole('tab')
    expect(tabs).toHaveLength(7)
    expect(tabs[0]).toHaveTextContent('26')
    expect(tabs[6]).toHaveTextContent('1')
    expect(tabs[1]).toHaveAttribute('aria-selected', 'true')
    expect(tabs[1]).toHaveAccessibleName(/^Today, /)
    expect(tabs[2]).toHaveAccessibleName(/2 tasks due$/)
    expect(tabs[4]).toHaveAccessibleName(/1 task due$/)

    await userEvent.setup().click(tabs[2])
    expect(onSelect).toHaveBeenCalledWith('2026-10-28')
  })
})
