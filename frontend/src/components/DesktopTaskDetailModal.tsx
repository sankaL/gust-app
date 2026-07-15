import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { CheckCircle2, ExternalLink, RotateCcw, Save, Trash2, X } from 'lucide-react'
import { Link } from 'react-router-dom'

import {
  ApiError,
  createSubtask,
  deleteSubtask,
  getTaskDetail,
  updateSubtask,
  updateTask,
  type GroupSummary,
  type SessionStatus,
  type TaskDetail,
  type TaskRecurrence,
} from '../lib/api'
import {
  applyTaskListMutation,
  restoreQuerySnapshots,
  snapshotTaskQueries,
  updateTaskDetailCache,
} from '../lib/taskQueryCache'
import {
  refreshTaskScreenQueries,
  TASK_SCREEN_GC_TIME_MS,
  TASK_SCREEN_STALE_TIME_MS,
} from '../lib/taskScreenCache'
import { dateTimeLocalToIso } from '../lib/dateTime'
import {
  buildTaskDetailDraft,
  RECURRENCE_MONTHS,
  RECURRENCE_OPTIONS,
  RECURRENCE_WEEKDAYS,
  recurrenceForDueDate,
  type TaskDetailDraft,
} from '../lib/taskFormModel'
import { acquireTaskMutationLock, isTaskMutationLocked } from '../lib/taskMutationLocks'
import { requireCsrfToken } from '../lib/sessionSecurity'
import { useNotifications } from './Notifications'
import { DatePicker } from './DatePicker'
import { SelectDropdown } from './SelectDropdown'
import { DesktopTaskGroupField } from './DesktopTaskGroupField'

type DraftState = TaskDetailDraft

type DesktopTaskDetailModalProps = {
  taskId: string | null
  isOpen: boolean
  onClose?: () => void
  session: SessionStatus | undefined
  groups: GroupSummary[]
  mode?: 'modal' | 'page'
  onComplete?: (task: TaskDetail) => void
  onRestore?: (task: TaskDetail) => void
  busyTaskIds?: string[]
}

function buildFriendlyMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError || error instanceof Error) {
    return error.message
  }
  return fallback
}

function formatRecurrenceValue(recurrence: TaskRecurrence | null) {
  if (!recurrence) return 'One-off'
  return recurrence.frequency.charAt(0).toUpperCase() + recurrence.frequency.slice(1)
}

