import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { MobileShellContext } from '../components/AppShellActions'
import { ScreenHeader } from '../components/AppShellView'
import { ReviewBanner } from '../components/TasksRouteView'
import { VoiceOrb } from '../routes/capture/VoiceOrb'

function renderHeader(pendingReviewCount: number) {
  return render(
    <MobileShellContext.Provider value={{ topBarAction: null, pendingReviewCount, openSheet: vi.fn() }}>
      <ScreenHeader eyebrow="Today" title="Oct 27, Tue" />
    </MobileShellContext.Provider>,
  )
}

describe('ChipBot', () => {
  it('keeps the bell in the header whether or not tasks wait for review', () => {
    const { rerender } = renderHeader(2)
    const button = screen.getByRole('button', { name: 'Review pending tasks (2)' })
    expect(button.querySelector('.lucide-bell')).not.toBeNull()
    expect(button.querySelector('.chip-bot')).toBeNull()

    rerender(
      <MobileShellContext.Provider value={{ topBarAction: null, pendingReviewCount: 0, openSheet: vi.fn() }}>
        <ScreenHeader eyebrow="Today" title="Oct 27, Tue" />
      </MobileShellContext.Provider>,
    )
    expect(screen.getByRole('button', { name: 'Review pending tasks' }).querySelector('.lucide-bell')).not.toBeNull()
  })

  it('puts the beckoning bot on the review banner', () => {
    render(
      <MobileShellContext.Provider value={{ topBarAction: null, pendingReviewCount: 1, openSheet: vi.fn() }}>
        <ReviewBanner />
      </MobileShellContext.Provider>,
    )
    const bot = screen.getByRole('button', { name: /1 task waiting for review/ }).querySelector('.chip-bot')
    expect(bot).toHaveClass('chip-bot--beckon', 'chip-bot--on-primary')
    expect(bot).not.toHaveClass('chip-bot--working')
    expect(bot?.querySelector('.chip-bot__eye--wink')).not.toBeNull()
    expect(bot?.querySelector('.chip-bot__smile')).not.toBeNull()
  })

  it('shows the working bot in the orb while a capture is processing', () => {
    render(<VoiceOrb state="processing" stream={null} disabled label="Extracting tasks" />)
    const bot = screen.getByRole('button', { name: 'Extracting tasks' }).querySelector('.chip-bot--working')
    expect(bot).not.toBeNull()
    expect(bot?.classList.contains('chip-bot--on-primary')).toBe(true)
    expect(bot?.querySelectorAll('.chip-bot__dots circle')).toHaveLength(3)
  })
})
