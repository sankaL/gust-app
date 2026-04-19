import { render, screen } from '@testing-library/react'
import { describe, expect, it, vi } from 'vitest'

import { TaskForm } from '../components/TaskForm'

const groups = [
  { id: 'inbox-1', name: 'Inbox' },
  { id: 'personal-1', name: 'Personal' },
]

describe('task form actions', () => {
  it('uses a stable two-column footer while saving', () => {
    render(
      <TaskForm
        mode="edit"
        initialTitle="Install hood vent"
        initialDescription=""
        initialGroupId="inbox-1"
        groups={groups}
        onSave={vi.fn()}
        onCancel={vi.fn()}
        isSaving
      />
    )

    const cancelButton = screen.getByRole('button', { name: 'Cancel' })
    const saveButton = screen.getByRole('button', { name: 'Saving...' })
    const footer = cancelButton.parentElement

    expect(footer?.className).toContain('grid')
    expect(footer?.className).toContain('grid-cols-2')
    expect(cancelButton.className).toContain('w-full')
    expect(saveButton.className).toContain('w-full')
    expect(saveButton.className).toContain('disabled:shadow-none')
  })
})
