import { useCallback, useEffect, useRef, useState } from 'react'
import { RotateCcw, Save, Trash2, X, CheckCircle2 } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  ApiError,
  createSubtask,
  deleteSubtask,
  getTaskDetail,
  updateTask,
  type GroupSummary,
  type SessionStatus,
  type TaskDetail,
} from '../lib/api'
import {
  adjustGroupOpenCount,
  applyTaskListMutation,
  prependTaskToMatchingLists,
  restoreQuerySnapshots,
  snapshotTaskQueries,
  updateTaskDetailCache,
} from '../lib/taskQueryCache'
import {
  TASK_SCREEN_GC_TIME_MS,
  TASK_SCREEN_STALE_TIME_MS,
} from '../lib/taskScreenCache'
import { requireCsrfToken } from '../lib/sessionSecurity'
import { dateTimeLocalToIso } from '../lib/dateTime'
import {
  buildTaskDetailDraft,
  RECURRENCE_OPTIONS,
  recurrenceForDueDate,
  type TaskDetailDraft,
} from '../lib/taskFormModel'
import { DatePicker } from './DatePicker'
import { SelectDropdown } from './SelectDropdown'

type DraftState = TaskDetailDraft

type TaskPreviewModalProps = {
  taskId: string | null
  isOpen: boolean
  onClose: () => void
  onComplete?: (task: TaskDetail) => void
  onRestore?: (task: TaskDetail) => void
  onRequestDelete?: (task: TaskDetail) => void
  busyTaskIds?: string[]
  session?: SessionStatus
  groups?: GroupSummary[]
}

function buildFriendlyMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message
  }

  if (error instanceof Error) {
    return error.message
  }

  return fallback
}

function formatDate(value: string | null) {
  if (!value) {
    return 'No due date'
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(`${value}T12:00:00`))
}

function formatDateTime(value: string | null) {
  if (!value) {
    return null
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return null
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function formatRecurrence(task: TaskDetail) {
  if (!task.recurrence_frequency) {
    return 'One-off'
  }

  return task.recurrence_frequency.charAt(0).toUpperCase() + task.recurrence_frequency.slice(1)
}

function formatSubtaskCount(count: number) {
  return `${count} ${count === 1 ? 'subtask' : 'subtasks'}`
}

function MetadataTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-[1.2rem] bg-black/20 p-3 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] backdrop-blur-sm">
      <p className="text-[0.62rem] font-semibold uppercase tracking-[0.15em] text-on-surface-variant">
        {label}
      </p>
      <p className="mt-2 truncate font-body text-sm font-medium text-on-surface">{value}</p>
    </div>
  )
}

