import { describe, expect, it } from 'vitest'

import type { ExtractedTask, TaskRecurrence } from '../lib/api'
import {
  buildExtractedTaskDraft,
  buildExtractedTaskUpdates,
  recurrenceForDueDate,
  validateTaskFormDraft,
} from '../lib/taskFormModel'
import {
  shiftReminderDateTimeLocal,
  shiftReminderIso,
  shouldShiftReminderForDueDate,
} from '../lib/dateTime'

function task(overrides: Partial<ExtractedTask> = {}): ExtractedTask {
  return {
    id: 'task-1',
    capture_id: 'capture-1',
    title: 'Original',
    description: null,
    group_id: 'inbox',
    group_name: 'Inbox',
    due_date: null,
    reminder_at: null,
    recurrence_frequency: null,
    recurrence_weekday: null,
    recurrence_day_of_month: null,
    recurrence_month: null,
    top_confidence: 1,
    needs_review: false,
    status: 'pending',
    subtask_titles: [],
    created_at: '2026-07-14T12:00:00Z',
    updated_at: '2026-07-14T12:00:00Z',
    ...overrides,
  }
}

function draft(recurrence: TaskRecurrence | null = null) {
  return {
    title: 'Original',
    description: '',
    groupId: 'inbox',
    dueDate: '',
    reminderAt: '',
    recurrence,
    subtaskTitles: [] as string[],
  }
}

describe('task form model', () => {
  it.each([
    [{ ...draft(), title: '' }, false, 'Please enter a task title'],
    [{ ...draft(), groupId: '' }, true, 'Please select a valid group'],
    [{ ...draft({ frequency: 'weekly', weekday: null, day_of_month: null, month: null }) }, false, 'Please select a day of the week for weekly recurrence'],
    [{ ...draft({ frequency: 'monthly', weekday: null, day_of_month: null, month: null }) }, false, 'Please select a day of the month for monthly recurrence'],
    [{ ...draft({ frequency: 'monthly', weekday: null, day_of_month: 32, month: null }) }, false, 'Day of month must be between 1 and 31'],
    [{ ...draft({ frequency: 'yearly', weekday: null, day_of_month: 1, month: null }) }, false, 'Please select a month for yearly recurrence'],
    [{ ...draft({ frequency: 'yearly', weekday: null, day_of_month: 1, month: 13 }) }, false, 'Month must be between 1 and 12'],
    [{ ...draft({ frequency: 'yearly', weekday: null, day_of_month: null, month: 1 }) }, false, 'Please select a day of the month for yearly recurrence'],
    [{ ...draft({ frequency: 'yearly', weekday: null, day_of_month: 0, month: 1 }) }, false, 'Day of month must be between 1 and 31'],
    [draft({ frequency: 'daily', weekday: null, day_of_month: null, month: null }), false, null],
  ])('validates recurrence and required fields', (value, requireGroup, expected) => {
    expect(validateTaskFormDraft(value, requireGroup)).toBe(expected)
  })

  it('derives recurrence values from due dates', () => {
    expect(recurrenceForDueDate('daily', '2026-07-14')).toEqual({
      frequency: 'daily', weekday: null, day_of_month: null, month: null,
    })
    expect(recurrenceForDueDate('weekly', '2026-07-14').weekday).toBe(2)
    expect(recurrenceForDueDate('monthly', '2026-07-14').day_of_month).toBe(14)
    expect(recurrenceForDueDate('yearly', '2026-07-14')).toMatchObject({ month: 7, day_of_month: 14 })
    expect(recurrenceForDueDate('yearly', '', null)).toMatchObject({ month: null, day_of_month: null })
  })

  it('builds a normalized draft and only emits changed values', () => {
    const original = task({
      recurrence_frequency: 'weekly',
      recurrence_weekday: 2,
      subtask_titles: ['First'],
    })
    const initial = buildExtractedTaskDraft(original)
    expect(buildExtractedTaskUpdates(original, initial)).toEqual({})

    expect(buildExtractedTaskUpdates(original, {
      ...initial,
      title: 'Changed',
      description: 'Context',
      groupId: 'work',
      dueDate: '2026-07-15',
      reminderAt: '2026-07-15T09:00',
      recurrence: { frequency: 'yearly', weekday: null, day_of_month: 15, month: 7 },
      subtaskTitles: [' First ', 'Second'],
    })).toMatchObject({
      title: 'Changed',
      description: 'Context',
      group_id: 'work',
      due_date: '2026-07-15',
      recurrence_frequency: 'yearly',
      recurrence_weekday: null,
      recurrence_day_of_month: 15,
      recurrence_month: 7,
      subtask_titles: ['First', 'Second'],
    })
  })

  it('shifts reminder date-time local value to new due date', () => {
    expect(shiftReminderDateTimeLocal('2026-09-01T09:30', '2026-09-10')).toBe('2026-09-10T09:30')
    expect(shiftReminderDateTimeLocal(null, '2026-09-10')).toBe('')
    expect(shiftReminderDateTimeLocal('2026-09-01T09:30', null)).toBe('')
  })

  it('shifts reminder ISO timestamp preserving local wall-clock time in timezone', () => {
    // 2026-09-01 09:30 EDT (UTC-4) -> 13:30:00.000Z
    const oldReminderIso = '2026-09-01T13:30:00.000Z'
    const shifted = shiftReminderIso(oldReminderIso, '2026-09-10', 'America/New_York')
    expect(shifted).toBe('2026-09-10T13:30:00.000Z')

    // In UTC:
    const utcReminder = '2026-08-15T10:00:00.000Z'
    expect(shiftReminderIso(utcReminder, '2026-08-25', 'UTC')).toBe('2026-08-25T10:00:00.000Z')
    expect(shiftReminderIso(null, '2026-08-25', 'UTC')).toBeNull()
    expect(shiftReminderIso(utcReminder, null, 'UTC')).toBeNull()
  })

  it('only auto-shifts reminders when an overdue or due-today task moves to the future', () => {
    const now = new Date('2026-09-04T16:00:00.000Z')

    expect(shouldShiftReminderForDueDate('2026-09-03', '2026-09-10', 'UTC', now)).toBe(true)
    expect(shouldShiftReminderForDueDate('2026-09-04', '2026-09-10', 'UTC', now)).toBe(true)
    expect(shouldShiftReminderForDueDate('2026-09-05', '2026-09-10', 'UTC', now)).toBe(false)
    expect(shouldShiftReminderForDueDate('2026-09-03', '2026-09-04', 'UTC', now)).toBe(false)
  })
})