export function DesktopTaskDetailModal({
  taskId,
  isOpen,
  onClose,
  session,
  groups,
  mode = 'modal',
  onComplete,
  onRestore,
  busyTaskIds = [],
}: DesktopTaskDetailModalProps) {
  const queryClient = useQueryClient()
  const { notifyError, notifySuccess } = useNotifications()
  const [draft, setDraft] = useState<DraftState | null>(null)
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('')
  const [subtaskDrafts, setSubtaskDrafts] = useState<Record<string, string>>({})
  const [, setPendingSubtaskIds] = useState<string[]>([])
  const pendingSubtaskIdsRef = useRef(new Set<string>())
  const [isGroupDropdownOpen, setIsGroupDropdownOpen] = useState(false)
  const isModal = mode === 'modal'

  const taskQuery = useQuery({
    queryKey: ['task-detail', taskId],
    queryFn: () => getTaskDetail(taskId as string),
    enabled: isOpen && Boolean(taskId),
    staleTime: TASK_SCREEN_STALE_TIME_MS,
    gcTime: TASK_SCREEN_GC_TIME_MS,
  })

  useEffect(() => {
    setDraft(null)
    setNewSubtaskTitle('')
    setSubtaskDrafts({})
    pendingSubtaskIdsRef.current.clear()
    setPendingSubtaskIds([])
    setIsGroupDropdownOpen(false)
  }, [taskId])

  useEffect(() => {
    if (!taskQuery.data) return
    setDraft((current) => current ?? buildTaskDetailDraft(taskQuery.data, session?.timezone))
    setSubtaskDrafts((current) =>
      Object.fromEntries(
        taskQuery.data.subtasks.map((subtask) => [subtask.id, current[subtask.id] ?? subtask.title])
      )
    )
  }, [taskQuery.data, session?.timezone])

  useEffect(() => {
    if (!isOpen || !isModal) return undefined
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose?.()
    }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isModal, isOpen, onClose])

  function updateDraft(updater: (current: DraftState) => DraftState) {
    setDraft((current) => (current ? updater(current) : current))
  }

  function syncTaskCaches(task: TaskDetail) {
    applyTaskListMutation(queryClient, (currentTask, statusSegment) => {
      if (currentTask.id !== task.id) return currentTask
      return statusSegment === task.status || statusSegment === 'all' ? { ...currentTask, ...task } : currentTask
    })
    updateTaskDetailCache(queryClient, task)
  }

  async function refreshTaskData(task: TaskDetail) {
    await refreshTaskScreenQueries(queryClient, {
      taskId: task.id,
      groupIds: [task.group.id, draft?.groupId],
      statuses: ['open', 'completed'],
      includeAllOpen: true,
      includeAllCompleted: true,
      includeGroupedTaskLists: true,
      includeTaskDetails: true,
    })
  }

  function markSubtaskPending(subtaskId: string, isPending: boolean) {
    if (isPending) {
      pendingSubtaskIdsRef.current.add(subtaskId)
    } else {
      pendingSubtaskIdsRef.current.delete(subtaskId)
    }
    setPendingSubtaskIds((current) =>
      isPending
        ? current.includes(subtaskId)
          ? current
          : [...current, subtaskId]
        : current.filter((candidate) => candidate !== subtaskId)
    )
  }

  function isSubtaskPending(subtaskId: string) {
    return pendingSubtaskIdsRef.current.has(subtaskId)
  }

  const saveTaskMutation = useMutation({
    onMutate: async () => {
      if (!taskId || !draft || !taskQuery.data) return {}
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ['tasks'] }),
        queryClient.cancelQueries({ queryKey: ['desktop', 'tasks'] }),
        queryClient.cancelQueries({ queryKey: ['task-detail', taskId] }),
      ])
      const snapshots = snapshotTaskQueries(queryClient, taskId)
      const optimisticTask: TaskDetail = {
        ...taskQuery.data,
        title: draft.title,
        description: draft.description || null,
        group: groups.find((group) => group.id === draft.groupId) ?? taskQuery.data.group,
        due_date: draft.dueDate || null,
        reminder_at: dateTimeLocalToIso(draft.reminderAt, session?.timezone),
        recurrence: draft.recurrence,
        recurrence_frequency: draft.recurrence?.frequency ?? null,
        needs_review: draft.groupId !== taskQuery.data.group.id ? false : taskQuery.data.needs_review,
      }
      syncTaskCaches(optimisticTask)
      return { snapshots }
    },
    mutationFn: async (releaseLock: () => void) => {
      void releaseLock
      if (!taskId || !draft) throw new Error('Task detail is not ready.')
      return updateTask(
        taskId,
        {
          title: draft.title,
          description: draft.description || null,
          group_id: draft.groupId,
          due_date: draft.dueDate || null,
          reminder_at: dateTimeLocalToIso(draft.reminderAt, session?.timezone),
          recurrence: draft.recurrence,
        },
        requireCsrfToken(session)
      )
    },
    onSuccess: (task) => {
      syncTaskCaches(task)
      setDraft(buildTaskDetailDraft(task, session?.timezone))
      notifySuccess('Task saved.')
      void refreshTaskData(task)
    },
    onError: (error, _variables, context) => {
      if (context?.snapshots) restoreQuerySnapshots(queryClient, context.snapshots)
      notifyError(buildFriendlyMessage(error, 'Task changes could not be saved.'))
    },
    onSettled: (_data, _error, releaseLock) => {
      releaseLock?.()
    },
  })

  const createSubtaskMutation = useMutation({
    onMutate: async () => {
      if (!taskId || !taskQuery.data || !newSubtaskTitle.trim()) return {}
      await queryClient.cancelQueries({ queryKey: ['task-detail', taskId] })
      const snapshots = snapshotTaskQueries(queryClient, taskId)
      const optimisticId = `optimistic-${Date.now()}`
      markSubtaskPending(optimisticId, true)
      updateTaskDetailCache(queryClient, {
        ...taskQuery.data,
        subtasks: [
          ...taskQuery.data.subtasks,
          { id: optimisticId, title: newSubtaskTitle.trim(), is_completed: false, completed_at: null },
        ],
        subtask_count: taskQuery.data.subtask_count + 1,
      })
      applyTaskListMutation(queryClient, (currentTask) =>
        currentTask.id === taskId
          ? { ...currentTask, subtask_count: currentTask.subtask_count + 1 }
          : currentTask
      )
      return { snapshots, optimisticId }
    },
    mutationFn: async () => {
      if (!taskId) throw new Error('Task detail is not ready.')
      return createSubtask(taskId, newSubtaskTitle, requireCsrfToken(session))
    },
    onSuccess: (_subtask, _variables, context) => {
      if (context?.optimisticId) markSubtaskPending(context.optimisticId, false)
      setNewSubtaskTitle('')
      notifySuccess('Subtask added.')
      if (taskQuery.data) void refreshTaskData(taskQuery.data)
    },
    onError: (error, _variables, context) => {
      if (context?.snapshots) restoreQuerySnapshots(queryClient, context.snapshots)
      if (context?.optimisticId) markSubtaskPending(context.optimisticId, false)
      notifyError(buildFriendlyMessage(error, 'Subtask could not be added.'))
    },
  })

  const updateSubtaskMutation = useMutation({
    onMutate: async (payload: { subtaskId: string; title?: string; is_completed?: boolean }) => {
      if (!taskId || !taskQuery.data) return {}
      markSubtaskPending(payload.subtaskId, true)
      await queryClient.cancelQueries({ queryKey: ['task-detail', taskId] })
      const snapshots = snapshotTaskQueries(queryClient, taskId)
      updateTaskDetailCache(queryClient, {
        ...taskQuery.data,
        subtasks: taskQuery.data.subtasks.map((subtask) =>
          subtask.id === payload.subtaskId
            ? {
                ...subtask,
                title: payload.title ?? subtask.title,
                is_completed: payload.is_completed ?? subtask.is_completed,
                completed_at:
                  payload.is_completed === undefined
                    ? subtask.completed_at
                    : payload.is_completed
                      ? new Date().toISOString()
                      : null,
              }
            : subtask
        ),
      })
      return { snapshots }
    },
    mutationFn: async (payload: { subtaskId: string; title?: string; is_completed?: boolean }) => {
      if (!taskId) throw new Error('Task detail is not ready.')
      return updateSubtask(taskId, payload.subtaskId, payload, requireCsrfToken(session))
    },
    onSuccess: (_subtask, payload) => {
      markSubtaskPending(payload.subtaskId, false)
      notifySuccess('Subtask updated.')
      if (taskQuery.data) void refreshTaskData(taskQuery.data)
    },
    onError: (error, payload, context) => {
      if (context?.snapshots) restoreQuerySnapshots(queryClient, context.snapshots)
      markSubtaskPending(payload.subtaskId, false)
      notifyError(buildFriendlyMessage(error, 'Subtask could not be updated.'))
    },
  })

  const deleteSubtaskMutation = useMutation({
    onMutate: async (subtaskId: string) => {
      if (!taskId || !taskQuery.data) return {}
      markSubtaskPending(subtaskId, true)
      await queryClient.cancelQueries({ queryKey: ['task-detail', taskId] })
      const snapshots = snapshotTaskQueries(queryClient, taskId)
      updateTaskDetailCache(queryClient, {
        ...taskQuery.data,
        subtasks: taskQuery.data.subtasks.filter((subtask) => subtask.id !== subtaskId),
        subtask_count: Math.max(0, taskQuery.data.subtask_count - 1),
      })
      applyTaskListMutation(queryClient, (currentTask) =>
        currentTask.id === taskId
          ? { ...currentTask, subtask_count: Math.max(0, currentTask.subtask_count - 1) }
          : currentTask
      )
      return { snapshots }
    },
    mutationFn: async (subtaskId: string) => {
      if (!taskId) throw new Error('Task detail is not ready.')
      return deleteSubtask(taskId, subtaskId, requireCsrfToken(session))
    },
    onSuccess: (_result, subtaskId) => {
      markSubtaskPending(subtaskId, false)
      notifySuccess('Subtask deleted.')
      if (taskQuery.data) void refreshTaskData(taskQuery.data)
    },
    onError: (error, subtaskId, context) => {
      if (context?.snapshots) restoreQuerySnapshots(queryClient, context.snapshots)
      markSubtaskPending(subtaskId, false)
      notifyError(buildFriendlyMessage(error, 'Subtask could not be deleted.'))
    },
  })

  if (!isOpen || !taskId) return null

  const task = taskQuery.data
  const isBusy =
    saveTaskMutation.isPending ||
    createSubtaskMutation.isPending ||
    updateSubtaskMutation.isPending ||
    deleteSubtaskMutation.isPending
  const isActionBusy = task ? busyTaskIds.includes(task.id) || isTaskMutationLocked(task.id) : false
  const recurrenceFrequency = draft?.recurrence?.frequency ?? 'none'
  const completedSubtasks = task?.subtasks.filter((subtask) => subtask.is_completed).length ?? 0

  const content = (
    <div className={isModal ? 'flex max-h-[90dvh] flex-col' : 'flex min-h-[calc(100dvh-8rem)] flex-col'}>
      <header className="flex items-start justify-between gap-5 border-b border-white/10 px-6 py-5">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <span className="text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">
              Desktop editor
            </span>
            {task ? (
              <>
                <span className="rounded-pill bg-surface-container-high px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">
                  {task.status === 'completed' ? 'Completed' : 'Open'}
                </span>
                {task.needs_review ? (
                  <span className="rounded-pill bg-warning/20 px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-warning">
                    Needs review
                  </span>
                ) : null}
              </>
            ) : null}
          </div>
          <h2
            id="desktop-task-editor-title"
            className="mt-3 truncate font-display text-3xl leading-tight text-on-surface"
          >
            {draft?.title || task?.title || 'Loading task'}
          </h2>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {isModal ? (
            <Link
              to={`/desktop/tasks/${taskId}`}
              className="inline-flex h-10 items-center gap-2 rounded-pill bg-surface-container-high px-4 text-sm font-semibold text-on-surface-variant transition hover:bg-surface-container-highest hover:text-on-surface"
            >
              <ExternalLink className="h-4 w-4" strokeWidth={2} />
              Open full page
            </Link>
          ) : null}
          {isModal ? (
            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 items-center justify-center rounded-full bg-white/8 text-on-surface-variant transition hover:bg-white/12 hover:text-on-surface"
              aria-label="Close task editor"
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          ) : null}
        </div>
      </header>

      <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5">
        {taskQuery.isLoading || !draft || !task ? (
          <div className="space-y-4" aria-busy="true">
            <div className="h-28 animate-pulse rounded-card bg-surface-container-high" />
            <div className="h-44 animate-pulse rounded-card bg-surface-container-high" />
          </div>
        ) : taskQuery.isError ? (
          <div className="rounded-card bg-[rgba(80,18,18,0.92)] p-4 text-sm text-red-100">
            {buildFriendlyMessage(taskQuery.error, 'Task detail could not be loaded.')}
          </div>
        ) : (
          <div className="grid gap-6 xl:grid-cols-[minmax(0,1.05fr)_minmax(24rem,0.95fr)]">
            <section className="space-y-5">
              <div>
                <label className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">
                  Title
                </label>
                <input
                  value={draft.title}
                  onChange={(event) => updateDraft((current) => ({ ...current, title: event.target.value }))}
                  className="mt-2 w-full rounded-card bg-surface/65 px-4 py-3 font-display text-2xl text-on-surface outline-none ring-1 ring-white/10 transition focus:bg-surface-container focus:ring-primary"
                  disabled={isBusy}
                  aria-label="Task title"
                />
              </div>

              <div>
                <label className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">
                  Context
                </label>
                <textarea
                  value={draft.description}
                  onChange={(event) => updateDraft((current) => ({ ...current, description: event.target.value }))}
                  rows={7}
                  className="mt-2 w-full resize-none rounded-card bg-surface/55 px-4 py-3 font-body text-sm leading-6 text-on-surface outline-none ring-1 ring-white/10 transition placeholder:text-on-surface-variant/45 focus:bg-surface-container focus:ring-primary"
                  placeholder="Add context that helps you act on this later"
                  disabled={isBusy}
                  aria-label="Task description"
                />
              </div>

              <div className="rounded-card bg-surface/35">
                <DesktopTaskGroupField
                  groups={groups}
                  value={draft.groupId}
                  isOpen={isGroupDropdownOpen}
                  disabled={isBusy}
                  labelWidthClass="sm:grid-cols-[10rem_minmax(0,1fr)]"
                  onChange={(groupId) => updateDraft((current) => ({ ...current, groupId }))}
                  onOpenChange={setIsGroupDropdownOpen}
                />
                <div className="grid border-b border-white/10 px-4 py-3 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-center">
                  <p className="font-body text-xs font-semibold uppercase tracking-[0.13em] text-on-surface-variant">Due date</p>
                  <DatePicker
                    value={draft.dueDate || null}
                    onChange={(value) => {
                      if (!value) {
                        updateDraft((current) => ({ ...current, dueDate: '', reminderAt: '', recurrence: null }))
                      } else {
                        updateDraft((current) => ({ ...current, dueDate: value }))
                      }
                    }}
                    mode="date"
                    disabled={isBusy}
                    placeholder="Select a date"
                  />
                </div>
                <div className="grid border-b border-white/10 px-4 py-3 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-center">
                  <p className="font-body text-xs font-semibold uppercase tracking-[0.13em] text-on-surface-variant">Reminder</p>
                  <DatePicker
                    value={draft.reminderAt || null}
                    onChange={(value) => updateDraft((current) => ({ ...current, reminderAt: value }))}
                    mode="datetime"
                    disabled={!draft.dueDate || isBusy}
                    placeholder={draft.dueDate ? 'Select date & time' : 'Set a due date first'}
                  />
                </div>
                <div className="grid px-4 py-3 sm:grid-cols-[10rem_minmax(0,1fr)] sm:items-start">
                  <p className="font-body text-xs font-semibold uppercase tracking-[0.13em] text-on-surface-variant">Recurrence</p>
                  <div className="space-y-3">
                    <div className="grid gap-2 sm:grid-cols-5">
                      {RECURRENCE_OPTIONS.map((option) => (
                        <button
                          key={option.value}
                          type="button"
                          disabled={!draft.dueDate || isBusy}
                          onClick={() => {
                            if (option.value === 'none') {
                              updateDraft((current) => ({ ...current, recurrence: null }))
                            } else {
                              updateDraft((current) => ({
                                ...current,
                                recurrence: recurrenceForDueDate(option.value, current.dueDate),
                              }))
                            }
                          }}
                          className={[
                            'rounded-card px-3 py-2 text-sm font-medium transition',
                            recurrenceFrequency === option.value
                              ? 'bg-primary text-surface'
                              : 'bg-surface-dim text-on-surface-variant hover:bg-surface-container-high',
                            !draft.dueDate ? 'opacity-50' : '',
                          ].join(' ')}
                        >
                          {option.label}
                        </button>
                      ))}
                    </div>
                    <p className="font-body text-xs text-on-surface-variant">
                      {formatRecurrenceValue(draft.recurrence)}
                    </p>
                    {draft.recurrence?.frequency === 'weekly' ? (
                      <SelectDropdown
                        label=""
                        options={RECURRENCE_WEEKDAYS}
                        value={draft.recurrence.weekday ?? ''}
                        onChange={(value) =>
                          updateDraft((current) => ({
                            ...current,
                            recurrence: {
                              frequency: 'weekly',
                              weekday: value === '' ? null : Number(value),
                              day_of_month: null,
                              month: null,
                            },
                          }))
                        }
                        disabled={isBusy}
                      />
                    ) : null}
                    {draft.recurrence?.frequency === 'monthly' ? (
                      <input
                        type="number"
                        min={1}
                        max={31}
                        value={draft.recurrence.day_of_month ?? ''}
                        onChange={(event) =>
                          updateDraft((current) => ({
                            ...current,
                            recurrence: {
                              frequency: 'monthly',
                              weekday: null,
                              day_of_month: event.target.value ? Number(event.target.value) : null,
                              month: null,
                            },
                          }))
                        }
                        className="w-full rounded-card bg-surface-dim px-3 py-3 text-sm font-medium text-on-surface outline-none ring-1 ring-white/10 focus:ring-primary"
                        disabled={isBusy}
                        aria-label="Recurrence day of month"
                      />
                    ) : null}
                    {draft.recurrence?.frequency === 'yearly' ? (
                      <div className="grid gap-2 sm:grid-cols-[minmax(0,1fr)_7rem]">
                        <SelectDropdown
                          label=""
                          options={RECURRENCE_MONTHS}
                          value={draft.recurrence.month ?? ''}
                          onChange={(value) =>
                            updateDraft((current) => ({
                              ...current,
                              recurrence: {
                                frequency: 'yearly',
                                weekday: null,
                                day_of_month: current.recurrence?.day_of_month ?? null,
                                month: value === '' ? null : Number(value),
                              },
                            }))
                          }
                          disabled={isBusy}
                        />
                        <input
                          type="number"
                          min={1}
                          max={31}
                          value={draft.recurrence.day_of_month ?? ''}
                          onChange={(event) =>
                            updateDraft((current) => ({
                              ...current,
                              recurrence: {
                                frequency: 'yearly',
                                weekday: null,
                                day_of_month: event.target.value ? Number(event.target.value) : null,
                                month: current.recurrence?.month ?? null,
                              },
                            }))
                          }
                          className="w-full rounded-card bg-surface-dim px-3 py-3 text-sm font-medium text-on-surface outline-none ring-1 ring-white/10 focus:ring-primary"
                          disabled={isBusy}
                          aria-label="Recurrence day of year"
                        />
                      </div>
                    ) : null}
                  </div>
                </div>
              </div>
            </section>

            <section className="min-w-0 space-y-4">
              <div className="flex items-center justify-between gap-3 border-b border-white/10 pb-3">
                <div>
                  <h3 className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">
                    Subtasks
                  </h3>
                  <p className="mt-1 font-body text-xs text-on-surface-variant">
                    {completedSubtasks} of {task.subtasks.length} done
                  </p>
                </div>
              </div>

              <div className="divide-y divide-white/10 rounded-card bg-surface/35">
                {task.subtasks.length === 0 ? (
                  <p className="px-4 py-5 font-body text-sm text-on-surface-variant">No subtasks yet.</p>
                ) : (
                  task.subtasks.map((subtask) => (
                    <div key={subtask.id} className="flex items-center gap-3 px-4 py-3">
                      <button
                        type="button"
                        onClick={() => {
                          if (isSubtaskPending(subtask.id)) return
                          markSubtaskPending(subtask.id, true)
                          updateSubtaskMutation.mutate({
                            subtaskId: subtask.id,
                            is_completed: !subtask.is_completed,
                          })
                        }}
                        disabled={isSubtaskPending(subtask.id)}
                        className={[
                          'flex h-5 w-5 shrink-0 items-center justify-center rounded-full border transition',
                          subtask.is_completed
                            ? 'border-primary bg-primary text-surface'
                            : 'border-outline/30 bg-surface-container-high text-transparent hover:border-primary',
                        ].join(' ')}
                        aria-label={`Toggle ${subtask.title}`}
                      >
                        <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2.4} />
                      </button>
                      <input
                        value={subtaskDrafts[subtask.id] ?? subtask.title}
                        onChange={(event) =>
                          setSubtaskDrafts((current) => ({ ...current, [subtask.id]: event.target.value }))
                        }
                        onBlur={() => {
                          const nextTitle = subtaskDrafts[subtask.id]?.trim()
                          if (nextTitle && nextTitle !== subtask.title && !isSubtaskPending(subtask.id)) {
                            markSubtaskPending(subtask.id, true)
                            updateSubtaskMutation.mutate({ subtaskId: subtask.id, title: nextTitle })
                          }
                        }}
                        className={[
                          'min-w-0 flex-1 rounded-none bg-transparent py-1 font-body text-sm outline-none',
                          subtask.is_completed ? 'text-on-surface-variant line-through' : 'text-on-surface',
                        ].join(' ')}
                        aria-label={`Subtask ${subtask.title}`}
                        disabled={isSubtaskPending(subtask.id)}
                      />
                      <button
                        type="button"
                        onClick={() => {
                          if (isSubtaskPending(subtask.id)) return
                          markSubtaskPending(subtask.id, true)
                          deleteSubtaskMutation.mutate(subtask.id)
                        }}
                        disabled={isSubtaskPending(subtask.id)}
                        className="rounded-full p-2 text-on-surface-variant transition hover:bg-tertiary/10 hover:text-tertiary disabled:opacity-50"
                        aria-label={`Delete ${subtask.title}`}
                      >
                        <Trash2 className="h-4 w-4" strokeWidth={2} />
                      </button>
                    </div>
                  ))
                )}
              </div>

              <div className="flex gap-2">
                <input
                  value={newSubtaskTitle}
                  onChange={(event) => setNewSubtaskTitle(event.target.value)}
                  onKeyDown={(event) => {
                    if (event.key === 'Enter' && newSubtaskTitle.trim()) {
                      createSubtaskMutation.mutate()
                    }
                  }}
                  placeholder="Add a subtask..."
                  className="min-w-0 flex-1 rounded-card border border-dashed border-outline/30 bg-surface-dim px-3 py-3 text-sm text-on-surface outline-none focus:border-primary"
                  disabled={isBusy}
                />
                <button
                  type="button"
                  onClick={() => createSubtaskMutation.mutate()}
                  disabled={!newSubtaskTitle.trim() || isBusy}
                  className="rounded-pill bg-primary px-4 py-2 text-sm font-semibold text-surface transition hover:-translate-y-px active:translate-y-0 disabled:opacity-50"
                >
                  Add
                </button>
              </div>
            </section>
          </div>
        )}
      </div>

      {task && draft ? (
        <footer className="flex items-center justify-end gap-3 border-t border-white/10 bg-[rgba(20,20,20,0.86)] px-6 py-4 backdrop-blur-xl">
          <div className="flex items-center gap-2">
            {task.status === 'open' && onComplete ? (
              <button
                type="button"
                onClick={() => onComplete(task)}
                disabled={isActionBusy}
                className="inline-flex items-center gap-2 rounded-pill bg-success/20 px-4 py-2.5 text-sm font-semibold text-success transition hover:bg-success/30 disabled:opacity-50"
              >
                <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
                Complete
              </button>
            ) : null}
            {task.status === 'completed' && onRestore ? (
              <button
                type="button"
                onClick={() => onRestore(task)}
                disabled={isActionBusy}
                className="inline-flex items-center gap-2 rounded-pill bg-surface-container-high px-4 py-2.5 text-sm font-semibold text-on-surface-variant transition hover:bg-surface-container-highest hover:text-on-surface disabled:opacity-50"
              >
                <RotateCcw className="h-4 w-4" strokeWidth={2} />
                Restore
              </button>
            ) : null}
          </div>
          <button
            type="button"
            onClick={() => {
              if (!taskId) return
              const releaseLock = acquireTaskMutationLock(taskId)
              if (!releaseLock) {
                notifyError('Task is already updating.')
                return
              }
              saveTaskMutation.mutate(releaseLock)
            }}
            disabled={isBusy || !draft.title.trim() || (taskId ? isTaskMutationLocked(taskId) : false)}
            className="inline-flex items-center gap-2 rounded-pill bg-primary px-5 py-2.5 text-sm font-semibold text-surface transition hover:-translate-y-px active:translate-y-0 disabled:opacity-50"
          >
            <Save className="h-4 w-4" strokeWidth={2} />
            Save changes
          </button>
        </footer>
      ) : null}
    </div>
  )

  if (!isModal) {
    return (
      <section className="overflow-hidden rounded-soft bg-[radial-gradient(circle_at_top_left,_rgba(186,158,255,0.14),_rgba(28,28,27,0.98)_38%,_rgba(14,14,14,1)_100%)] shadow-ambient">
        {content}
      </section>
    )
  }

  return (
    <div
      className="fixed inset-0 z-[120] flex items-center justify-center bg-black/65 p-5 backdrop-blur-md"
      role="dialog"
      aria-modal="true"
      aria-labelledby="desktop-task-editor-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose?.()
      }}
    >
      <div className="w-full max-w-6xl overflow-hidden rounded-[1.35rem] bg-[radial-gradient(circle_at_top_left,_rgba(186,158,255,0.14),_rgba(28,28,27,0.98)_38%,_rgba(14,14,14,1)_100%)] shadow-[0_28px_80px_rgba(0,0,0,0.62)]">
        {content}
      </div>
    </div>
  )
}
