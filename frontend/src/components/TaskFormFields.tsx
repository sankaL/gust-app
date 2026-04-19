import type { TaskRecurrence } from '../lib/api'
import { SelectDropdown } from './SelectDropdown'
import { DatePicker } from './DatePicker'

interface GroupSummary {
  id: string
  name: string
}

interface TaskFormFieldsProps {
  title: string
  description: string
  groupId: string
  dueDate: string
  reminderAt: string
  recurrence: TaskRecurrence | null
  groups: GroupSummary[]
  isGroupDropdownOpen: boolean
  disabled?: boolean
  onTitleChange: (value: string) => void
  onDescriptionChange: (value: string) => void
  onGroupIdChange: (value: string) => void
  onDueDateChange: (value: string) => void
  onReminderAtChange: (value: string) => void
  onRecurrenceChange: (recurrence: TaskRecurrence | null) => void
  onGroupDropdownOpenChange: (isOpen: boolean) => void
}

const WEEKDAYS = [
  { value: '', label: 'Select a day' },
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
]

const FREQUENCIES = [
  { value: 'none', label: 'None' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
]

function normalizeRecurrenceFrequency(value: string | null | undefined): string {
  if (value === 'daily' || value === 'weekly' || value === 'monthly' || value === 'yearly') return value
  return 'none'
}

const MONTHS = [
  { value: '', label: 'Select a month' },
  { value: 1, label: 'January' },
  { value: 2, label: 'February' },
  { value: 3, label: 'March' },
  { value: 4, label: 'April' },
  { value: 5, label: 'May' },
  { value: 6, label: 'June' },
  { value: 7, label: 'July' },
  { value: 8, label: 'August' },
  { value: 9, label: 'September' },
  { value: 10, label: 'October' },
  { value: 11, label: 'November' },
  { value: 12, label: 'December' },
]

function recurrenceForDueDate(
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly',
  dueDate: string,
  current: TaskRecurrence | null
): TaskRecurrence {
  if (frequency === 'daily') {
    return { frequency, weekday: null, day_of_month: null, month: null }
  }

  if (!dueDate) {
    return current ?? { frequency, weekday: null, day_of_month: null, month: null }
  }

  const localDate = new Date(`${dueDate}T12:00:00`)
  if (frequency === 'weekly') {
    return { frequency, weekday: localDate.getDay(), day_of_month: null, month: null }
  }

  const dateParts = dueDate.split('-')
  if (frequency === 'yearly') {
    return {
      frequency,
      weekday: null,
      day_of_month: Number(dateParts[2] ?? current?.day_of_month ?? 1),
      month: Number(dateParts[1] ?? current?.month ?? 1),
    }
  }

  return {
    frequency,
    weekday: null,
    day_of_month: Number(dateParts[2] ?? current?.day_of_month ?? 1),
    month: null,
  }
}

export function TaskFormFields({
  title,
  description,
  groupId,
  dueDate,
  reminderAt,
  recurrence,
  groups,
  isGroupDropdownOpen,
  disabled = false,
  onTitleChange,
  onDescriptionChange,
  onGroupIdChange,
  onDueDateChange,
  onReminderAtChange,
  onRecurrenceChange,
  onGroupDropdownOpenChange,
}: TaskFormFieldsProps) {
  const recurrenceFrequency = normalizeRecurrenceFrequency(recurrence?.frequency)
  const recurrenceWeekday = recurrence?.weekday ?? null
  const recurrenceDayOfMonth = recurrence?.day_of_month ?? null
  const recurrenceMonth = recurrence?.month ?? null

  const handleDueDateChange = (newDueDate: string) => {
    if (!newDueDate) {
      onDueDateChange('')
      onReminderAtChange('')
      onRecurrenceChange(null)
      return
    }

    onDueDateChange(newDueDate)

    // Update recurrence based on new due date
    if (recurrenceFrequency === 'weekly') {
      const newRecurrence = recurrenceForDueDate('weekly', newDueDate, null)
      onRecurrenceChange(newRecurrence)
    } else if (recurrenceFrequency === 'monthly') {
      const newRecurrence = recurrenceForDueDate('monthly', newDueDate, null)
      onRecurrenceChange(newRecurrence)
    } else if (recurrenceFrequency === 'yearly') {
      const newRecurrence = recurrenceForDueDate('yearly', newDueDate, null)
      onRecurrenceChange(newRecurrence)
    }
  }

  const handleRecurrenceFrequencyChange = (frequency: string) => {
    if (frequency === 'none') {
      onRecurrenceChange(null)
    } else if (frequency === 'daily') {
      onRecurrenceChange({ frequency: 'daily', weekday: null, day_of_month: null, month: null })
    } else if (frequency === 'weekly') {
      if (dueDate) {
        const newRecurrence = recurrenceForDueDate('weekly', dueDate, null)
        onRecurrenceChange(newRecurrence)
      } else {
        onRecurrenceChange({ frequency: 'weekly', weekday: null, day_of_month: null, month: null })
      }
    } else if (frequency === 'monthly') {
      if (dueDate) {
        const newRecurrence = recurrenceForDueDate('monthly', dueDate, null)
        onRecurrenceChange(newRecurrence)
      } else {
        onRecurrenceChange({ frequency: 'monthly', weekday: null, day_of_month: 1, month: null })
      }
    } else if (frequency === 'yearly') {
      if (dueDate) {
        const newRecurrence = recurrenceForDueDate('yearly', dueDate, null)
        onRecurrenceChange(newRecurrence)
      } else {
        onRecurrenceChange({ frequency: 'yearly', weekday: null, day_of_month: 1, month: 1 })
      }
    }
  }

  const handleWeekdayChange = (value: string | number) => {
    if (value === '') {
      onRecurrenceChange({
        frequency: 'weekly',
        weekday: null,
        day_of_month: null,
        month: null,
      })
    } else {
      onRecurrenceChange({
        frequency: 'weekly',
        weekday: Number(value),
        day_of_month: null,
        month: null,
      })
    }
  }

  const handleDayOfMonthChange = (value: string) => {
    const numValue = value ? Number(value) : null
    const frequency = recurrence?.frequency === 'yearly' ? 'yearly' : 'monthly'
    onRecurrenceChange({
      frequency,
      weekday: null,
      day_of_month: numValue,
      month: frequency === 'yearly' ? (recurrence?.month ?? 1) : null,
    })
  }

  const handleMonthChange = (value: string | number) => {
    const numValue = value ? Number(value) : null
    onRecurrenceChange({
      frequency: 'yearly',
      weekday: null,
      day_of_month: recurrence?.day_of_month ?? 1,
      month: numValue,
    })
  }

  const recurrenceLabel = recurrence
    ? recurrence.frequency.charAt(0).toUpperCase() + recurrence.frequency.slice(1)
    : 'One-off'

  return (
    <div className="space-y-5">
      {/* Title and Description */}
      <div className="space-y-3">
        <input
          value={title}
          onChange={(e) => onTitleChange(e.target.value)}
          className="w-full rounded-[1.25rem] bg-surface/60 px-4 py-3 font-display text-[1.5rem] leading-tight text-on-surface outline-none placeholder:text-on-surface-variant/40 focus:bg-surface/75 focus:text-white sm:text-[1.85rem]"
          style={{ fontSize: '16px' }} /* Prevent iOS zoom */
          aria-label="Task title"
          placeholder="Task title"
          disabled={disabled}
        />
        <textarea
          value={description}
          onChange={(e) => onDescriptionChange(e.target.value)}
          rows={3}
          className="w-full resize-none rounded-[1.25rem] bg-surface/55 px-4 py-3 text-sm leading-6 text-on-surface-variant outline-none placeholder:text-on-surface-variant/45 focus:bg-surface/70 focus:text-on-surface"
          style={{ fontSize: '16px' }} /* Prevent iOS zoom */
          aria-label="Task description"
          placeholder="Add context that helps you act on this later"
          disabled={disabled}
        />
      </div>

      {/* Grid: Due Date, Reminder, Group */}
      <div className="grid min-w-0 gap-3 sm:grid-cols-2">
        {/* Due Date */}
        <div className="min-w-0 overflow-visible rounded-[1.35rem] bg-black/20 p-3 sm:p-4 backdrop-blur-sm">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">
            Due date
          </p>
          <div className="mt-3">
            <DatePicker
              value={dueDate || null}
              onChange={handleDueDateChange}
              mode="date"
              disabled={disabled}
              placeholder="Select a date"
            />
          </div>
        </div>

        {/* Reminder */}
        <div className="min-w-0 overflow-visible rounded-[1.35rem] bg-black/20 p-3 sm:p-4 backdrop-blur-sm">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">
            Reminder
          </p>
          <div className="mt-3">
            <DatePicker
              value={reminderAt || null}
              onChange={onReminderAtChange}
              mode="datetime"
              disabled={!dueDate || disabled}
              placeholder="Select date & time"
            />
          </div>
          {!dueDate && (
            <p className="mt-2 text-xs text-on-surface-variant/60">Set a due date first</p>
          )}
        </div>

        {/* Group */}
        <div
          className={[
            'min-w-0 overflow-visible rounded-[1.35rem] bg-black/20 p-3 sm:p-4 backdrop-blur-sm',
            isGroupDropdownOpen ? 'relative z-40' : '',
          ].join(' ')}
        >
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">
            Group
          </p>
          <div className="mt-3">
            <SelectDropdown
              label=""
              options={groups.map((group) => ({
                value: group.id,
                label: group.name,
              }))}
              value={groupId}
              onChange={(value) => onGroupIdChange(value as string)}
              onOpenChange={onGroupDropdownOpenChange}
              placeholder="No Group"
              disabled={disabled}
            />
          </div>
        </div>

        {/* Recurrence Display (summary) */}
        <div className="relative z-0 min-w-0 overflow-hidden rounded-[1.35rem] bg-black/20 p-3 sm:p-4 backdrop-blur-sm">
          <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">
            Recurrence
          </p>
          <p className="mt-3 text-base font-medium text-on-surface">{recurrenceLabel}</p>
        </div>
      </div>

      {/* Recurrence Settings */}
      <div className="rounded-soft bg-surface-container p-4 shadow-ambient">
        <div className="space-y-3">
          <div>
            <p className="font-display text-xl text-on-surface">Recurrence</p>
            <p className="mt-1 font-body text-xs text-on-surface-variant">
              Daily, weekly, monthly, and yearly only. Clearing the due date also clears reminder timing and
              recurrence.
            </p>
          </div>

          {/* Frequency Selection */}
          <div className="grid grid-cols-2 gap-2 sm:grid-cols-5">
            {FREQUENCIES.map((option) => (
              <button
                key={option.value}
                type="button"
                disabled={!dueDate || disabled}
                onClick={() => handleRecurrenceFrequencyChange(option.value)}
                className={[
                  'rounded-card px-3 py-3 text-sm transition',
                  recurrenceFrequency === option.value
                    ? 'bg-primary text-surface'
                    : 'bg-surface-dim text-on-surface-variant',
                  !dueDate ? 'opacity-50' : '',
                ].join(' ')}
              >
                {option.label}
              </button>
            ))}
          </div>

          {/* Weekly: Day of Week */}
          {recurrenceFrequency === 'weekly' && (
            <div className="rounded-card overflow-visible bg-black/10 p-3 sm:p-4">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">
                Day of Week
              </p>
              <div className="mt-3">
                <SelectDropdown
                  label=""
                  options={WEEKDAYS}
                  value={recurrenceWeekday ?? ''}
                  onChange={handleWeekdayChange}
                  placeholder="Select a day"
                  disabled={disabled}
                />
              </div>
            </div>
          )}

          {/* Monthly: Day of Month */}
          {recurrenceFrequency === 'monthly' && (
            <div className="rounded-card overflow-hidden bg-black/10 p-3 sm:p-4">
              <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">
                Day of Month
              </p>
              <input
                type="number"
                min={1}
                max={31}
                value={recurrenceDayOfMonth ?? ''}
                onChange={(e) => handleDayOfMonthChange(e.target.value)}
                className="mt-3 block w-full min-w-0 max-w-full rounded-card bg-surface-dim px-3 py-3 text-sm font-medium text-on-surface outline-none focus:bg-surface-container-high"
                style={{ fontSize: '16px', width: '100%', boxSizing: 'border-box' }} /* Prevent iOS zoom and force containment */
                placeholder="1-31"
                disabled={disabled}
              />
            </div>
          )}

          {/* Yearly: Month + Day of Month */}
          {recurrenceFrequency === 'yearly' && (
            <div className="rounded-card overflow-visible bg-black/10 p-3 sm:p-4 space-y-4">
              <div>
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">
                  Month
                </p>
                <div className="mt-3">
                  <SelectDropdown
                    label=""
                    options={MONTHS}
                    value={recurrenceMonth ?? ''}
                    onChange={handleMonthChange}
                    placeholder="Select a month"
                    disabled={disabled}
                  />
                </div>
              </div>
              <div>
                <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">
                  Day of Month
                </p>
                <input
                  type="number"
                  min={1}
                  max={31}
                  value={recurrenceDayOfMonth ?? ''}
                  onChange={(e) => handleDayOfMonthChange(e.target.value)}
                  className="mt-3 block w-full min-w-0 max-w-full rounded-card bg-surface-dim px-3 py-3 text-sm font-medium text-on-surface outline-none focus:bg-surface-container-high"
                  style={{ fontSize: '16px', width: '100%', boxSizing: 'border-box' }} /* Prevent iOS zoom and force containment */
                  placeholder="1-31"
                  disabled={disabled}
                />
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  )
}
