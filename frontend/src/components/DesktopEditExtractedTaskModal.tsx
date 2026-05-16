import { useEffect, useState } from 'react'
import { Save, X } from 'lucide-react'

import {
  updateExtractedTask,
  type ExtractedTask,
  type ExtractedTaskUpdates,
  type GroupSummary,
  type TaskRecurrence,
} from '../lib/api'
import { dateTimeLocalToIso, toDateTimeLocalValue } from '../lib/dateTime'
import { DatePicker } from './DatePicker'
import { SelectDropdown } from './SelectDropdown'

type DesktopEditExtractedTaskModalProps = {
  task: ExtractedTask | null
  groups: GroupSummary[]
  isOpen: boolean
  onClose: () => void
  onSave: (taskId: string, updates: ExtractedTaskUpdates) => Promise<void>
  csrfToken: string
  timezone?: string | null
}

type DraftState = {
  title: string
  description: string
  groupId: string
  dueDate: string
  reminderAt: string
  recurrence: TaskRecurrence | null
}

const RECURRENCE_OPTIONS = [
  { value: 'none', label: 'None' },
  { value: 'daily', label: 'Daily' },
  { value: 'weekly', label: 'Weekly' },
  { value: 'monthly', label: 'Monthly' },
  { value: 'yearly', label: 'Yearly' },
] as const

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

function isTaskRecurrenceFrequency(value: string | null): value is TaskRecurrence['frequency'] {
  return value === 'daily' || value === 'weekly' || value === 'monthly' || value === 'yearly'
}

