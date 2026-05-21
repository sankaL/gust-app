import { useState } from 'react'
import { X } from 'lucide-react'
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
  subtaskTitles?: string[]
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
  const initialSubtaskTitles = isCreateMode ? [] : (task.subtask_titles ?? [])
  const initialRecurrence: TaskRecurrence | null = isCreateMode
    ? null
    : task.recurrence_frequency
      ? {
          frequency: task.recurrence_frequency as 'daily' | 'weekly' | 'monthly' | 'yearly',
          weekday: task.recurrence_weekday,
          day_of_month: task.recurrence_day_of_month,
          month: task.recurrence_month,
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
          if (task.recurrence_month !== null) {
            cleanUpdates.recurrence_month = null
          }
        } else if (newRecurrenceFrequency === 'monthly') {
          if (data.recurrence?.day_of_month !== task.recurrence_day_of_month || initialRecurrenceFrequency !== 'monthly') {
            cleanUpdates.recurrence_day_of_month = data.recurrence?.day_of_month ?? null
          }
          if (task.recurrence_weekday !== null) {
            cleanUpdates.recurrence_weekday = null
          }
          if (task.recurrence_month !== null) {
            cleanUpdates.recurrence_month = null
          }
        } else if (newRecurrenceFrequency === 'yearly') {
          if (data.recurrence?.month !== task.recurrence_month || initialRecurrenceFrequency !== 'yearly') {
            cleanUpdates.recurrence_month = data.recurrence?.month ?? null
          }
          if (data.recurrence?.day_of_month !== task.recurrence_day_of_month || initialRecurrenceFrequency !== 'yearly') {
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
          if (task.recurrence_month !== null) {
            cleanUpdates.recurrence_month = null
          }
        }

        const currentSubtaskTitles = task.subtask_titles ?? []
        const nextSubtaskTitles = data.subtaskTitles?.map((title) => title.trim()).filter(Boolean) ?? []
        const subtasksChanged =
          nextSubtaskTitles.length !== currentSubtaskTitles.length ||
          nextSubtaskTitles.some((title, index) => title !== currentSubtaskTitles[index])
        if (subtasksChanged) {
          cleanUpdates.subtask_titles = nextSubtaskTitles
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
      className="fixed inset-0 z-[120] flex items-end justify-center bg-black/65 p-3 backdrop-blur-md sm:items-center sm:p-5"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-extracted-task-title"
    >
      <div className="max-h-[92dvh] w-full max-w-2xl overflow-hidden rounded-[1.7rem] bg-[radial-gradient(circle_at_top_left,_rgba(186,158,255,0.18),_rgba(32,32,31,0.98)_42%,_rgba(14,14,14,1)_100%)] shadow-[0_28px_80px_rgba(0,0,0,0.62)]">
        <div className="flex max-h-[92dvh] flex-col">
          <div className="flex items-start justify-between gap-4 p-5 pb-3 sm:p-6 sm:pb-4">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-pill bg-white/6 px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">
                  {isCreateMode ? 'New task' : 'Task review'}
                </span>
                {!isCreateMode ? (
                  <span className="max-w-[12rem] truncate rounded-pill bg-surface-container-high px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">
                    {task.group_name ?? 'Inbox'}
                  </span>
                ) : null}
              </div>
              <h2
                id="edit-extracted-task-title"
                className="font-display text-2xl leading-tight text-on-surface sm:text-3xl"
              >
                {isCreateMode ? 'Add Task' : 'Edit Task'}
              </h2>
            </div>
            <button
              onClick={onClose}
              disabled={isSaving}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/8 text-on-surface-variant transition hover:bg-white/12 hover:text-on-surface active:scale-[0.98] disabled:opacity-50"
              aria-label="Close edit task"
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 sm:px-6">
            <TaskForm
              key={isCreateMode ? 'create-task-form' : task.id}
              mode={isCreateMode ? 'create' : 'edit'}
              initialTitle={initialTitle}
              initialDescription={initialDescription}
              initialGroupId={initialGroupId}
              initialDueDate={initialDueDate}
              initialReminderAt={initialReminderAt}
              initialRecurrence={initialRecurrence}
              initialSubtaskTitles={initialSubtaskTitles}
              showSubtasks={!isCreateMode}
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
    </div>
  )
}
