import { useState, useEffect } from 'react'
import { ExtractedTask, GroupSummary, createTask, updateExtractedTask } from '../lib/api'
import type { ExtractedTaskUpdates, TaskRecurrence } from '../lib/api'
import { SelectDropdown } from './SelectDropdown'

interface EditExtractedTaskModalProps {
  task: ExtractedTask | null
  groups: GroupSummary[]
  isOpen: boolean
  onClose: () => void
  onSave: (taskId: string, updates: ExtractedTaskUpdates) => Promise<void>
  csrfToken: string
  defaultGroupId?: string
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
]

function normalizeRecurrenceFrequency(value: string | null): string {
  if (value === 'daily' || value === 'weekly' || value === 'monthly') return value
  return 'none'
}

export function EditExtractedTaskModal({
  task,
  groups,
  isOpen,
  onClose,
  onSave,
  csrfToken,
  defaultGroupId,
}: EditExtractedTaskModalProps) {
  const isCreateMode = task === null

  // Default values for create mode
  const defaultTitle = ''
  const defaultDescription = ''
  const defaultGroupIdFinal = defaultGroupId ?? groups[0]?.id ?? ''
  const defaultDueDate = ''
  const defaultReminderEnabled = false
  const defaultRecurrenceFrequency = 'none'
  const defaultRecurrenceWeekday: number | null = null
  const defaultRecurrenceDayOfMonth: number | null = null

  const [title, setTitle] = useState(isCreateMode ? defaultTitle : task.title)
  const [description, setDescription] = useState(
    isCreateMode ? defaultDescription : (task.description ?? '')
  )
  const [groupId, setGroupId] = useState(isCreateMode ? defaultGroupIdFinal : task.group_id)
  const [dueDate, setDueDate] = useState(isCreateMode ? defaultDueDate : (task.due_date ? task.due_date.split('T')[0] : ''))
  const [reminderEnabled, setReminderEnabled] = useState(isCreateMode ? defaultReminderEnabled : !!task.reminder_at)
  const [recurrenceFrequency, setRecurrenceFrequency] = useState(
    isCreateMode ? defaultRecurrenceFrequency : normalizeRecurrenceFrequency(task.recurrence_frequency)
  )
  const [recurrenceWeekday, setRecurrenceWeekday] = useState<number | null>(isCreateMode ? defaultRecurrenceWeekday : task.recurrence_weekday)
  const [recurrenceDayOfMonth, setRecurrenceDayOfMonth] = useState<number | null>(isCreateMode ? defaultRecurrenceDayOfMonth : task.recurrence_day_of_month)
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Reset form when task changes or when opening
  useEffect(() => {
    if (!isOpen) {
      return
    }

    if (isCreateMode) {
      setTitle(defaultTitle)
      setDescription(defaultDescription)
      setGroupId(defaultGroupIdFinal)
      setDueDate(defaultDueDate)
      setReminderEnabled(defaultReminderEnabled)
      setRecurrenceFrequency(defaultRecurrenceFrequency)
      setRecurrenceWeekday(defaultRecurrenceWeekday)
      setRecurrenceDayOfMonth(defaultRecurrenceDayOfMonth)
    } else {
      setTitle(task.title)
      setDescription(task.description ?? '')
      setGroupId(task.group_id)
      setDueDate(task.due_date ? task.due_date.split('T')[0] : '')
      setReminderEnabled(!!task.reminder_at)
      setRecurrenceFrequency(normalizeRecurrenceFrequency(task.recurrence_frequency))
      setRecurrenceWeekday(task.recurrence_weekday)
      setRecurrenceDayOfMonth(task.recurrence_day_of_month)
    }
    setError(null)
  }, [defaultReminderEnabled, isCreateMode, isOpen, task])

  useEffect(() => {
    if (!isOpen || !isCreateMode || groupId !== '') {
      return
    }

    if (defaultGroupIdFinal) {
      setGroupId(defaultGroupIdFinal)
    }
  }, [defaultGroupIdFinal, groupId, isCreateMode, isOpen])

  if (!isOpen) return null

  const handleSave = async () => {
    if (!title.trim()) {
      setError('Please enter a task title')
      return
    }

    setIsSaving(true)
    setError(null)
    try {
      if (isCreateMode) {
        if (!groupId || groupId.trim() === '') {
          setError('Please select a valid group')
          return
        }
        if (recurrenceFrequency === 'weekly' && recurrenceWeekday === null) {
          setError('Please select a day of the week for weekly recurrence')
          return
        }
        if (recurrenceFrequency === 'monthly') {
          if (recurrenceDayOfMonth === null) {
            setError('Please select a day of the month for monthly recurrence')
            return
          }
          if (recurrenceDayOfMonth < 1 || recurrenceDayOfMonth > 31) {
            setError('Day of month must be between 1 and 31')
            return
          }
        }

        // Build createTask payload
        const recurrence: TaskRecurrence | null = recurrenceFrequency === 'none' ? null : {
          frequency: recurrenceFrequency as 'daily' | 'weekly' | 'monthly',
          weekday: recurrenceFrequency === 'weekly' ? (recurrenceWeekday ?? null) : null,
          day_of_month: recurrenceFrequency === 'monthly' ? (recurrenceDayOfMonth ?? null) : null,
        }

        const created = await createTask(
          {
            title: title.trim(),
            description: description.trim() || null,
            group_id: groupId || '',
            due_date: dueDate || null,
            reminder_at: null,  // Frontend has no time picker; reminder set via due_date in edit mode
            recurrence,
          },
          csrfToken
        )
        await onSave(created.id, { title: title.trim() })
      } else {
        // Build updates object with only changed fields
        const cleanUpdates: ExtractedTaskUpdates = {}

        const trimmedTitle = title.trim()
        const trimmedDescription = description.trim()
        const initialDueDate = task.due_date ? task.due_date.split('T')[0] : ''
        const initialReminderEnabled = !!task.reminder_at
        const initialRecurrenceFrequency = task.recurrence_frequency || 'none'

        if (trimmedTitle !== task.title) {
          cleanUpdates.title = trimmedTitle
        }
        if ((trimmedDescription || null) !== task.description) {
          cleanUpdates.description = trimmedDescription || null
        }
        if (groupId !== task.group_id) {
          cleanUpdates.group_id = groupId
        }
        if (dueDate !== initialDueDate) {
          cleanUpdates.due_date = dueDate || null
        }

        if (reminderEnabled && !dueDate) {
          setError('Please set a due date before enabling a reminder')
          return
        }
        const shouldUpdateReminderAt =
          reminderEnabled !== initialReminderEnabled || (reminderEnabled && dueDate !== initialDueDate)
        if (shouldUpdateReminderAt) {
          cleanUpdates.reminder_at = reminderEnabled
            ? new Date(`${dueDate}T09:00:00`).toISOString()
            : null
        }

        // Recurrence: backend expects daily/weekly/monthly or null.
        if (recurrenceFrequency !== initialRecurrenceFrequency) {
          cleanUpdates.recurrence_frequency = recurrenceFrequency === 'none' ? null : recurrenceFrequency
        }

        if (recurrenceFrequency === 'weekly') {
          if (recurrenceWeekday === null) {
            setError('Please select a day of the week for weekly recurrence')
            return
          }
          if (
            recurrenceWeekday !== task.recurrence_weekday ||
            initialRecurrenceFrequency !== 'weekly'
          ) {
            cleanUpdates.recurrence_weekday = recurrenceWeekday
          }
          if (task.recurrence_day_of_month !== null) {
            cleanUpdates.recurrence_day_of_month = null
          }
        } else if (recurrenceFrequency === 'monthly') {
          if (recurrenceDayOfMonth === null) {
            setError('Please select a day of the month for monthly recurrence')
            return
          }
          if (recurrenceDayOfMonth < 1 || recurrenceDayOfMonth > 31) {
            setError('Day of month must be between 1 and 31')
            return
          }
          if (
            recurrenceDayOfMonth !== task.recurrence_day_of_month ||
            initialRecurrenceFrequency !== 'monthly'
          ) {
            cleanUpdates.recurrence_day_of_month = recurrenceDayOfMonth
          }
          if (task.recurrence_weekday !== null) {
            cleanUpdates.recurrence_weekday = null
          }
        } else {
          if (task.recurrence_weekday !== null) {
            cleanUpdates.recurrence_weekday = null
          }
          if (task.recurrence_day_of_month !== null) {
            cleanUpdates.recurrence_day_of_month = null
          }
        }

        if (Object.keys(cleanUpdates).length > 0) {
          await updateExtractedTask(task.capture_id, task.id, cleanUpdates, csrfToken)
          await onSave(task.id, cleanUpdates)
        }
      }
      onClose()
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Failed to save changes')
    } finally {
      setIsSaving(false)
    }
  }

  const handleBackdropClick = (e: React.MouseEvent) => {
    if (e.target === e.currentTarget) {
      onClose()
    }
  }

  return (
    <div 
      className="fixed inset-0 bg-black/50 flex items-center justify-center z-50 p-4"
      onClick={handleBackdropClick}
    >
      <div className="bg-surface-container-high rounded-xl w-full max-w-md max-h-[90vh] overflow-y-auto">
        {/* Header */}
        <div className="flex items-center justify-between p-4 border-b border-outline-variant">
          <h2 className="text-lg font-semibold text-on-surface">
            {isCreateMode ? 'Add Task' : 'Edit Task'}
          </h2>
          <button
            onClick={onClose}
            className="p-2 text-on-surface-variant hover:text-on-surface hover:bg-surface-container transition-colors rounded-lg"
          >
            ✕
          </button>
        </div>

        {/* Content */}
        <div className="p-4 space-y-4">
          {error && (
            <div className="p-3 bg-error/10 border border-error/30 rounded-lg text-error text-sm">
              {error}
            </div>
          )}

          {/* Title */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-on-surface-variant">Title</label>
            <textarea
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              rows={2}
              className="w-full bg-surface-container-low text-on-surface px-3 py-2 rounded-lg border border-outline focus:border-primary outline-none resize-none"
              placeholder="Task title"
            />
          </div>

          <div className="space-y-1.5">
            <label className="text-sm font-medium text-on-surface-variant">Description</label>
            <textarea
              value={description}
              onChange={(e) => setDescription(e.target.value)}
              rows={3}
              className="w-full bg-surface-container-low text-on-surface px-3 py-2 rounded-lg border border-outline focus:border-primary outline-none resize-none"
              placeholder="Optional short context"
            />
          </div>

          {/* Group */}
          <SelectDropdown
            label="Group"
            options={groups.map((group) => ({ value: group.id, label: group.name }))}
            value={groupId}
            onChange={(val) => setGroupId(String(val))}
            placeholder="Select a group"
          />

          {/* Due Date */}
          <div className="space-y-1.5">
            <label className="text-sm font-medium text-on-surface-variant">Due Date</label>
            <input
              type="date"
              value={dueDate}
              onChange={(e) => setDueDate(e.target.value)}
              className="w-full bg-surface-container-low text-on-surface px-3 py-2 rounded-lg border border-outline focus:border-primary outline-none"
            />
          </div>

          {/* Reminder Toggle */}
          <div className="flex items-center justify-between">
            <div className="flex flex-col gap-0.5">
              <label className="text-sm font-medium text-on-surface-variant">Reminder</label>
              {!dueDate && (
                <span className="text-xs text-on-surface-variant/60">Set a due date first</span>
              )}
            </div>
            <button
              type="button"
              onClick={() => {
                if (!dueDate && !reminderEnabled) {
                  setError('Please set a due date before enabling a reminder')
                  return
                }
                setReminderEnabled(!reminderEnabled)
              }}
              disabled={!dueDate && !reminderEnabled}
              className={`relative inline-flex h-6 w-11 items-center rounded-full transition-colors ${
                reminderEnabled ? 'bg-primary' : dueDate ? 'bg-surface-container-high' : 'bg-surface-container-high opacity-50'
              }`}
            >
              <span
                className={`inline-block h-4 w-4 transform rounded-full bg-on-surface transition-transform ${
                  reminderEnabled ? 'translate-x-6' : 'translate-x-1'
                }`}
              />
            </button>
          </div>

          {/* Recurrence */}
          <SelectDropdown
            label="Recurrence"
            options={FREQUENCIES}
            value={recurrenceFrequency}
            onChange={(val) => setRecurrenceFrequency(String(val))}
            placeholder="Select recurrence"
          />

          {/* Weekday (for weekly) */}
          {recurrenceFrequency === 'weekly' && (
            <SelectDropdown
              label="Day of Week"
              options={WEEKDAYS}
              value={recurrenceWeekday ?? ''}
              onChange={(val) => {
                if (val === '') {
                  setRecurrenceWeekday(null)
                  return
                }
                setRecurrenceWeekday(Number(val))
              }}
              placeholder="Select a day"
            />
          )}

          {/* Day of Month (for monthly) */}
          {recurrenceFrequency === 'monthly' && (
            <div className="space-y-1.5">
              <label className="text-sm font-medium text-on-surface-variant">Day of Month</label>
              <input
                type="number"
                min={1}
                max={31}
                value={recurrenceDayOfMonth ?? ''}
                onChange={(e) => setRecurrenceDayOfMonth(e.target.value ? Number(e.target.value) : null)}
                className="w-full bg-surface-container-low text-on-surface px-3 py-2 rounded-lg border border-outline focus:border-primary outline-none"
                placeholder="1-31"
              />
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="flex items-center justify-end gap-2 p-4 border-t border-outline-variant">
          <button
            onClick={onClose}
            disabled={isSaving}
            className="px-4 py-2 text-sm font-medium text-on-surface-variant hover:text-on-surface hover:bg-surface-container rounded-lg transition-colors disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            onClick={() => void handleSave()}
            disabled={isSaving}
            className="px-4 py-2 text-sm font-medium text-surface bg-primary hover:bg-primary-dim rounded-lg transition-colors disabled:opacity-50"
          >
            {isSaving ? 'Saving...' : isCreateMode ? 'Add Task' : 'Save Changes'}
          </button>
        </div>
      </div>
    </div>
  )
}
