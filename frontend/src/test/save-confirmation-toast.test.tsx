import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { describe, expect, it, vi } from 'vitest'

import { SaveConfirmationToast } from '../components/SaveConfirmationToast'

describe('SaveConfirmationToast', () => {
  it('uses the shared success-notification treatment and can be dismissed', async () => {
    const user = userEvent.setup()
    const onDismiss = vi.fn()

    render(<SaveConfirmationToast message="Changes saved" onDismiss={onDismiss} />)

    const notification = screen.getByRole('status')
    expect(notification).toHaveClass('rounded-lg', 'bg-[#4F7942]')
    await user.click(screen.getByRole('button', { name: 'Dismiss notification' }))
    expect(onDismiss).toHaveBeenCalledTimes(1)
  })

  it('appears at the top on mobile and dismisses on a horizontal touch swipe', () => {
    const onDismiss = vi.fn()
    render(<SaveConfirmationToast message="Changes saved" onDismiss={onDismiss} />)

    const notification = screen.getByRole('status')
    expect(notification.parentElement).toHaveClass('top-0', 'sm:bottom-0', 'sm:top-auto')

    fireEvent.touchStart(notification, { touches: [{ clientX: 100, clientY: 20 }] })
    fireEvent.touchMove(notification, { touches: [{ clientX: 168, clientY: 22 }] })
    fireEvent.touchEnd(notification)

    expect(onDismiss).toHaveBeenCalledTimes(1)
  })
})