function buildDraft(task: ExtractedTask, timezone: string | null | undefined): DraftState {
  return {
    title: task.title,
    description: task.description ?? '',
    groupId: task.group_id,
    dueDate: task.due_date ? task.due_date.split('T')[0] : '',
    reminderAt: toDateTimeLocalValue(task.reminder_at, timezone),
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

function recurrenceForDueDate(
  frequency: TaskRecurrence['frequency'],
  dueDate: string
): TaskRecurrence {
  if (frequency === 'daily') {
    return { frequency, weekday: null, day_of_month: null, month: null }
  }

  const localDate = dueDate ? new Date(`${dueDate}T12:00:00`) : null
  if (frequency === 'weekly') {
    return {
      frequency,
      weekday: localDate && !Number.isNaN(localDate.getTime()) ? localDate.getDay() : null,
      day_of_month: null,
      month: null,
    }
  }

  const parts = dueDate.split('-')
  const dayOfMonth = dueDate ? Number(parts[2] ?? 1) : 1
  if (frequency === 'yearly') {
    return {
      frequency,
      weekday: null,
      day_of_month: dayOfMonth,
      month: dueDate ? Number(parts[1] ?? 1) : 1,
    }
  }

  return { frequency, weekday: null, day_of_month: dayOfMonth, month: null }
}

function buildUpdates(
  task: ExtractedTask,
  draft: DraftState,
  timezone: string | null | undefined
): ExtractedTaskUpdates {
  const updates: ExtractedTaskUpdates = {}
  if (draft.title !== task.title) updates.title = draft.title
  if ((draft.description || null) !== task.description) updates.description = draft.description || null
  if (draft.groupId !== task.group_id) updates.group_id = draft.groupId

  const initialDueDate = task.due_date ? task.due_date.split('T')[0] : ''
  if (draft.dueDate !== initialDueDate) updates.due_date = draft.dueDate || null

  const initialReminderAt = task.reminder_at ? toDateTimeLocalValue(task.reminder_at, timezone) : ''
  if (draft.reminderAt !== initialReminderAt) {
    updates.reminder_at = dateTimeLocalToIso(draft.reminderAt, timezone)
  }

  const initialFrequency = task.recurrence_frequency || 'none'
  const nextFrequency = draft.recurrence?.frequency || 'none'
  if (nextFrequency !== initialFrequency) {
    updates.recurrence_frequency = nextFrequency === 'none' ? null : nextFrequency
  }

  if (nextFrequency === 'weekly') {
    if (draft.recurrence?.weekday !== task.recurrence_weekday || initialFrequency !== 'weekly') {
      updates.recurrence_weekday = draft.recurrence?.weekday ?? null
    }
    if (task.recurrence_day_of_month !== null) updates.recurrence_day_of_month = null
    if (task.recurrence_month !== null) updates.recurrence_month = null
  } else if (nextFrequency === 'monthly') {
    if (
      draft.recurrence?.day_of_month !== task.recurrence_day_of_month ||
      initialFrequency !== 'monthly'
    ) {
      updates.recurrence_day_of_month = draft.recurrence?.day_of_month ?? null
    }
    if (task.recurrence_weekday !== null) updates.recurrence_weekday = null
    if (task.recurrence_month !== null) updates.recurrence_month = null
  } else if (nextFrequency === 'yearly') {
    if (draft.recurrence?.month !== task.recurrence_month || initialFrequency !== 'yearly') {
      updates.recurrence_month = draft.recurrence?.month ?? null
    }
    if (
      draft.recurrence?.day_of_month !== task.recurrence_day_of_month ||
      initialFrequency !== 'yearly'
    ) {
      updates.recurrence_day_of_month = draft.recurrence?.day_of_month ?? null
    }
    if (task.recurrence_weekday !== null) updates.recurrence_weekday = null
  } else {
    if (task.recurrence_weekday !== null) updates.recurrence_weekday = null
    if (task.recurrence_day_of_month !== null) updates.recurrence_day_of_month = null
    if (task.recurrence_month !== null) updates.recurrence_month = null
  }

  return updates
}

export function DesktopEditExtractedTaskModal({
  task,
  groups,
  isOpen,
  onClose,
  onSave,
  csrfToken,
  timezone,
}: DesktopEditExtractedTaskModalProps) {
  const [draft, setDraft] = useState<DraftState | null>(null)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isGroupDropdownOpen, setIsGroupDropdownOpen] = useState(false)

  useEffect(() => {
    setDraft(task ? buildDraft(task, timezone) : null)
    setError(null)
    setIsGroupDropdownOpen(false)
  }, [task, timezone])

  useEffect(() => {
    if (!isOpen) return undefined
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen || !task || !draft) return null

  function updateDraft(updater: (current: DraftState) => DraftState) {
    setDraft((current) => (current ? updater(current) : current))
  }

  async function handleSave() {
    if (!task || !draft) return
    const currentTask = task
    const currentDraft = draft

    if (!currentDraft.title.trim()) {
      setError('Please enter a task title')
      return
    }
    setIsSaving(true)
    setError(null)

    let serverSaved = false
    try {
      const cleanUpdates = buildUpdates(
        currentTask,
        {
          ...currentDraft,
          title: currentDraft.title.trim(),
        },
        timezone
      )
      if (Object.keys(cleanUpdates).length > 0) {
        await updateExtractedTask(currentTask.capture_id, currentTask.id, cleanUpdates, csrfToken)
        serverSaved = true
        await onSave(currentTask.id, cleanUpdates)
      }
      onClose()
    } catch (err) {
      if (serverSaved) {
        onClose()
        return
      }
      setError(err instanceof Error ? err.message : 'Failed to save changes')
    } finally {
      setIsSaving(false)
    }
  }

  const recurrenceFrequency = draft.recurrence?.frequency ?? 'none'

  return (
    <div
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-5 backdrop-blur-sm"
      role="dialog"
      aria-modal="true"
      aria-labelledby="desktop-extracted-task-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="flex max-h-[90dvh] w-full max-w-5xl flex-col overflow-hidden rounded-[1.35rem] bg-[radial-gradient(circle_at_top_left,_rgba(186,158,255,0.14),_rgba(31,31,30,0.98)_40%,_rgba(14,14,14,1)_100%)] shadow-[0_28px_80px_rgba(0,0,0,0.62)]">
        <header className="flex items-start justify-between gap-5 border-b border-white/10 px-6 py-5">
          <div>
            <span className="block text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">
              Extracted task
            </span>
            <h2 id="desktop-extracted-task-title" className="mt-3 font-display text-3xl text-on-surface">
              Edit Task
            </h2>
          </div>
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="flex h-10 w-10 items-center justify-center rounded-full bg-white/8 text-on-surface-variant transition hover:bg-white/12 hover:text-on-surface disabled:opacity-50"
            aria-label="Close edit task"
          >
            <X className="h-4 w-4" strokeWidth={2} />
          </button>
        </header>

        <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
          {error ? (
            <div className="mb-4 rounded-card border border-error/35 bg-[rgba(80,18,18,0.92)] p-3 text-sm text-red-100">
              {error}
            </div>
          ) : null}

          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(24rem,0.95fr)]">
            <section className="space-y-5">
              <div>
                <label className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">
                  Title
                </label>
                <input
                  value={draft.title}
                  onChange={(event) => updateDraft((current) => ({ ...current, title: event.target.value }))}
                  className="mt-2 w-full rounded-card bg-surface/65 px-4 py-3 font-display text-2xl text-on-surface outline-none ring-1 ring-white/10 transition focus:bg-surface-container focus:ring-primary"
                  disabled={isSaving}
                  aria-label="Task title"
                />
              </div>

              <div>
                <label className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">
                  Context
                </label>
                <textarea
                  value={draft.description}
                  onChange={(event) =>
                    updateDraft((current) => ({ ...current, description: event.target.value }))
                  }
                  rows={9}
                  className="mt-2 w-full resize-none rounded-card bg-surface/55 px-4 py-3 font-body text-sm leading-6 text-on-surface outline-none ring-1 ring-white/10 transition placeholder:text-on-surface-variant/45 focus:bg-surface-container focus:ring-primary"
                  placeholder="Add context that helps you act on this later"
                  disabled={isSaving}
                  aria-label="Task description"
                />
              </div>
            </section>

            <section className="space-y-4">
              <div className="rounded-card bg-surface/35">
                <div className="grid border-b border-white/10 px-4 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-center">
                  <p className="font-body text-xs font-semibold uppercase tracking-[0.13em] text-on-surface-variant">Group</p>
                  <div className={isGroupDropdownOpen ? 'relative z-40' : ''}>
                    <SelectDropdown
                      label=""
                      options={groups.map((group) => ({ value: group.id, label: group.name }))}
                      value={draft.groupId}
                      onChange={(value) =>
                        updateDraft((current) => ({ ...current, groupId: value as string }))
                      }
                      onOpenChange={setIsGroupDropdownOpen}
                      disabled={isSaving}
                    />
                  </div>
                </div>

                <div className="grid border-b border-white/10 px-4 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-center">
                  <p className="font-body text-xs font-semibold uppercase tracking-[0.13em] text-on-surface-variant">Due date</p>
                  <DatePicker
                    value={draft.dueDate || null}
                    onChange={(value) => {
                      if (!value) {
                        updateDraft((current) => ({ ...current, dueDate: '', reminderAt: '', recurrence: null }))
                      } else {
                        updateDraft((current) => ({ ...current, dueDate: value }))
                      }
                    }}
                    mode="date"
                    disabled={isSaving}
                    placeholder="Select a date"
                  />
                </div>

                <div className="grid border-b border-white/10 px-4 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-center">
                  <p className="font-body text-xs font-semibold uppercase tracking-[0.13em] text-on-surface-variant">Reminder</p>
                  <DatePicker
                    value={draft.reminderAt || null}
                    onChange={(value) => updateDraft((current) => ({ ...current, reminderAt: value }))}
                    mode="datetime"
                    disabled={!draft.dueDate || isSaving}
                    placeholder={draft.dueDate ? 'Select date & time' : 'Set a due date first'}
                  />
                </div>

                <div className="grid px-4 py-3 sm:grid-cols-[9rem_minmax(0,1fr)] sm:items-start">
                  <p className="font-body text-xs font-semibold uppercase tracking-[0.13em] text-on-surface-variant">Recurrence</p>
                  <div className="space-y-3">
                    <div className="flex flex-wrap gap-2">
                      {RECURRENCE_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          disabled={!draft.dueDate || isSaving}
                          onClick={() => {
                            if (option.value === 'none') {
                              updateDraft((current) => ({ ...current, recurrence: null }))
                            } else {
                              updateDraft((current) => ({
                                ...current,
                                recurrence: recurrenceForDueDate(option.value, current.dueDate),
                              }))
                            }
                          }}
                          className={[
                            'min-w-[4.75rem] rounded-card px-3 py-2 text-center text-sm font-medium transition',
                            recurrenceFrequency === option.value
                              ? 'bg-primary text-surface'
                              : 'bg-surface-dim text-on-surface-variant hover:bg-surface-container-high',
                            !draft.dueDate ? 'opacity-50' : '',
                          ].join(' ')}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>

                    {draft.recurrence?.frequency === 'weekly' ? (
                      <SelectDropdown
                        label=""
                        options={WEEKDAYS}
                        value={draft.recurrence.weekday ?? ''}
                        onChange={(value) =>
                          updateDraft((current) => ({
                            ...current,
                            recurrence: {
                              frequency: 'weekly',
                              weekday: value === '' ? null : Number(value),
                              day_of_month: null,
                              month: null,
                            },
                          }))
                        }
                        disabled={isSaving}
                      />
                    ) : null}

                    {draft.recurrence?.frequency === 'monthly' || draft.recurrence?.frequency === 'yearly' ? (
                      <div className="grid gap-3 sm:grid-cols-2">
                        {draft.recurrence.frequency === 'yearly' ? (
                          <SelectDropdown
                            label=""
                            options={MONTHS}
                            value={draft.recurrence.month ?? ''}
                            onChange={(value) =>
                              updateDraft((current) => ({
                                ...current,
                                recurrence: {
                                  frequency: 'yearly',
                                  weekday: null,
                                  day_of_month: current.recurrence?.day_of_month ?? 1,
                                  month: value === '' ? null : Number(value),
                                },
                              }))
                            }
                            disabled={isSaving}
                          />
                        ) : null}
                        <input
                          type="number"
                          min={1}
                          max={31}
                          value={draft.recurrence.day_of_month ?? ''}
                          onChange={(event) =>
                            updateDraft((current) => ({
                              ...current,
                              recurrence: {
                                frequency: draft.recurrence?.frequency ?? 'monthly',
                                weekday: null,
                                day_of_month: event.target.value ? Number(event.target.value) : null,
                                month:
                                  draft.recurrence?.frequency === 'yearly'
                                    ? (draft.recurrence.month ?? 1)
                                    : null,
                              },
                            }))
                          }
                          className="w-full rounded-card bg-surface-dim px-3 py-3 text-sm font-medium text-on-surface outline-none ring-1 ring-white/10 focus:ring-primary"
                          disabled={isSaving}
                          aria-label="Recurrence day of month"
                          placeholder="Day"
                        />
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </section>
          </div>
        </div>

        <footer className="flex justify-end gap-3 border-t border-white/10 bg-[rgba(20,20,20,0.86)] px-6 py-4 backdrop-blur-xl">
          <button
            type="button"
            onClick={onClose}
            disabled={isSaving}
            className="rounded-pill bg-white/5 px-5 py-2.5 text-sm font-medium text-on-surface transition hover:bg-white/10 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSave()}
            disabled={isSaving}
            className="inline-flex items-center gap-2 rounded-pill bg-primary px-5 py-2.5 text-sm font-semibold text-surface transition hover:-translate-y-px active:translate-y-0 disabled:opacity-50"
          >
            <Save className="h-4 w-4" strokeWidth={2} />
            {isSaving ? 'Saving...' : 'Save changes'}
          </button>
        </footer>
      </div>
    </div>
  )
}
