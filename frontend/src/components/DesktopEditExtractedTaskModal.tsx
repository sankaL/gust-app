import { useEffect, useState } from 'react'
import { Save, X } from 'lucide-react'

import {
  updateExtractedTask,
  type ExtractedTask,
  type ExtractedTaskUpdates,
  type GroupSummary,
} from '../lib/api'
import {
  buildExtractedTaskDraft,
  buildExtractedTaskUpdates,
  type TaskFormDraft,
} from '../lib/taskFormModel'
import { TaskFormFields } from './TaskFormFields'
import { SubtaskDrafts } from './TaskFormSections'
import { useEscapeDismiss } from '../hooks/useFloatingDismiss'

type DesktopEditExtractedTaskModalProps = {
  task: ExtractedTask | null
  groups: GroupSummary[]
  isOpen: boolean
  onClose: () => void
  onSave: (taskId: string, updates: ExtractedTaskUpdates) => Promise<void>
  csrfToken: string
  timezone?: string | null
}

type DraftState = TaskFormDraft

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
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('')

  useEffect(() => {
    setDraft(task ? buildExtractedTaskDraft(task, timezone) : null)
    setNewSubtaskTitle('')
    setError(null)
    setIsGroupDropdownOpen(false)
  }, [task, timezone])

  useEscapeDismiss(isOpen, onClose)

  if (!isOpen || !task || !draft) return null

  function updateDraft(updater: (current: DraftState) => DraftState) {
    setDraft((current) => (current ? updater(current) : current))
  }

  function addSubtaskDraft() {
    const title = newSubtaskTitle.trim()
    if (!title) return
    updateDraft((current) => ({ ...current, subtaskTitles: [...current.subtaskTitles, title] }))
    setNewSubtaskTitle('')
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
      const cleanUpdates = buildExtractedTaskUpdates(
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

        <div className="min-h-0 flex-1 space-y-5 overflow-y-auto px-6 py-5">
          {error ? <div className="rounded-card border border-error/35 bg-[rgba(80,18,18,0.92)] p-3 text-sm text-red-100">{error}</div> : null}
          <TaskFormFields title={draft.title} description={draft.description} groupId={draft.groupId} dueDate={draft.dueDate} reminderAt={draft.reminderAt} reminderDate={draft.reminderDate} recurrence={draft.recurrence} groups={groups} isGroupDropdownOpen={isGroupDropdownOpen} disabled={isSaving} onTitleChange={(title) => updateDraft((current) => ({ ...current, title }))} onDescriptionChange={(description) => updateDraft((current) => ({ ...current, description }))} onGroupIdChange={(groupId) => updateDraft((current) => ({ ...current, groupId }))} onDueDateChange={(dueDate) => updateDraft((current) => ({ ...current, dueDate }))} onReminderAtChange={(reminderAt) => updateDraft((current) => ({ ...current, reminderAt }))} onReminderDateChange={(reminderDate) => updateDraft((current) => ({ ...current, reminderDate }))} onRecurrenceChange={(recurrence) => updateDraft((current) => ({ ...current, recurrence }))} onGroupDropdownOpenChange={setIsGroupDropdownOpen} />
          <SubtaskDrafts titles={draft.subtaskTitles} newTitle={newSubtaskTitle} disabled={isSaving} onTitlesChange={(subtaskTitles) => updateDraft((current) => ({ ...current, subtaskTitles }))} onNewTitleChange={setNewSubtaskTitle} onAdd={addSubtaskDraft} />
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
