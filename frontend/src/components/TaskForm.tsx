import { useState, useEffect } from 'react'
import type { TaskRecurrence } from '../lib/api'
import { validateTaskFormDraft } from '../lib/taskFormModel'
import { TaskFormFields } from './TaskFormFields'
import { SubtaskDrafts, TaskFormActions } from './TaskFormSections'

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
  formId?: string
  showActions?: boolean
  isSaving?: boolean
  error?: string | null
  onErrorChange?: (error: string | null) => void
}

type TaskFormViewProps = {
  groups: GroupSummary[]
  values: Omit<TaskFormData, 'subtaskTitles'>
  subtaskTitles: string[]
  newSubtaskTitle: string
  showSubtasks: boolean
  isSaving: boolean
  isCreateMode: boolean
  isGroupDropdownOpen: boolean
  error: string | null | undefined
  formId?: string
  showActions: boolean
  onCancel?: () => void
  setters: {
    title: (value: string) => void
    description: (value: string) => void
    groupId: (value: string) => void
    dueDate: (value: string) => void
    reminderAt: (value: string) => void
    recurrence: (value: TaskRecurrence | null) => void
    groupOpen: (value: boolean) => void
    subtasks: (value: string[]) => void
    newSubtask: (value: string) => void
  }
  onAddSubtask: () => void
  onSubmit: () => void
}

function toDateTimeLocalValue(value: string | null | undefined): string {
  if (!value) return ''
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return ''
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

function useTaskFormSynchronization({ internalError, onErrorChange, isCreateMode, groupId, defaultGroupId, setGroupId, initialSubtasks, setSubtasks, setNewSubtask }: { internalError: string | null; onErrorChange?: (error: string | null) => void; isCreateMode: boolean; groupId: string; defaultGroupId: string; setGroupId: (value: string) => void; initialSubtasks: string[]; setSubtasks: (value: string[]) => void; setNewSubtask: (value: string) => void }) {
  useEffect(() => { onErrorChange?.(internalError) }, [internalError, onErrorChange])
  useEffect(() => { if (isCreateMode && !groupId && defaultGroupId) setGroupId(defaultGroupId) }, [defaultGroupId, groupId, isCreateMode, setGroupId])
  useEffect(() => { setSubtasks(initialSubtasks); setNewSubtask('') }, [initialSubtasks, setNewSubtask, setSubtasks])
}

type TaskFormDefaults = Required<Pick<TaskFormProps, 'initialTitle' | 'initialDescription' | 'initialGroupId' | 'initialDueDate' | 'initialReminderAt' | 'initialRecurrence' | 'initialSubtaskTitles' | 'showSubtasks' | 'isSaving'>>

const TASK_FORM_DEFAULTS: TaskFormDefaults = {
  initialTitle: '', initialDescription: '', initialGroupId: '', initialDueDate: '', initialReminderAt: '', initialRecurrence: null, initialSubtaskTitles: [], showSubtasks: false, isSaving: false,
}

async function submitTaskForm({ values, subtasks, showSubtasks, isCreateMode, onSave, onError }: { values: Omit<TaskFormData, 'subtaskTitles'>; subtasks: string[]; showSubtasks: boolean; isCreateMode: boolean; onSave: TaskFormProps['onSave']; onError: (error: string | null) => void }) {
  onError(null)
  const validationError = validateTaskFormDraft(values, isCreateMode)
  if (validationError) { onError(validationError); return }
  await onSave({ ...values, title: values.title.trim(), description: values.description.trim(), subtaskTitles: showSubtasks ? subtasks.map((title) => title.trim()).filter(Boolean) : undefined })
}

export function TaskForm(props: TaskFormProps) {
  return <TaskFormResolved {...TASK_FORM_DEFAULTS} {...props} />
}

function TaskFormResolved(props: TaskFormProps & TaskFormDefaults) {
  return <TaskFormView {...useTaskFormViewProps(props)} />
}

function useTaskFormViewProps({
  mode,
  initialTitle,
  initialDescription,
  initialGroupId,
  initialDueDate,
  initialReminderAt,
  initialRecurrence,
  initialSubtaskTitles,
  showSubtasks,
  groups,
  defaultGroupId,
  onSave,
  onCancel,
  formId,
  showActions = true,
  isSaving,
  error: externalError,
  onErrorChange,
}: TaskFormProps & TaskFormDefaults): TaskFormViewProps {
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

  useTaskFormSynchronization({ internalError, onErrorChange, isCreateMode, groupId, defaultGroupId: defaultGroupIdFinal, setGroupId, initialSubtasks: initialSubtaskTitles, setSubtasks: setSubtaskTitles, setNewSubtask: setNewSubtaskTitle })

  function addSubtaskDraft() { const next = newSubtaskTitle.trim(); if (next) { setSubtaskTitles((current) => [...current, next]); setNewSubtaskTitle('') } }
  const handleSubmit = () => submitTaskForm({ values: { title, description, groupId, dueDate, reminderAt, recurrence }, subtasks: subtaskTitles, showSubtasks, isCreateMode, onSave, onError: setInternalError })

  return { groups, values: { title, description, groupId, dueDate, reminderAt, recurrence }, subtaskTitles, newSubtaskTitle, showSubtasks, isSaving, isCreateMode, isGroupDropdownOpen, error, formId, showActions, onCancel, setters: { title: setTitle, description: setDescription, groupId: setGroupId, dueDate: setDueDate, reminderAt: setReminderAt, recurrence: setRecurrence, groupOpen: setIsGroupDropdownOpen, subtasks: setSubtaskTitles, newSubtask: setNewSubtaskTitle }, onAddSubtask: addSubtaskDraft, onSubmit: () => void handleSubmit() }
}

function TaskFormView({ groups, values, subtaskTitles, newSubtaskTitle, showSubtasks, isSaving, isCreateMode, isGroupDropdownOpen, error, formId, showActions, onCancel, setters, onAddSubtask, onSubmit }: TaskFormViewProps) {
  return (
    <form id={formId} className="space-y-5" onSubmit={(event) => { event.preventDefault(); onSubmit() }}>
      {/* Error display */}
      {error && (
        <div className="rounded-lg border border-error/35 bg-[rgba(80,18,18,0.92)] p-3 text-sm text-red-100 shadow-[0_12px_24px_rgba(0,0,0,0.35)]">
          {error}
        </div>
      )}

      <TaskFormFields
        {...values}
        groups={groups}
        isGroupDropdownOpen={isGroupDropdownOpen}
        disabled={isSaving}
        onTitleChange={setters.title}
        onDescriptionChange={setters.description}
        onGroupIdChange={setters.groupId}
        onDueDateChange={setters.dueDate}
        onReminderAtChange={setters.reminderAt}
        onRecurrenceChange={setters.recurrence}
        onGroupDropdownOpenChange={setters.groupOpen}
      />

      {showSubtasks ? <SubtaskDrafts titles={subtaskTitles} newTitle={newSubtaskTitle} disabled={isSaving} onTitlesChange={setters.subtasks} onNewTitleChange={setters.newSubtask} onAdd={onAddSubtask} /> : null}

      {/* Action Buttons (for standalone mode) */}
      {showActions && onCancel ? <TaskFormActions isSaving={isSaving} isCreateMode={isCreateMode} onCancel={onCancel} onSave={onSubmit} /> : null}
    </form>
  )
}