export function TaskPreviewModal({
  taskId,
  isOpen,
  onClose,
  onComplete,
  onRestore,
  onRequestDelete,
  busyTaskIds = [],
  session,
  groups = [],
}: TaskPreviewModalProps) {
  const queryClient = useQueryClient()
  const [draft, setDraft] = useState<DraftState | null>(null)
  const [draftTaskId, setDraftTaskId] = useState<string | null>(null)
  const [isDraftDirty, setIsDraftDirty] = useState(false)
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [isLocalMutationLocked, setIsLocalMutationLocked] = useState(false)
  const localMutationLockRef = useRef(false)

  const taskQuery = useQuery({
    queryKey: ['task-detail', taskId],
    queryFn: () => getTaskDetail(taskId as string),
    enabled: isOpen && Boolean(taskId),
    staleTime: TASK_SCREEN_STALE_TIME_MS,
    gcTime: TASK_SCREEN_GC_TIME_MS,
  })

  const task = taskQuery.data
  const completedLabel = task ? formatDateTime(task.completed_at) : null
  const reminderLabel = task ? formatDateTime(task.reminder_at) : null
  const isEditable = Boolean(task && draft && session && groups.length > 0)

  const acquireLocalMutationLock = useCallback(() => {
    if (localMutationLockRef.current) {
      return null
    }

    localMutationLockRef.current = true
    setIsLocalMutationLocked(true)

    return () => {
      localMutationLockRef.current = false
      setIsLocalMutationLocked(false)
    }
  }, [])

  function updateDraft(updater: (current: DraftState) => DraftState) {
    setIsDraftDirty(true)
    setDraft((current) => (current ? updater(current) : current))
  }

  const saveTaskMutation = useMutation({
    onMutate: async () => {
      if (!taskId || !draft || !task) {
        return {}
      }

      setSaveError(null)
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ['tasks'] }),
        queryClient.cancelQueries({ queryKey: ['groups'] }),
        queryClient.cancelQueries({ queryKey: ['task-detail', taskId] }),
      ])

      const snapshots = snapshotTaskQueries(queryClient, taskId)
      const optimisticTask: TaskDetail = {
        ...task,
        title: draft.title,
        description: draft.description || null,
        group: groups.find((group) => group.id === draft.groupId) ?? task.group,
        due_date: draft.dueDate || null,
        reminder_at: dateTimeLocalToIso(draft.reminderAt, session?.timezone),
        recurrence: draft.recurrence,
        recurrence_frequency: draft.recurrence?.frequency ?? null,
        needs_review: draft.groupId !== task.group.id ? false : task.needs_review,
      }

      applyTaskListMutation(queryClient, (currentTask, statusSegment) => {
        if (currentTask.id !== optimisticTask.id) {
          return currentTask
        }
        return statusSegment === optimisticTask.status ? { ...currentTask, ...optimisticTask } : null
      })
      prependTaskToMatchingLists(queryClient, optimisticTask, optimisticTask.status)
      updateTaskDetailCache(queryClient, optimisticTask)
      if (task.group.id !== optimisticTask.group.id && task.status === 'open') {
        adjustGroupOpenCount(queryClient, task.group.id, -1)
        adjustGroupOpenCount(queryClient, optimisticTask.group.id, 1)
      }
      return { snapshots }
    },
    mutationFn: async (release: () => void) => {
      void release
      if (!taskId || !draft) {
        throw new Error('Task preview is not ready.')
      }

      return updateTask(
        taskId,
        {
          title: draft.title.trim(),
          description: draft.description.trim() || null,
          group_id: draft.groupId,
          due_date: draft.dueDate || null,
          reminder_at: dateTimeLocalToIso(draft.reminderAt, session?.timezone),
          recurrence: draft.recurrence,
        },
        requireCsrfToken(session)
      )
    },
    onSuccess: (updatedTask) => {
      setDraft(buildTaskDetailDraft(updatedTask, session?.timezone))
      setDraftTaskId(updatedTask.id)
      setIsDraftDirty(false)
      updateTaskDetailCache(queryClient, updatedTask)
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
      void queryClient.invalidateQueries({ queryKey: ['groups'] })
    },
    onError: (error, _variables, context) => {
      if (context?.snapshots) {
        restoreQuerySnapshots(queryClient, context.snapshots)
      }
      setSaveError(buildFriendlyMessage(error, 'Task changes could not be saved.'))
    },
    onSettled: (_data, _error, release) => {
      release?.()
    },
  })

  const createSubtaskMutation = useMutation({
    onMutate: async () => {
      if (!taskId || !task || !newSubtaskTitle.trim()) {
        return {}
      }

      setSaveError(null)
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ['tasks'] }),
        queryClient.cancelQueries({ queryKey: ['task-detail', taskId] }),
      ])

      const snapshots = snapshotTaskQueries(queryClient, taskId)
      const optimisticId = `optimistic-${Date.now()}`
      const optimisticTask: TaskDetail = {
        ...task,
        subtasks: [
          ...task.subtasks,
          {
            id: optimisticId,
            title: newSubtaskTitle.trim(),
            is_completed: false,
            completed_at: null,
          },
        ],
        subtask_count: task.subtask_count + 1,
      }

      updateTaskDetailCache(queryClient, optimisticTask)
      applyTaskListMutation(queryClient, (currentTask) =>
        currentTask.id === taskId
          ? { ...currentTask, subtask_count: currentTask.subtask_count + 1 }
          : currentTask
      )
      return { snapshots }
    },
    mutationFn: async (release: () => void) => {
      void release
      if (!taskId || !newSubtaskTitle.trim()) {
        throw new Error('Subtask title is required.')
      }

      return createSubtask(taskId, newSubtaskTitle.trim(), requireCsrfToken(session))
    },
    onSuccess: () => {
      setNewSubtaskTitle('')
      void queryClient.invalidateQueries({ queryKey: ['task-detail', taskId] })
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
    },
    onError: (error, _variables, context) => {
      if (context?.snapshots) {
        restoreQuerySnapshots(queryClient, context.snapshots)
      }
      setSaveError(buildFriendlyMessage(error, 'Subtask could not be added.'))
    },
    onSettled: (_data, _error, release) => {
      release?.()
    },
  })

  const deleteSubtaskMutation = useMutation({
    onMutate: async ({ subtaskId }: { subtaskId: string; release: () => void }) => {
      if (!taskId || !task) {
        return {}
      }

      setSaveError(null)
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ['tasks'] }),
        queryClient.cancelQueries({ queryKey: ['task-detail', taskId] }),
      ])

      const snapshots = snapshotTaskQueries(queryClient, taskId)
      const optimisticTask: TaskDetail = {
        ...task,
        subtasks: task.subtasks.filter((subtask) => subtask.id !== subtaskId),
        subtask_count: Math.max(0, task.subtask_count - 1),
      }

      updateTaskDetailCache(queryClient, optimisticTask)
      applyTaskListMutation(queryClient, (currentTask) =>
        currentTask.id === taskId
          ? { ...currentTask, subtask_count: Math.max(0, currentTask.subtask_count - 1) }
          : currentTask
      )
      return { snapshots }
    },
    mutationFn: async ({ subtaskId }: { subtaskId: string; release: () => void }) => {
      if (!taskId) {
        throw new Error('Task preview is not ready.')
      }

      return deleteSubtask(taskId, subtaskId, requireCsrfToken(session))
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: ['task-detail', taskId] })
      void queryClient.invalidateQueries({ queryKey: ['tasks'] })
    },
    onError: (error, _variables, context) => {
      if (context?.snapshots) {
        restoreQuerySnapshots(queryClient, context.snapshots)
      }
      setSaveError(buildFriendlyMessage(error, 'Subtask could not be deleted.'))
    },
    onSettled: (_data, _error, variables) => {
      variables?.release?.()
    },
  })

  const isLocalMutationPending =
    isLocalMutationLocked ||
    saveTaskMutation.isPending ||
    createSubtaskMutation.isPending ||
    deleteSubtaskMutation.isPending
  const isBusy = (task ? busyTaskIds.includes(task.id) : false) || isLocalMutationPending

  function confirmDiscardDraft() {
    if (!isDraftDirty) {
      return true
    }

    return window.confirm('Discard unsaved task changes?')
  }

  const requestClose = useCallback(() => {
    if (isLocalMutationPending) {
      return
    }

    if (!confirmDiscardDraft()) {
      return
    }

    onClose()
  }, [isDraftDirty, isLocalMutationPending, onClose])

  function runTaskAction(action: () => void) {
    if (isBusy) {
      return
    }

    if (!confirmDiscardDraft()) {
      return
    }

    action()
  }

  function requestSaveTask() {
    if (isBusy || !draft?.title.trim()) {
      return
    }

    const release = acquireLocalMutationLock()
    if (!release) {
      setSaveError('Task is already updating.')
      return
    }

    saveTaskMutation.mutate(release)
  }

  function requestCreateSubtask() {
    if (isBusy || !newSubtaskTitle.trim()) {
      return
    }

    const release = acquireLocalMutationLock()
    if (!release) {
      setSaveError('Task is already updating.')
      return
    }

    createSubtaskMutation.mutate(release)
  }

  function requestDeleteSubtask(subtaskId: string) {
    if (isBusy) {
      return
    }

    const release = acquireLocalMutationLock()
    if (!release) {
      setSaveError('Task is already updating.')
      return
    }

    deleteSubtaskMutation.mutate({ subtaskId, release })
  }

  useEffect(() => {
    if (!isOpen) {
      setDraft(null)
      setDraftTaskId(null)
      setIsDraftDirty(false)
      setNewSubtaskTitle('')
      setSaveError(null)
      return
    }

    if (!task) {
      return
    }

    if (draftTaskId !== task.id || !isDraftDirty) {
      setDraft(buildTaskDetailDraft(task, session?.timezone))
      setDraftTaskId(task.id)
      setIsDraftDirty(false)
      setSaveError(null)
    }
  }, [draftTaskId, isDraftDirty, isOpen, session?.timezone, task])

  useEffect(() => {
    if (!isOpen) {
      return undefined
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        requestClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, requestClose])

  if (!isOpen || !taskId) {
    return null
  }

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end justify-center bg-black/65 p-3 backdrop-blur-md sm:items-center sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="task-preview-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          requestClose()
        }
      }}
    >
      <div className="max-h-[92dvh] w-full max-w-2xl overflow-hidden rounded-[1.7rem] bg-[radial-gradient(circle_at_top_left,_rgba(186,158,255,0.18),_rgba(32,32,31,0.98)_42%,_rgba(14,14,14,1)_100%)] shadow-[0_28px_80px_rgba(0,0,0,0.62)]">
        <div className="flex max-h-[92dvh] flex-col">
          <div className="grid grid-cols-[minmax(0,1fr)_auto] items-start gap-4 p-5 pb-3 sm:p-6 sm:pb-4">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-pill bg-white/6 px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">
                  Task preview
                </span>
                {task ? (
                  <>
                    <span className="rounded-pill bg-surface-container-high px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">
                      {task.status === 'completed' ? 'Completed' : 'Open'}
                    </span>
                    <span className="max-w-[12rem] truncate rounded-pill bg-surface-container-high px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">
                      {task.group.name}
                    </span>
                    {task.needs_review ? (
                      <span className="rounded-pill bg-warning/20 px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-warning">
                        Needs review
                      </span>
                    ) : null}
                  </>
                ) : null}
              </div>
              {isEditable && draft ? (
                <textarea
                  id="task-preview-title"
                  value={draft.title}
                  onChange={(event) => updateDraft((current) => ({ ...current, title: event.target.value }))}
                  rows={2}
                  className="w-full resize-none rounded-xl bg-white/5 px-3 py-2 font-display text-2xl leading-tight text-on-surface outline-none ring-1 ring-white/10 transition focus:bg-surface-container focus:ring-primary sm:text-3xl"
                  aria-label="Task title"
                  disabled={isBusy}
                />
              ) : (
                <h2
                  id="task-preview-title"
                  className="font-display text-2xl leading-tight text-on-surface sm:text-3xl"
                >
                  {task?.title ?? 'Loading task'}
                </h2>
              )}
            </div>
            <button
              type="button"
              onClick={requestClose}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/8 text-on-surface-variant transition hover:bg-white/12 hover:text-on-surface active:scale-[0.98]"
              aria-label="Close task preview"
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 sm:px-6">
            {taskQuery.isLoading ? (
              <div className="space-y-3 py-3" aria-busy="true">
                <div className="h-20 animate-pulse rounded-card bg-surface-container-high" />
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="h-20 animate-pulse rounded-card bg-surface-container-high" />
                  <div className="h-20 animate-pulse rounded-card bg-surface-container-high" />
                </div>
                <div className="h-28 animate-pulse rounded-card bg-surface-container-high" />
              </div>
            ) : taskQuery.isError ? (
              <div className="rounded-card bg-[rgba(80,18,18,0.92)] p-4 text-sm leading-6 text-red-100 shadow-[0_18px_36px_rgba(0,0,0,0.4)]">
                {buildFriendlyMessage(taskQuery.error, 'Task preview could not be loaded.')}
              </div>
            ) : task ? (
              <div className="space-y-4">
                {isEditable && draft ? (
                  <div className="space-y-3 rounded-[1.25rem] bg-surface/35 p-3">
                    <SelectDropdown
                      label="Group"
                      options={groups.map((group) => ({ value: group.id, label: group.name }))}
                      value={draft.groupId}
                      onChange={(value) => updateDraft((current) => ({ ...current, groupId: String(value) }))}
                      disabled={isBusy}
                    />
                    <DatePicker
                      value={draft.dueDate || null}
                      onChange={(value) =>
                        updateDraft((current) => ({
                          ...current,
                          dueDate: value ?? '',
                          reminderAt: value ? current.reminderAt : '',
                          recurrence: value ? current.recurrence : null,
                        }))
                      }
                      mode="date"
                      disabled={isBusy}
                      placeholder="Select due date"
                    />
                    <DatePicker
                      value={draft.reminderAt || null}
                      onChange={(value) => updateDraft((current) => ({ ...current, reminderAt: value }))}
                      mode="datetime"
                      disabled={!draft.dueDate || isBusy}
                      placeholder={draft.dueDate ? 'Select reminder' : 'Set a due date first'}
                    />
                    <div className="grid grid-cols-5 gap-1.5">
                      {RECURRENCE_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          disabled={!draft.dueDate || isBusy}
                          onClick={() =>
                            updateDraft((current) => ({
                              ...current,
                              recurrence:
                                option.value === 'none'
                                  ? null
                                  : recurrenceForDueDate(option.value, current.dueDate, null),
                            }))
                          }
                          className={[
                            'min-h-10 rounded-xl px-2 text-[0.7rem] font-semibold transition',
                            (draft.recurrence?.frequency ?? 'none') === option.value
                              ? 'bg-primary text-surface'
                              : 'bg-surface-dim text-on-surface-variant',
                            !draft.dueDate ? 'opacity-50' : '',
                          ].join(' ')}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                    <MetadataTile label="Due date" value={formatDate(task.due_date)} />
                    <MetadataTile label="Reminder" value={reminderLabel ?? 'No reminder'} />
                    <MetadataTile label="Recurrence" value={formatRecurrence(task)} />
                    {completedLabel ? (
                      <MetadataTile label="Completed" value={completedLabel} />
                    ) : (
                      <MetadataTile label="Subtasks" value={formatSubtaskCount(task.subtasks.length)} />
                    )}
                  </div>
                )}

                <section className="rounded-[1.25rem] bg-surface/45 p-4 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]">
                  <p className="text-[0.65rem] font-semibold uppercase tracking-[0.15em] text-on-surface-variant">
                    Context
                  </p>
                  {isEditable && draft ? (
                    <textarea
                      value={draft.description}
                      onChange={(event) =>
                        updateDraft((current) => ({ ...current, description: event.target.value }))
                      }
                      rows={4}
                      className="mt-3 w-full resize-none rounded-xl bg-black/20 px-3 py-3 font-body text-sm leading-6 text-on-surface outline-none ring-1 ring-white/10 transition placeholder:text-on-surface-variant/45 focus:bg-surface-container focus:ring-primary"
                      placeholder="Add context that helps you act on this later"
                      aria-label="Task description"
                      disabled={isBusy}
                    />
                  ) : (
                    <p className="mt-3 font-body text-sm leading-6 text-on-surface-variant">
                      {task.description ||
                        'No description yet. Open the full page to add more context before acting on this task.'}
                    </p>
                  )}
                </section>

                {saveError ? (
                  <p className="rounded-xl bg-error/15 px-3 py-2 font-body text-sm text-error">
                    {saveError}
                  </p>
                ) : null}

                <section className="rounded-[1.25rem] bg-surface-container/90 p-4 shadow-ambient">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-display text-lg text-on-surface">Checklist</p>
                      <p className="mt-1 font-body text-xs text-on-surface-variant">
                        {formatSubtaskCount(task.subtasks.length)}
                      </p>
                    </div>
                    <span className="rounded-pill bg-surface-container-high px-3 py-1 text-[0.68rem] uppercase tracking-[0.12em] text-on-surface-variant">
                      {task.subtasks.filter((subtask) => subtask.is_completed).length} done
                    </span>
                  </div>

                  <div className="mt-3 space-y-2">
                    {task.subtasks.length === 0 ? (
                      <div className="rounded-card bg-surface-dim px-4 py-4 text-sm text-on-surface-variant">
                        No subtasks yet.
                      </div>
                    ) : (
                      task.subtasks.map((subtask) => (
                        <div key={subtask.id} className="flex items-start gap-3 rounded-card bg-surface-dim p-3">
                          <span
                            className={[
                              'mt-0.5 h-4 w-4 rounded-pill',
                              subtask.is_completed ? 'bg-primary' : 'bg-surface-container-high ring-1 ring-white/15',
                            ].join(' ')}
                            aria-hidden="true"
                          />
                          <p
                            className={[
                              'min-w-0 flex-1 font-body text-sm leading-5',
                              subtask.is_completed
                                ? 'text-on-surface-variant line-through'
                                : 'text-on-surface',
                            ].join(' ')}
                          >
                            {subtask.title}
                          </p>
                          {isEditable ? (
                            <button
                              type="button"
                              onClick={() => requestDeleteSubtask(subtask.id)}
                              disabled={isBusy}
                              className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition hover:bg-tertiary/10 hover:text-tertiary disabled:opacity-50"
                              aria-label={`Delete ${subtask.title}`}
                            >
                              <Trash2 className="h-4 w-4" strokeWidth={2} />
                            </button>
                          ) : null}
                        </div>
                      ))
                    )}
                  </div>

                  {isEditable ? (
                    <div className="mt-3 flex gap-2">
                      <input
                        value={newSubtaskTitle}
                        onChange={(event) => setNewSubtaskTitle(event.target.value)}
                        onKeyDown={(event) => {
                          if (event.key === 'Enter' && newSubtaskTitle.trim()) {
                            requestCreateSubtask()
                          }
                        }}
                        className="min-w-0 flex-1 rounded-card border border-dashed border-outline/30 bg-surface-dim px-3 py-3 text-sm text-on-surface outline-none transition placeholder:text-on-surface-variant/45 focus:border-primary"
                        placeholder="Add a subtask..."
                        aria-label="New subtask title"
                        disabled={isBusy}
                      />
                      <button
                        type="button"
                        onClick={requestCreateSubtask}
                        disabled={!newSubtaskTitle.trim() || isBusy}
                        className="rounded-pill bg-primary px-4 py-2 text-sm font-semibold text-surface transition hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50"
                      >
                        Add
                      </button>
                    </div>
                  ) : null}
                </section>
              </div>
            ) : null}
          </div>

          <div className="border-t border-white/10 bg-[rgba(20,20,20,0.86)] p-3 backdrop-blur-xl sm:p-4">
            <div className="flex items-center gap-2">
              <button
                type="button"
                onClick={requestClose}
                className="min-h-11 min-w-0 flex-1 rounded-pill bg-white/5 px-4 py-2.5 text-sm font-medium text-on-surface transition hover:bg-white/10 active:scale-[0.98]"
              >
                Close
              </button>

              <div className="ml-auto flex shrink-0 items-center justify-end gap-1.5">
                {task?.status === 'open' && onComplete ? (
                  <button
                    type="button"
                    onClick={() => runTaskAction(() => onComplete(task))}
                    disabled={isBusy}
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-success/20 text-success transition hover:bg-success/30 active:scale-[0.98] disabled:opacity-50"
                    aria-label="Complete"
                  >
                    <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
                  </button>
                ) : null}

                {task?.status === 'completed' && onRestore ? (
                  <button
                    type="button"
                    onClick={() => runTaskAction(() => onRestore(task))}
                    disabled={isBusy}
                    className="inline-flex items-center justify-center gap-2 rounded-pill bg-surface-container-high px-4 py-3 text-sm font-semibold text-on-surface-variant transition hover:bg-surface-container-highest hover:text-on-surface active:scale-[0.98] disabled:opacity-50"
                  >
                    <RotateCcw className="h-4 w-4" strokeWidth={2} />
                    Restore
                  </button>
                ) : null}

                {task && onRequestDelete ? (
                  <button
                    type="button"
                    onClick={() => runTaskAction(() => onRequestDelete(task))}
                    disabled={isBusy}
                    className="inline-flex h-11 w-9 shrink-0 items-center justify-center text-tertiary transition hover:text-tertiary/80 active:scale-[0.98] disabled:opacity-50"
                    aria-label="Delete task"
                  >
                    <Trash2 className="h-4 w-4" strokeWidth={2} />
                  </button>
                ) : null}

                {isEditable && draft ? (
                  <button
                    type="button"
                    onClick={requestSaveTask}
                    disabled={isBusy || !draft.title.trim()}
                    className="inline-flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-primary text-surface transition hover:bg-primary/90 active:scale-[0.98] disabled:opacity-50"
                    aria-label="Save changes"
                  >
                    <Save className="h-4 w-4" strokeWidth={2} />
                  </button>
                ) : null}
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
