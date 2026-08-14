import { render, screen } from '@testing-library/react'
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
})
