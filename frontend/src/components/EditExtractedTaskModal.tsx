import { useState } from 'react'
import { X } from 'lucide-react'
import { ExtractedTask, GroupSummary, createTask, updateExtractedTask } from '../lib/api'
import type { ExtractedTaskUpdates, TaskRecurrence } from '../lib/api'
import {
  buildExtractedTaskDraft,
  buildExtractedTaskUpdates,
  type TaskFormDraft,
} from '../lib/taskFormModel'
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
  const formId = `edit-extracted-task-form-${task?.id ?? 'new'}`
  const [isSaving, setIsSaving] = useState(false)
  const [error, setError] = useState<string | null>(null)

  if (!isOpen) return null

  const initialDraft: TaskFormDraft = task
    ? buildExtractedTaskDraft(task)
    : {
        title: '',
        description: '',
        groupId: '',
        dueDate: '',
        reminderAt: '',
        recurrence: null,
        subtaskTitles: [],
      }

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
        const cleanUpdates = buildExtractedTaskUpdates(task, {
          ...data,
          subtaskTitles: data.subtaskTitles ?? [],
        })

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
              initialTitle={initialDraft.title}
              initialDescription={initialDraft.description}
              initialGroupId={initialDraft.groupId}
              initialDueDate={initialDraft.dueDate}
              initialReminderAt={initialDraft.reminderAt}
              initialRecurrence={initialDraft.recurrence}
              initialSubtaskTitles={initialDraft.subtaskTitles}
              showSubtasks={!isCreateMode}
              groups={groups}
              defaultGroupId={defaultGroupId}
              onSave={handleSave}
              onCancel={onClose}
              isSaving={isSaving}
              error={error}
              onErrorChange={setError}
              formId={formId}
              showActions={false}
            />
          </div>
          <div className="shrink-0 border-t border-white/10 bg-surface-container/95 px-5 py-4 backdrop-blur-xl sm:px-6">
            <div className="grid grid-cols-2 gap-3">
              <button type="button" onClick={onClose} disabled={isSaving} className="w-full rounded-pill border border-white/10 bg-white/5 px-4 py-3 text-center text-sm font-medium text-on-surface transition-colors hover:bg-white/10 disabled:opacity-50 disabled:hover:bg-white/5">Cancel</button>
              <button type="submit" form={formId} disabled={isSaving} className="w-full rounded-pill bg-[radial-gradient(circle_at_top,_#c4b5fd_10%,_#7c3aed_90%)] px-4 py-3 text-center text-sm font-semibold text-white shadow-[0_8px_0_#4c1d95,_0_16px_22px_rgba(0,0,0,0.35),_inset_0_2px_3px_rgba(255,255,255,0.38)] transition-all hover:-translate-y-[1px] active:translate-y-[4px] active:shadow-[0_0px_0_#4c1d95,_0_4px_10px_rgba(0,0,0,0.35),_inset_0_2px_4px_rgba(255,255,255,0.18)] disabled:opacity-50 disabled:shadow-none disabled:hover:translate-y-0 disabled:active:translate-y-0">{isSaving ? 'Saving...' : isCreateMode ? 'Add Task' : 'Save Changes'}</button>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
