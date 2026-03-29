import { useState } from 'react'
import { ExtractedTask, GroupSummary, createTask, updateExtractedTask } from '../lib/api'
import type { ExtractedTaskUpdates, TaskRecurrence } from '../lib/api'
import { TaskForm } from './TaskForm'

interface EditExtractedTaskModalProps {
  task: ExtractedTask | null
  groups: GroupSummary[]
  isOpen: boolean
  onClose: () => void
  onSave: (taskId: string, updates: ExtractedTaskUpdates) => Promise<void>
  csrfToken: string
  defaultGroupId?: string
}

interface TaskFormData {
  title: string
  description: string
  groupId: string
  dueDate: string
  reminderAt: string
  recurrence: TaskRecurrence | null
}

function toDateTimeLocalValue(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
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
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isOpen) return null

  // Prepare initial values for edit mode
  const initialTitle = isCreateMode ? '' : task.title
  const initialDescription = isCreateMode ? '' : (task.description ?? '')
  const initialGroupId = isCreateMode ? '' : task.group_id
  const initialDueDate = isCreateMode ? '' : (task.due_date ? task.due_date.split('T')[0] : '')
  const initialReminderAt = isCreateMode
    ? ''
    : (task.reminder_at ? toDateTimeLocalValue(task.reminder_at) : '')
  const initialRecurrence: TaskRecurrence | null = isCreateMode
    ? null
    : task.recurrence_frequency
      ? {
          frequency: task.recurrence_frequency as 'daily' | 'weekly' | 'monthly',
          weekday: task.recurrence_weekday,
          day_of_month: task.recurrence_day_of_month,
        }
      : null

  const handleSave = async (data: TaskFormData) => {
    setIsSaving(true)
    setError(null)

    try {
      if (isCreateMode) {
        // Create new task
        const created = await createTask(
          {
            title: data.title,
            description: data.description || null,
            group_id: data.groupId,
            due_date: data.dueDate || null,
            reminder_at: data.reminderAt ? new Date(data.reminderAt).toISOString() : null,
            recurrence: data.recurrence,
          },
          csrfToken
        )
        await onSave(created.id, { title: data.title })
      } else {
        // Update existing extracted task
        const cleanUpdates: ExtractedTaskUpdates = {}

        if (data.title !== task.title) {
          cleanUpdates.title = data.title
        }
        if ((data.description || null) !== task.description) {
          cleanUpdates.description = data.description || null
        }
        if (data.groupId !== task.group_id) {
          cleanUpdates.group_id = data.groupId
        }
        const initialDueDate = task.due_date ? task.due_date.split('T')[0] : ''
        if (data.dueDate !== initialDueDate) {
          cleanUpdates.due_date = data.dueDate || null
        }

        // Reminder handling
        const shouldUpdateReminderAt = data.reminderAt !== initialReminderAt
        if (shouldUpdateReminderAt) {
          cleanUpdates.reminder_at = data.reminderAt
            ? new Date(data.reminderAt).toISOString()
            : null
        }

        // Recurrence handling
        const initialRecurrenceFrequency = task.recurrence_frequency || 'none'
        const newRecurrenceFrequency = data.recurrence?.frequency || 'none'
        if (newRecurrenceFrequency !== initialRecurrenceFrequency) {
          cleanUpdates.recurrence_frequency = newRecurrenceFrequency === 'none' ? null : newRecurrenceFrequency
        }

        if (newRecurrenceFrequency === 'weekly') {
          if (data.recurrence?.weekday !== task.recurrence_weekday || initialRecurrenceFrequency !== 'weekly') {
            cleanUpdates.recurrence_weekday = data.recurrence?.weekday ?? null
          }
          if (task.recurrence_day_of_month !== null) {
            cleanUpdates.recurrence_day_of_month = null
          }
        } else if (newRecurrenceFrequency === 'monthly') {
          if (data.recurrence?.day_of_month !== task.recurrence_day_of_month || initialRecurrenceFrequency !== 'monthly') {
            cleanUpdates.recurrence_day_of_month = data.recurrence?.day_of_month ?? null
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
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm"
      onClick={handleBackdropClick}
    >
      <div className="max-h-[90vh] w-full max-w-md overflow-y-auto rounded-[1.7rem] bg-surface-container-high shadow-[0_24px_60px_rgba(0,0,0,0.48)]">
        {/* Header */}
        <div className="flex items-center justify-between border-b border-outline/20 p-4">
          <h2 className="font-display text-lg font-semibold text-on-surface">
            {isCreateMode ? 'Add Task' : 'Edit Task'}
          </h2>
          <button
            onClick={onClose}
            disabled={isSaving}
            className="rounded-lg p-2 text-on-surface-variant transition-colors hover:bg-surface-container hover:text-on-surface disabled:opacity-50"
          >
            <svg
              width="20"
              height="20"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
            >
              <line x1="18" y1="6" x2="6" y2="18" />
              <line x1="6" y1="6" x2="18" y2="18" />
            </svg>
          </button>
        </div>

        {/* Content */}
        <div className="p-4">
          <TaskForm
            key={isCreateMode ? 'create-task-form' : task.id}
            mode={isCreateMode ? 'create' : 'edit'}
            initialTitle={initialTitle}
            initialDescription={initialDescription}
            initialGroupId={initialGroupId}
            initialDueDate={initialDueDate}
            initialReminderAt={initialReminderAt}
            initialRecurrence={initialRecurrence}
            groups={groups}
            defaultGroupId={defaultGroupId}
            onSave={handleSave}
            onCancel={onClose}
            isSaving={isSaving}
            error={error}
            onErrorChange={setError}
          />
        </div>
      </div>
    </div>
  )
}
