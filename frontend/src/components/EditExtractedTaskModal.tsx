import { useEffect, useMemo, useState } from 'react'
import { Bell, CalendarDays, FolderKanban, ListTodo, PencilLine, Repeat2, TextQuote, X } from 'lucide-react'
import type { LucideIcon } from 'lucide-react'
import { ExtractedTask, GroupSummary, createSubtask, createTask, updateExtractedTask } from '../lib/api'
import type { ExtractedTaskUpdates } from '../lib/api'
import {
  buildExtractedTaskDraft,
  buildExtractedTaskUpdates,
  recurrenceForDueDate,
  validateTaskFormDraft,
  type TaskFormDraft,
} from '../lib/taskFormModel'
import { formatDate, formatDateTime, formatRecurrence } from '../lib/taskFormatters'
import { DatePicker } from './DatePicker'
import { SelectDropdown } from './SelectDropdown'
import { TaskFormFields } from './TaskFormFields'
import { SubtaskDrafts } from './TaskFormSections'
import { TaskRecurrenceFields } from './TaskRecurrenceFields'

interface EditExtractedTaskModalProps {
  task: ExtractedTask | null
  groups: GroupSummary[]
  isOpen: boolean
  onClose: () => void
  onSave: (taskId: string, updates: ExtractedTaskUpdates) => Promise<void>
  onSaved?: () => void
  csrfToken: string
  defaultGroupId?: string
}

type EditableSection = 'title' | 'context' | 'dueDate' | 'reminder' | 'group' | 'recurrence' | 'subtasks'
type PendingTaskCreation = {
  taskId: string
  title: string
  subtaskTitles: string[]
  nextSubtaskIndex: number
}

const sectionIcons: Record<Exclude<EditableSection, 'title'>, LucideIcon> = {
  context: TextQuote,
  dueDate: CalendarDays,
  reminder: Bell,
  group: FolderKanban,
  recurrence: Repeat2,
  subtasks: ListTodo,
}

function ReadOnlySectionCard({
  label,
  icon: Icon,
  children,
  onClick,
  onDoubleClick,
}: {
  label: string
  icon: LucideIcon
  children: React.ReactNode
  onClick?: () => void
  onDoubleClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className="group relative block w-full cursor-pointer rounded-[1.25rem] bg-surface-container/55 p-3.5 text-left transition-[background-color,transform] hover:bg-surface-container-high/80 active:scale-[0.99]"
      title="Tap or double-click to edit"
    >
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-2">
          <Icon className="h-3.5 w-3.5 text-primary/80 transition-colors group-hover:text-primary" strokeWidth={1.8} />
          <p className="text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">
            {label}
          </p>
        </div>
        <span className="text-[0.62rem] text-primary/60 opacity-0 transition-opacity group-hover:opacity-100 sm:inline">
          Tap or double-click to edit
        </span>
      </div>
      <div className="mt-2">{children}</div>
    </button>
  )
}

function ReadOnlyMetadataTile({
  label,
  icon: Icon,
  value,
  onClick,
  onDoubleClick,
}: {
  label: string
  icon: LucideIcon
  value: string
  onClick?: () => void
  onDoubleClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className="group relative block w-full min-w-0 cursor-pointer rounded-[1.25rem] bg-surface-container/55 p-3.5 text-left transition-[background-color,transform] hover:bg-surface-container-high/80 active:scale-[0.99]"
      title="Tap or double-click to edit"
    >
      <div className="flex items-center gap-2">
        <Icon className="h-3.5 w-3.5 text-primary/75" strokeWidth={1.8} />
        <p className="text-[0.62rem] font-semibold uppercase tracking-[0.15em] text-on-surface-variant">
          {label}
        </p>
      </div>
      <p className="mt-2.5 truncate text-sm font-medium text-on-surface">{value}</p>
    </button>
  )
}

