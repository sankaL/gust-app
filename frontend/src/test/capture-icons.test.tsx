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

describe('capture icons', () => {
  it('keeps the bell in the header whether or not tasks wait for review', () => {
    const { rerender } = renderHeader(2)
    const button = screen.getByRole('button', { name: 'Review pending tasks (2)' })
    expect(button.querySelector('.lucide-bell')).not.toBeNull()

    rerender(
      <MobileShellContext.Provider value={{ topBarAction: null, pendingReviewCount: 0, openSheet: vi.fn() }}>
        <ScreenHeader eyebrow="Today" title="Oct 27, Tue" />
      </MobileShellContext.Provider>,
    )
    expect(screen.getByRole('button', { name: 'Review pending tasks' }).querySelector('.lucide-bell')).not.toBeNull()
  })

  it('puts the review scan icon on the review banner', () => {
    render(
      <MobileShellContext.Provider value={{ topBarAction: null, pendingReviewCount: 1, openSheet: vi.fn() }}>
        <ReviewBanner />
      </MobileShellContext.Provider>,
    )
    const icon = screen.getByRole('button', { name: /1 task waiting for review/ }).querySelector('.review-scan')
    expect(icon?.querySelector('.review-scan__lens')).not.toBeNull()
  })

  it('shows the processing wave in the orb while a capture is processing', () => {
    render(<VoiceOrb state="processing" stream={null} disabled label="Extracting tasks" />)
    const wave = screen.getByRole('button', { name: 'Extracting tasks' }).querySelector('.processing-wave')
    expect(wave?.querySelectorAll('.processing-wave__bar')).toHaveLength(5)
  })
})
