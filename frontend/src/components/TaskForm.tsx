import { useState, useEffect } from 'react'
import type { TaskRecurrence } from '../lib/api'
import { TaskFormFields } from './TaskFormFields'

interface GroupSummary {
  id: string
  name: string
}

interface TaskFormData {
  title: string
  description: string
  groupId: string
  dueDate: string
  reminderAt: string
  recurrence: TaskRecurrence | null
}

interface TaskFormProps {
  mode: 'create' | 'edit'
  initialTitle?: string
  initialDescription?: string
  initialGroupId?: string
  initialDueDate?: string
  initialReminderAt?: string
  initialRecurrence?: TaskRecurrence | null
  groups: GroupSummary[]
  defaultGroupId?: string
  onSave: (data: TaskFormData) => Promise<void> | void
  onCancel?: () => void
  isSaving?: boolean
  error?: string | null
  onErrorChange?: (error: string | null) => void
}

function toDateTimeLocalValue(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

export function TaskForm({
  mode,
  initialTitle = '',
  initialDescription = '',
  initialGroupId = '',
  initialDueDate = '',
  initialReminderAt = '',
  initialRecurrence = null,
  groups,
  defaultGroupId,
  onSave,
  onCancel,
  isSaving = false,
  error: externalError,
  onErrorChange,
}: TaskFormProps) {
  const isCreateMode = mode === 'create'
  const defaultGroupIdFinal = defaultGroupId ?? groups[0]?.id ?? ''

  const [title, setTitle] = useState(initialTitle)
  const [description, setDescription] = useState(initialDescription)
  const [groupId, setGroupId] = useState(initialGroupId || defaultGroupIdFinal)
  const [dueDate, setDueDate] = useState(initialDueDate)
  const [reminderAt, setReminderAt] = useState(toDateTimeLocalValue(initialReminderAt))
  const [recurrence, setRecurrence] = useState<TaskRecurrence | null>(initialRecurrence)
  const [internalError, setInternalError] = useState<string | null>(null)
  const [isGroupDropdownOpen, setIsGroupDropdownOpen] = useState(false)

  const error = externalError ?? internalError

  useEffect(() => {
    if (onErrorChange) {
      onErrorChange(internalError)
    }
  }, [internalError, onErrorChange])

  // Set default group when groups load
  useEffect(() => {
    if (isCreateMode && groupId === '' && defaultGroupIdFinal) {
      setGroupId(defaultGroupIdFinal)
    }
  }, [defaultGroupIdFinal, groupId, isCreateMode])

  const handleSubmit = async () => {
    setInternalError(null)

    // Validation
    if (!title.trim()) {
      setInternalError('Please enter a task title')
      return
    }

    if (isCreateMode && (!groupId || groupId.trim() === '')) {
      setInternalError('Please select a valid group')
      return
    }

    if (recurrence?.frequency === 'weekly' && recurrence.weekday === null) {
      setInternalError('Please select a day of the week for weekly recurrence')
      return
    }

    if (recurrence?.frequency === 'monthly') {
      if (recurrence.day_of_month === null) {
        setInternalError('Please select a day of the month for monthly recurrence')
        return
      }
      if (recurrence.day_of_month < 1 || recurrence.day_of_month > 31) {
        setInternalError('Day of month must be between 1 and 31')
        return
      }
    }

    await onSave({
      title: title.trim(),
      description: description.trim(),
      groupId,
      dueDate,
      reminderAt,
      recurrence,
    })
  }

  return (
    <div className="space-y-5">
      {/* Error display */}
      {error && (
        <div className="rounded-lg border border-error/35 bg-[rgba(80,18,18,0.92)] p-3 text-sm text-red-100 shadow-[0_12px_24px_rgba(0,0,0,0.35)]">
          {error}
        </div>
      )}

      <TaskFormFields
        title={title}
        description={description}
        groupId={groupId}
        dueDate={dueDate}
        reminderAt={reminderAt}
        recurrence={recurrence}
        groups={groups}
        isGroupDropdownOpen={isGroupDropdownOpen}
        disabled={isSaving}
        onTitleChange={setTitle}
        onDescriptionChange={setDescription}
        onGroupIdChange={setGroupId}
        onDueDateChange={setDueDate}
        onReminderAtChange={setReminderAt}
        onRecurrenceChange={setRecurrence}
        onGroupDropdownOpenChange={setIsGroupDropdownOpen}
      />

      {/* Action Buttons (for standalone mode) */}
      {onCancel && (
        <div className="flex items-center justify-end gap-2 pt-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSaving}
            className="rounded-pill border border-white/10 bg-white/5 px-4 py-3 text-sm font-medium text-on-surface transition hover:bg-white/10 disabled:opacity-50"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={isSaving}
            className="rounded-pill bg-[radial-gradient(circle_at_top,_#c4b5fd_10%,_#7c3aed_90%)] px-4 py-3 text-sm font-semibold text-white shadow-[0_8px_0_#4c1d95,_0_16px_22px_rgba(0,0,0,0.35),_inset_0_2px_3px_rgba(255,255,255,0.38)] transition-all hover:-translate-y-[1px] active:translate-y-[4px] active:shadow-[0_0px_0_#4c1d95,_0_4px_10px_rgba(0,0,0,0.35),_inset_0_2px_4px_rgba(0,0,0,0.18)] disabled:opacity-50 disabled:hover:translate-y-0 disabled:active:translate-y-0"
          >
            {isSaving ? 'Saving...' : isCreateMode ? 'Add Task' : 'Save Changes'}
          </button>
        </div>
      )}
    </div>
  )
}