function ReadOnlySubtasksSection({
  subtasks,
  onClick,
  onDoubleClick,
}: {
  subtasks: string[]
  onClick?: () => void
  onDoubleClick?: () => void
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      onDoubleClick={onDoubleClick}
      className="group relative block w-full cursor-pointer rounded-card bg-surface-container/65 p-3.5 text-left transition-[background-color,transform] hover:bg-surface-container-high/80 active:scale-[0.99]"
      title="Tap or double-click to edit"
    >
      <div className="flex items-center justify-between">
        <div>
          <div className="flex items-center gap-2">
            <ListTodo className="h-4 w-4 text-primary/80" strokeWidth={1.8} />
            <p className="font-display text-lg text-on-surface">Subtasks</p>
          </div>
          <p className="mt-1 font-body text-xs text-on-surface-variant">
            {subtasks.length} {subtasks.length === 1 ? 'subtask' : 'subtasks'}
          </p>
        </div>
        <span className="text-[0.62rem] text-primary/60 opacity-0 transition-opacity group-hover:opacity-100">
          Tap or double-click to edit
        </span>
      </div>
      <div className="mt-3 space-y-2">
        {subtasks.length === 0 ? (
          <div className="pt-1 text-left text-sm text-on-surface-variant">
            No subtasks yet.
          </div>
        ) : (
          subtasks.map((title, index) => (
            <div
              key={`${title}-${index}`}
              className="flex items-center gap-3 py-2.5 text-sm text-on-surface"
            >
              <span className="h-2 w-2 rounded-full bg-primary/70" />
              <span className="min-w-0 flex-1">{title}</span>
            </div>
          ))
        )}
      </div>
    </button>
  )
}

function EditableContextSection({
  value,
  disabled,
  onChange,
}: {
  value: string
  disabled: boolean
  onChange: (value: string) => void
}) {
  return (
    <section className="rounded-[1.25rem] bg-surface-container/75 p-3.5">
      <div className="flex items-center gap-2">
        <TextQuote className="h-3.5 w-3.5 text-primary" strokeWidth={1.8} />
        <p className="text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">Context</p>
      </div>
      <textarea
        autoFocus
        value={value}
        onChange={(event) => onChange(event.target.value)}
        rows={3}
        className="mt-2 w-full resize-none rounded-[1rem] bg-surface-dim px-3 py-3 text-sm leading-6 text-on-surface outline-none placeholder:text-on-surface-variant/45 focus:bg-surface-container-high focus:ring-1 focus:ring-primary"
        style={{ fontSize: '16px' }}
        aria-label="Task description"
        placeholder="Add context that helps you act on this later"
        disabled={disabled}
      />
    </section>
  )
}

function EditableMetadataTile({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="min-w-0 rounded-[1.25rem] bg-surface-container/75 p-3.5">
      <p className="text-[0.62rem] font-semibold uppercase tracking-[0.15em] text-on-surface-variant">
        {label}
      </p>
      <div className="mt-3">{children}</div>
    </div>
  )
}

function EditTaskModalFooter({
  isCreateMode,
  isSaving,
  isDirty,
  onSave,
}: {
  isCreateMode: boolean
  isSaving: boolean
  isDirty: boolean
  onSave: () => void
}) {
  const submitLabel = isSaving ? 'Saving...' : isCreateMode ? 'Add Task' : 'Save Changes'
  const isEnabled = isCreateMode ? isDirty : isDirty && !isSaving

  return (
    <div className="shrink-0 border-t border-white/10 bg-surface-container/95 px-5 py-4 pb-[max(1rem,calc(env(safe-area-inset-bottom)+1rem))] backdrop-blur-xl sm:px-6 sm:pb-4">
      <button
        type="button"
        onClick={onSave}
        disabled={!isEnabled || isSaving}
        className="w-full rounded-pill bg-[radial-gradient(circle_at_top,_#c4b5fd_10%,_#7c3aed_90%)] px-4 py-3 text-center text-sm font-semibold text-white shadow-[0_8px_0_#4c1d95,_0_16px_22px_rgba(0,0,0,0.35),_inset_0_2px_3px_rgba(255,255,255,0.38)] transition-all hover:-translate-y-[1px] active:translate-y-[4px] active:shadow-[0_0px_0_#4c1d95,_0_4px_10px_rgba(0,0,0,0.35),_inset_0_2px_4px_rgba(255,255,255,0.18)] disabled:cursor-not-allowed disabled:opacity-40 disabled:grayscale disabled:shadow-none disabled:hover:translate-y-0 disabled:active:translate-y-0"
      >
        {submitLabel}
      </button>
    </div>
  )
}

