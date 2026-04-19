import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { DatePicker } from '../components/DatePicker'
import { SelectDropdown } from '../components/SelectDropdown'
import { TaskFormFields } from '../components/TaskFormFields'

const groups = [
  { id: 'inbox-1', name: 'Inbox' },
  { id: 'personal-1', name: 'Personal' },
]

function renderFields() {
  return render(
    <TaskFormFields
      title="Install the fanhood"
      description="Install it today around 6 p.m."
      groupId="inbox-1"
      dueDate="2026-04-12"
      reminderAt=""
      recurrence={null}
      groups={groups}
      isGroupDropdownOpen={false}
      onTitleChange={() => {}}
      onDescriptionChange={() => {}}
      onGroupIdChange={() => {}}
      onDueDateChange={() => {}}
      onReminderAtChange={() => {}}
      onRecurrenceChange={() => {}}
      onGroupDropdownOpenChange={() => {}}
    />
  )
}

describe('task form overlays', () => {
  beforeEach(() => {
    vi.spyOn(HTMLElement.prototype, 'getBoundingClientRect').mockImplementation(
      () =>
        ({
          x: 80,
          y: 120,
          width: 280,
          height: 48,
          top: 120,
          right: 360,
          bottom: 168,
          left: 80,
          toJSON: () => ({}),
        }) as DOMRect
    )

    Object.defineProperty(window, 'innerWidth', {
      configurable: true,
      writable: true,
      value: 390,
    })
    Object.defineProperty(window, 'innerHeight', {
      configurable: true,
      writable: true,
      value: 844,
    })
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('renders picker and dropdown overlays above their field cards', async () => {
    const user = userEvent.setup()
    renderFields()

    const reminderCard = screen.getByText('Reminder').parentElement
    const groupCard = screen.getByText('Group').parentElement

    expect(reminderCard?.className).toContain('overflow-visible')
    expect(groupCard?.className).toContain('overflow-visible')

    await user.click(screen.getByRole('button', { name: 'Select date & time' }))
    expect(await screen.findByText('Time')).toBeInTheDocument()

    const calendarOverlay = Array.from(document.body.querySelectorAll('div')).find(
      (element) =>
        typeof element.className === 'string' &&
        element.className.includes('fixed') &&
        element.textContent?.includes('Today')
    )
    expect(calendarOverlay).toBeTruthy()

    await user.click(screen.getByRole('button', { name: /Inbox/ }))
    const listbox = await screen.findByRole('listbox', { name: 'No Group' })

    expect(listbox.className).toContain('fixed')
    expect(await screen.findByText('Personal')).toBeInTheDocument()
  })

  it('keeps end-of-month navigation inside the selected month', async () => {
    const user = userEvent.setup()

    render(<DatePicker value="2026-01-31" onChange={() => {}} mode="date" />)

    await user.click(screen.getByRole('button', { name: 'Jan 31, 2026' }))
    const monthSelect = screen.getAllByRole('combobox')[0] as HTMLSelectElement

    await user.selectOptions(monthSelect, '1')

    expect(monthSelect.value).toBe('1')
    expect(screen.getByRole('button', { name: '28' })).toBeInTheDocument()
  })

  it('keeps the menu open while the menu itself scrolls', async () => {
    const user = userEvent.setup()
    const options = Array.from({ length: 12 }, (_, index) => ({
      value: `group-${index + 1}`,
      label: `Group ${index + 1}`,
    }))

    render(
      <SelectDropdown
        label=""
        options={options}
        value="group-1"
        onChange={() => {}}
        placeholder="Pick a group"
      />
    )

    await user.click(screen.getByRole('button', { name: /Group 1/ }))
    const listbox = await screen.findByRole('listbox', { name: 'Pick a group' })

    fireEvent.scroll(listbox)

    expect(screen.getByRole('listbox', { name: 'Pick a group' })).toBeInTheDocument()
    expect(screen.getByText('Group 12')).toBeInTheDocument()
  })
})
