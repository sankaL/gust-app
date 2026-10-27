import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { MobileShellContext } from '../components/AppShellActions'
import { ScreenHeader } from '../components/AppShellView'
import { VoiceOrb } from '../routes/capture/VoiceOrb'

function renderHeader(pendingReviewCount: number) {
  return render(
    <MobileShellContext.Provider value={{ topBarAction: null, pendingReviewCount, openSheet: vi.fn() }}>
      <ScreenHeader eyebrow="Today" title="Oct 27, Tue" />
    </MobileShellContext.Provider>,
  )
}

describe('ChipBot', () => {
  it('replaces the review bell with the idle bot only while tasks wait for review', () => {
    const { container, rerender } = renderHeader(2)
    const button = screen.getByRole('button', { name: 'Review pending tasks (2)' })
    expect(button.querySelector('.chip-bot')).not.toBeNull()
    expect(button.querySelector('.chip-bot--working')).toBeNull()
    expect(button.querySelector('.chip-bot--on-surface .chip-bot__smile')).not.toBeNull()
    expect(button.querySelector('.lucide-bell')).toBeNull()

    rerender(
      <MobileShellContext.Provider value={{ topBarAction: null, pendingReviewCount: 0, openSheet: vi.fn() }}>
        <ScreenHeader eyebrow="Today" title="Oct 27, Tue" />
      </MobileShellContext.Provider>,
    )
    expect(container.querySelector('.chip-bot')).toBeNull()
    expect(screen.getByRole('button', { name: 'Review pending tasks' }).querySelector('.lucide-bell')).not.toBeNull()
  })

  it('shows the working bot in the orb while a capture is processing', () => {
    render(<VoiceOrb state="processing" stream={null} disabled label="Extracting tasks" />)
    const bot = screen.getByRole('button', { name: 'Extracting tasks' }).querySelector('.chip-bot--working')
    expect(bot).not.toBeNull()
    expect(bot?.classList.contains('chip-bot--on-primary')).toBe(true)
    expect(bot?.querySelectorAll('.chip-bot__dots circle')).toHaveLength(3)
  })
})