export function EditExtractedTaskModal({
  task,
  groups,
  isOpen,
  onClose,
  onSave,
  onSaved,
  csrfToken,
  defaultGroupId,
}: EditExtractedTaskModalProps) {
  const isCreateMode = task === null
  const [editingSections, setEditingSections] = useState<EditableSection[]>([])
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [isGroupDropdownOpen, setIsGroupDropdownOpen] = useState(false)
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('')
  const [pendingTaskCreation, setPendingTaskCreation] = useState<PendingTaskCreation | null>(null)

  const initialDraft: TaskFormDraft = useMemo(
    () =>
      task
        ? buildExtractedTaskDraft(task)
        : {
            title: '',
            description: '',
            groupId: defaultGroupId ?? groups[0]?.id ?? '',
            dueDate: '',
            reminderAt: '',
            reminderDate: '',
            recurrence: null,
            subtaskTitles: [],
          },
    [task, defaultGroupId, groups]
  )

  const [draft, setDraft] = useState<TaskFormDraft>(initialDraft)

  useEffect(() => {
    setDraft(initialDraft)
    setEditingSections([])
    setIsSaving(false)
    setError(null)
    setNewSubtaskTitle('')
    setIsGroupDropdownOpen(false)
    setPendingTaskCreation(null)
  }, [task, initialDraft, isCreateMode])

  const isDirty = useMemo(() => {
    if (isCreateMode) {
      return Boolean(draft.title.trim())
    }
    if (!task) return false
    if (draft.title.trim() !== (initialDraft.title || '').trim()) return true
    if ((draft.description || '').trim() !== (initialDraft.description || '').trim()) return true
    if (draft.groupId !== initialDraft.groupId) return true
    if ((draft.dueDate || '') !== (initialDraft.dueDate || '')) return true
    if ((draft.reminderAt || '') !== (initialDraft.reminderAt || '')) return true
    if ((draft.reminderDate || '') !== (initialDraft.reminderDate || '')) return true
    if (JSON.stringify(draft.recurrence) !== JSON.stringify(initialDraft.recurrence)) return true
    if (JSON.stringify(draft.subtaskTitles) !== JSON.stringify(initialDraft.subtaskTitles)) return true
    return false
  }, [draft, initialDraft, isCreateMode, task])

  if (!isOpen) return null

  const updateDraft = (updater: (prev: TaskFormDraft) => TaskFormDraft) => {
    setDraft((prev) => updater(prev))
  }

  const startEditing = (section: EditableSection) => {
    setEditingSections((current) => current.includes(section) ? current : [...current, section])
  }

  const isSectionEditing = (section: EditableSection) =>
    !isCreateMode && editingSections.includes(section)

  const updateDueDate = (dueDate: string) => {
    updateDraft((prev) => {
      if (!dueDate) return { ...prev, dueDate: '', reminderAt: '', reminderDate: '', recurrence: null }
      const frequency = prev.recurrence?.frequency
      return {
        ...prev,
        dueDate,
        recurrence: frequency && frequency !== 'daily'
          ? recurrenceForDueDate(frequency, dueDate)
          : prev.recurrence,
      }
    })
  }

  const addSubtask = () => {
    const trimmed = newSubtaskTitle.trim()
    if (!trimmed) return
    updateDraft((prev) => ({
      ...prev,
      subtaskTitles: [...prev.subtaskTitles, trimmed],
    }))
    setNewSubtaskTitle('')
  }

  const handleSave = async () => {
    const validationError = validateTaskFormDraft(draft, isCreateMode)
    if (validationError) {
      setError(validationError)
      return
    }

    setIsSaving(true)
    setError(null)

    try {
      if (isCreateMode) {
        let pending = pendingTaskCreation
        if (!pending) {
          const created = await createTask(
            {
              title: draft.title.trim(),
              description: draft.description.trim() || null,
              group_id: draft.groupId,
              due_date: draft.dueDate || null,
              reminder_at: draft.reminderAt ? new Date(draft.reminderAt).toISOString() : null,
              reminder_date: draft.reminderDate || null,
              recurrence: draft.recurrence,
            },
            csrfToken
          )
          pending = {
            taskId: created.id,
            title: draft.title.trim(),
            subtaskTitles: draft.subtaskTitles.map((title) => title.trim()).filter(Boolean),
            nextSubtaskIndex: 0,
          }
          setPendingTaskCreation(pending)
        }
        while (pending.nextSubtaskIndex < pending.subtaskTitles.length) {
          await createSubtask(pending.taskId, pending.subtaskTitles[pending.nextSubtaskIndex], csrfToken)
          pending = { ...pending, nextSubtaskIndex: pending.nextSubtaskIndex + 1 }
          setPendingTaskCreation(pending)
        }
        await onSave(pending.taskId, { title: pending.title })
        setPendingTaskCreation(null)
      } else {
        const cleanUpdates = buildExtractedTaskUpdates(task, {
          ...draft,
          title: draft.title.trim(),
          description: draft.description.trim(),
          subtaskTitles: draft.subtaskTitles ?? [],
        })

        if (Object.keys(cleanUpdates).length > 0) {
          await updateExtractedTask(task.capture_id, task.id, cleanUpdates, csrfToken)
          await onSave(task.id, cleanUpdates)
        }
      }
      onSaved?.()
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

  const selectedGroupName =
    groups.find((g) => g.id === draft.groupId)?.name ?? task?.group_name ?? 'Inbox'

  return (
    <div
      className="fixed !mt-0 inset-0 z-[120] flex items-center justify-center bg-surface p-0 sm:bg-black/65 sm:p-5 sm:backdrop-blur-md"
      onClick={handleBackdropClick}
      role="dialog"
      aria-modal="true"
      aria-labelledby="edit-extracted-task-title"
    >
      <div className="flex h-full w-full max-w-2xl flex-col overflow-hidden rounded-none bg-[radial-gradient(circle_at_top_left,_rgba(186,158,255,0.18),_rgba(32,32,31,0.98)_42%,_rgba(14,14,14,1)_100%)] shadow-[0_28px_80px_rgba(0,0,0,0.62)] sm:h-auto sm:max-h-[92dvh] sm:rounded-[1.7rem]">
        {/* Header */}
        <div className="flex flex-col gap-2 p-5 pb-3 pr-2 pt-[max(1.25rem,calc(env(safe-area-inset-top)+0.75rem))] sm:p-6 sm:pb-4 sm:pr-6">
          <div className="flex items-center justify-between gap-3">
            <div className="flex min-w-0 flex-1 flex-wrap items-center gap-2">
              <span className="rounded-pill bg-white/6 px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">
                {isCreateMode ? 'New task' : 'Task review'}
              </span>
              <span className="max-w-[12rem] truncate rounded-pill bg-surface-container-high px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">
                {selectedGroupName}
              </span>
            </div>
            <div className="flex shrink-0 items-center">
              <button
                type="button"
                onClick={onClose}
                disabled={isSaving}
                className="clay-obsidian flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-on-surface-variant hover:text-on-surface disabled:opacity-50"
                aria-label="Close edit task"
              >
                <X className="h-5 w-5" strokeWidth={2} />
              </button>
            </div>
          </div>
          {isSectionEditing('title') ? (
            <>
              <h2 id="edit-extracted-task-title" className="sr-only">
                {draft.title || 'Untitled task'}
              </h2>
              <input
                autoFocus
                value={draft.title}
                onChange={(event) => updateDraft((prev) => ({ ...prev, title: event.target.value }))}
                className="w-full rounded-[1.25rem] bg-surface/60 px-4 py-3 font-display text-[1.5rem] leading-tight text-on-surface outline-none placeholder:text-on-surface-variant/40 focus:bg-surface/75 focus:text-white sm:text-[1.85rem]"
                style={{ fontSize: '16px' }}
                aria-label="Task title"
                placeholder="Task title"
                disabled={isSaving}
              />
            </>
          ) : (
            <h2
              id="edit-extracted-task-title"
              className={isCreateMode ? 'sr-only' : 'font-display text-2xl leading-tight text-on-surface sm:text-3xl'}
            >
              {isCreateMode ? 'Add Task' : (
                <button
                  type="button"
                  onClick={() => startEditing('title')}
                  onDoubleClick={() => startEditing('title')}
                  className="group flex w-full items-start gap-2 pl-3.5 text-left outline-none"
                  title="Tap or double-click to edit title"
                >
                  <span className="text-balance">{draft.title || 'Untitled task'}</span>
                  <PencilLine className="mt-1 h-4 w-4 shrink-0 text-primary/60 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" strokeWidth={1.8} />
                </button>
              )}
            </h2>
          )}
        </div>

        {/* Content Body */}
        <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-5 sm:px-6">
          {error ? (
            <div className="mb-4 rounded-card border border-error/35 bg-[rgba(80,18,18,0.92)] p-3 text-sm text-red-100">
              {error}
            </div>
          ) : null}

          {isCreateMode ? (
            <div className="space-y-5">
              <TaskFormFields
                title={draft.title}
                description={draft.description}
                groupId={draft.groupId}
                dueDate={draft.dueDate}
                reminderAt={draft.reminderAt}
                reminderDate={draft.reminderDate}
                recurrence={draft.recurrence}
                groups={groups}
                isGroupDropdownOpen={isGroupDropdownOpen}
                disabled={isSaving}
                onTitleChange={(title) => updateDraft((prev) => ({ ...prev, title }))}
                onDescriptionChange={(description) =>
                  updateDraft((prev) => ({ ...prev, description }))
                }
                onGroupIdChange={(groupId) => updateDraft((prev) => ({ ...prev, groupId }))}
                onDueDateChange={(dueDate) => updateDraft((prev) => ({ ...prev, dueDate }))}
                onReminderAtChange={(reminderAt) =>
                  updateDraft((prev) => ({ ...prev, reminderAt }))
                }
                onReminderDateChange={(reminderDate) =>
                  updateDraft((prev) => ({ ...prev, reminderDate }))
                }
                onRecurrenceChange={(recurrence) =>
                  updateDraft((prev) => ({ ...prev, recurrence }))
                }
                onGroupDropdownOpenChange={setIsGroupDropdownOpen}
              />
              <SubtaskDrafts
                titles={draft.subtaskTitles}
                newTitle={newSubtaskTitle}
                disabled={isSaving}
                onTitlesChange={(subtaskTitles) =>
                  updateDraft((prev) => ({ ...prev, subtaskTitles }))
                }
                onNewTitleChange={setNewSubtaskTitle}
                onAdd={addSubtask}
              />
            </div>
          ) : (
            <div className="space-y-4">
              {isSectionEditing('context') ? (
                <EditableContextSection
                  value={draft.description}
                  disabled={isSaving}
                  onChange={(description) => updateDraft((prev) => ({ ...prev, description }))}
                />
              ) : (
                <ReadOnlySectionCard
                  label="Context"
                  icon={sectionIcons.context}
                  onClick={() => startEditing('context')}
                  onDoubleClick={() => startEditing('context')}
                >
                  <p className="text-sm leading-6 text-on-surface-variant">
                    {draft.description || 'No description yet.'}
                  </p>
                </ReadOnlySectionCard>
              )}

              <div className="grid gap-3 sm:grid-cols-2">
                {isSectionEditing('dueDate') ? (
                  <EditableMetadataTile label="Due date">
                    <DatePicker
                      value={draft.dueDate || null}
                      onChange={updateDueDate}
                      mode="date"
                      disabled={isSaving}
                      placeholder="Select a date"
                    />
                  </EditableMetadataTile>
                ) : (
                  <ReadOnlyMetadataTile
                    label="Due date"
                    icon={sectionIcons.dueDate}
                    value={formatDate(draft.dueDate)}
                    onClick={() => startEditing('dueDate')}
                    onDoubleClick={() => startEditing('dueDate')}
                  />
                )}
                {isSectionEditing('reminder') ? (
                  <EditableMetadataTile label="Reminder">
                    <DatePicker
                      value={draft.reminderAt || null}
                      onChange={(reminderAt) => updateDraft((prev) => ({ ...prev, reminderAt }))}
                      mode="datetime"
                      disabled={!draft.dueDate || isSaving}
                      placeholder="Select date & time"
                    />
                  </EditableMetadataTile>
                ) : (
                  <ReadOnlyMetadataTile
                    label="Reminder"
                    icon={sectionIcons.reminder}
                    value={formatDateTime(draft.reminderAt)}
                    onClick={() => startEditing('reminder')}
                    onDoubleClick={() => startEditing('reminder')}
                  />
                )}
                {isSectionEditing('group') ? (
                  <EditableMetadataTile label="Group">
                    <SelectDropdown
                      label=""
                      options={groups.map((group) => ({ value: group.id, label: group.name }))}
                      value={draft.groupId}
                      onChange={(groupId) => updateDraft((prev) => ({ ...prev, groupId: String(groupId) }))}
                      onOpenChange={setIsGroupDropdownOpen}
                      placeholder="No Group"
                      disabled={isSaving}
                    />
                  </EditableMetadataTile>
                ) : (
                  <ReadOnlyMetadataTile
                    label="Group"
                    icon={sectionIcons.group}
                    value={selectedGroupName}
                    onClick={() => startEditing('group')}
                    onDoubleClick={() => startEditing('group')}
                  />
                )}
                {isSectionEditing('recurrence') ? (
                  <div className="sm:col-span-2">
                    <TaskRecurrenceFields
                      dueDate={draft.dueDate}
                      recurrence={draft.recurrence}
                      disabled={isSaving}
                      onChange={(recurrence) => updateDraft((prev) => ({ ...prev, recurrence }))}
                    />
                  </div>
                ) : (
                  <ReadOnlyMetadataTile
                    label="Recurrence"
                    icon={sectionIcons.recurrence}
                    value={formatRecurrence(draft.recurrence)}
                    onClick={() => startEditing('recurrence')}
                    onDoubleClick={() => startEditing('recurrence')}
                  />
                )}
              </div>

              {isSectionEditing('subtasks') ? (
                <SubtaskDrafts
                  titles={draft.subtaskTitles}
                  newTitle={newSubtaskTitle}
                  disabled={isSaving}
                  onTitlesChange={(subtaskTitles) =>
                    updateDraft((prev) => ({ ...prev, subtaskTitles }))
                  }
                  onNewTitleChange={setNewSubtaskTitle}
                  onAdd={addSubtask}
                />
              ) : (
                <ReadOnlySubtasksSection
                  subtasks={draft.subtaskTitles}
                  onClick={() => startEditing('subtasks')}
                  onDoubleClick={() => startEditing('subtasks')}
                />
              )}

              <p className="pt-1 text-center text-xs text-on-surface-variant/60">
                Tap or double-click any section to edit
              </p>
            </div>
          )}
        </div>

        {/* Footer */}
        <EditTaskModalFooter
          isCreateMode={isCreateMode}
          isSaving={isSaving}
          isDirty={isDirty}
          onSave={() => void handleSave()}
        />
      </div>
    </div>
  )
}
