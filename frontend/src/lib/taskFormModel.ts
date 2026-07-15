import type { ExtractedTask, ExtractedTaskUpdates, TaskDetail, TaskRecurrence } from './api'
import { dateTimeLocalToIso, toDateTimeLocalValue } from './dateTime'

export type TaskFormDraft = {
  title: string
  description: string
  groupId: string
  dueDate: string
  reminderAt: string
  recurrence: TaskRecurrence | null
  subtaskTitles: string[]
}

export type TaskDetailDraft = Omit<TaskFormDraft, 'subtaskTitles'>

export const RECURRENCE_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
] as const

export const RECURRENCE_WEEKDAYS = [
  { value: '', label: 'Select a day' },
  { value: 0, label: 'Sunday' },
  { value: 1, label: 'Monday' },
  { value: 2, label: 'Tuesday' },
  { value: 3, label: 'Wednesday' },
  { value: 4, label: 'Thursday' },
  { value: 5, label: 'Friday' },
  { value: 6, label: 'Saturday' },
]

export const RECURRENCE_MONTHS = [
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

function isTaskRecurrenceFrequency(
  value: string | null | undefined
): value is TaskRecurrence['frequency'] {
  return value === 'daily' || value === 'weekly' || value === 'monthly' || value === 'yearly'
}

export function recurrenceForDueDate(
  frequency: TaskRecurrence['frequency'],
  dueDate: string,
  emptyValue: number | null = 1
): TaskRecurrence {
  if (frequency === 'daily') {
    return { frequency, weekday: null, day_of_month: null, month: null }
  }

  const localDate = dueDate ? new Date(`${dueDate}T12:00:00`) : null
  const validDate = localDate && !Number.isNaN(localDate.getTime()) ? localDate : null
  if (frequency === 'weekly') {
    return {
      frequency,
      weekday: validDate?.getDay() ?? null,
      day_of_month: null,
      month: null,
    }
  }

  return {
    frequency,
    weekday: null,
    day_of_month: validDate?.getDate() ?? emptyValue,
    month: frequency === 'yearly' ? (validDate ? validDate.getMonth() + 1 : emptyValue) : null,
  }
}

export function buildExtractedTaskDraft(
  task: ExtractedTask,
  timezone?: string | null
): TaskFormDraft {
  return {
    title: task.title,
    description: task.description ?? '',
    groupId: task.group_id,
    dueDate: task.due_date ? task.due_date.split('T')[0] : '',
    reminderAt: toDateTimeLocalValue(task.reminder_at, timezone),
    subtaskTitles: task.subtask_titles ?? [],
    recurrence: isTaskRecurrenceFrequency(task.recurrence_frequency)
      ? {
          frequency: task.recurrence_frequency,
          weekday: task.recurrence_weekday,
          day_of_month: task.recurrence_day_of_month,
          month: task.recurrence_month,
        }
      : null,
  }
}

export function buildTaskDetailDraft(
  task: TaskDetail,
  timezone?: string | null
): TaskDetailDraft {
  return {
    title: task.title,
    description: task.description ?? '',
    groupId: task.group.id,
    dueDate: task.due_date ?? '',
    reminderAt: toDateTimeLocalValue(task.reminder_at, timezone),
    recurrence: task.recurrence,
  }
}

function changedSubtasks(task: ExtractedTask, draft: TaskFormDraft): string[] | undefined {
  const current = task.subtask_titles ?? []
  const next = draft.subtaskTitles.map((title) => title.trim()).filter(Boolean)
  const changed = next.length !== current.length || next.some((title, index) => title !== current[index])
  return changed ? next : undefined
}

function applyRecurrenceUpdates(
  updates: ExtractedTaskUpdates,
  task: ExtractedTask,
  recurrence: TaskRecurrence | null
): void {
  const initialFrequency = task.recurrence_frequency ?? 'none'
  const nextFrequency = recurrence?.frequency ?? 'none'
  if (nextFrequency !== initialFrequency) {
    updates.recurrence_frequency = nextFrequency === 'none' ? null : nextFrequency
  }

  const { weekday: nextWeekday, day: nextDay, month: nextMonth } = recurrenceParts(recurrence)

  if (nextWeekday !== task.recurrence_weekday) updates.recurrence_weekday = nextWeekday
  if (nextDay !== task.recurrence_day_of_month) updates.recurrence_day_of_month = nextDay
  if (nextMonth !== task.recurrence_month) updates.recurrence_month = nextMonth
}

function recurrenceParts(recurrence: TaskRecurrence | null) {
  switch (recurrence?.frequency) {
    case 'weekly':
      return { weekday: recurrence.weekday, day: null, month: null }
    case 'monthly':
      return { weekday: null, day: recurrence.day_of_month, month: null }
    case 'yearly':
      return { weekday: null, day: recurrence.day_of_month, month: recurrence.month }
    default:
      return { weekday: null, day: null, month: null }
  }
}

export function buildExtractedTaskUpdates(
  task: ExtractedTask,
  draft: TaskFormDraft,
  timezone?: string | null
): ExtractedTaskUpdates {
  const updates: ExtractedTaskUpdates = {}
  if (draft.title !== task.title) updates.title = draft.title
  if ((draft.description || null) !== task.description) updates.description = draft.description || null
  if (draft.groupId !== task.group_id) updates.group_id = draft.groupId

  const subtasks = changedSubtasks(task, draft)
  if (subtasks) updates.subtask_titles = subtasks

  const initialDueDate = task.due_date ? task.due_date.split('T')[0] : ''
  if (draft.dueDate !== initialDueDate) updates.due_date = draft.dueDate || null

  const initialReminder = toDateTimeLocalValue(task.reminder_at, timezone)
  if (draft.reminderAt !== initialReminder) {
    updates.reminder_at = dateTimeLocalToIso(draft.reminderAt, timezone)
  }

  applyRecurrenceUpdates(updates, task, draft.recurrence)
  return updates
}

export function validateTaskFormDraft(
  draft: Pick<TaskFormDraft, 'title' | 'groupId' | 'recurrence'>,
  requireGroup: boolean
): string | null {
  if (!draft.title.trim()) return 'Please enter a task title'
  if (requireGroup && !draft.groupId.trim()) return 'Please select a valid group'

  const recurrence = draft.recurrence
  switch (recurrence?.frequency) {
    case 'weekly':
      return recurrence.weekday === null
        ? 'Please select a day of the week for weekly recurrence'
        : null
    case 'monthly':
      return validateDayOfMonth(recurrence.day_of_month, 'monthly')
    case 'yearly': {
      if (recurrence.month === null) return 'Please select a month for yearly recurrence'
      if (recurrence.month < 1 || recurrence.month > 12) return 'Month must be between 1 and 12'
      return validateDayOfMonth(recurrence.day_of_month, 'yearly')
    }
    default:
      return null
  }
}

function validateDayOfMonth(value: number | null, frequency: 'monthly' | 'yearly'): string | null {
  if (value === null) return `Please select a day of the month for ${frequency} recurrence`
  return value < 1 || value > 31 ? 'Day of month must be between 1 and 31' : null
}
