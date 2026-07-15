import { useState, useEffect } from 'react'
import { Trash2 } from 'lucide-react'
import type { TaskRecurrence } from '../lib/api'
import { validateTaskFormDraft } from '../lib/taskFormModel'
import { TaskFormFields } from './TaskFormFields'
import { AddSubtaskInput } from './AddSubtaskInput'

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
  subtaskTitles?: string[]
}

interface TaskFormProps {
  mode: 'create' | 'edit'
  initialTitle?: string
  initialDescription?: string
  initialGroupId?: string
  initialDueDate?: string
  initialReminderAt?: string
  initialRecurrence?: TaskRecurrence | null
  initialSubtaskTitles?: string[]
  showSubtasks?: boolean
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
  initialSubtaskTitles = [],
  showSubtasks = false,
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
  const [subtaskTitles, setSubtaskTitles] = useState<string[]>(initialSubtaskTitles)
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('')
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

  useEffect(() => {
    setSubtaskTitles(initialSubtaskTitles)
    setNewSubtaskTitle('')
  }, [initialSubtaskTitles])

  function addSubtaskDraft() {
    const title = newSubtaskTitle.trim()
    if (!title) return
    setSubtaskTitles((current) => [...current, title])
    setNewSubtaskTitle('')
  }

  const handleSubmit = async () => {
    setInternalError(null)
    const validationError = validateTaskFormDraft({ title, groupId, recurrence }, isCreateMode)
    if (validationError) {
      setInternalError(validationError)
      return
    }

    await onSave({
      title: title.trim(),
      description: description.trim(),
      groupId,
      dueDate,
      reminderAt,
      recurrence,
      subtaskTitles: showSubtasks ? subtaskTitles.map((subtask) => subtask.trim()).filter(Boolean) : undefined,
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

      {showSubtasks ? (
        <section className="rounded-card bg-surface-container/75 p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="font-display text-lg text-on-surface">Subtasks</p>
              <p className="mt-1 font-body text-xs text-on-surface-variant">
                {subtaskTitles.length} {subtaskTitles.length === 1 ? 'subtask' : 'subtasks'}
              </p>
            </div>
          </div>

          <div className="mt-3 space-y-2">
            {subtaskTitles.length === 0 ? (
              <div className="rounded-card bg-surface-dim px-4 py-4 text-sm text-on-surface-variant">
                No subtasks yet.
              </div>
            ) : (
              subtaskTitles.map((subtaskTitle, index) => (
                <div key={`${subtaskTitle}-${index}`} className="flex items-center gap-2 rounded-card bg-surface-dim p-2">
                  <input
                    value={subtaskTitle}
                    onChange={(event) =>
                      setSubtaskTitles((current) =>
                        current.map((title, candidateIndex) =>
                          candidateIndex === index ? event.target.value : title
                        )
                      )
                    }
                    className="min-w-0 flex-1 rounded-card bg-surface-container px-3 py-2 text-sm text-on-surface outline-none focus:bg-surface-container-high"
                    aria-label={`Subtask ${subtaskTitle || index + 1}`}
                    disabled={isSaving}
                  />
                  <button
                    type="button"
                    onClick={() =>
                      setSubtaskTitles((current) =>
                        current.filter((_title, candidateIndex) => candidateIndex !== index)
                      )
                    }
                    disabled={isSaving}
                    className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition hover:bg-tertiary/10 hover:text-tertiary disabled:opacity-50"
                    aria-label={`Delete ${subtaskTitle || `subtask ${index + 1}`}`}
                  >
                    <Trash2 className="h-4 w-4" strokeWidth={2} />
                  </button>
                </div>
              ))
            )}
          </div>

          <AddSubtaskInput
            value={newSubtaskTitle}
            disabled={isSaving}
            onChange={setNewSubtaskTitle}
            onAdd={addSubtaskDraft}
          />
        </section>
      ) : null}

      {/* Action Buttons (for standalone mode) */}
      {onCancel && (
        <div className="grid grid-cols-2 gap-3 pt-4">
          <button
            type="button"
            onClick={onCancel}
            disabled={isSaving}
            className="w-full rounded-pill border border-white/10 bg-white/5 px-4 py-3 text-center text-sm font-medium text-on-surface transition-colors hover:bg-white/10 disabled:opacity-50 disabled:hover:bg-white/5"
          >
            Cancel
          </button>
          <button
            type="button"
            onClick={() => void handleSubmit()}
            disabled={isSaving}
            className="w-full rounded-pill bg-[radial-gradient(circle_at_top,_#c4b5fd_10%,_#7c3aed_90%)] px-4 py-3 text-center text-sm font-semibold text-white shadow-[0_8px_0_#4c1d95,_0_16px_22px_rgba(0,0,0,0.35),_inset_0_2px_3px_rgba(255,255,255,0.38)] transition-all hover:-translate-y-[1px] active:translate-y-[4px] active:shadow-[0_0px_0_#4c1d95,_0_4px_10px_rgba(0,0,0,0.35),_inset_0_2px_4px_rgba(0,0,0,0.18)] disabled:opacity-50 disabled:shadow-none disabled:hover:translate-y-0 disabled:active:translate-y-0"
          >
            {isSaving ? 'Saving...' : isCreateMode ? 'Add Task' : 'Save Changes'}
          </button>
        </div>
      )}
    </div>
  )
}
