import { useCallback, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { useNotifications } from '../components/Notifications'
import { SessionGuard } from '../components/SessionGuard'
import { PullToRefresh, TaskScreenRefreshButton } from '../components/TaskScreenRefresh'
import { TaskDeleteDialog } from '../components/TaskDeleteDialog'
import { TaskFormFields } from '../components/TaskFormFields'
import {
  ApiError,
  createSubtask,
  deleteSubtask,
  deleteTask,
  getSessionStatus,
  getTaskDetail,
  listGroups,
  restoreTask,
  updateSubtask,
  updateTask,
  type TaskDeleteScope,
  type TaskRecurrence,
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
  refreshTaskScreenQueries,
  TASK_SCREEN_GC_TIME_MS,
  TASK_SCREEN_STALE_TIME_MS,
} from '../lib/taskScreenCache'

type DraftState = {
  title: string
  description: string
  groupId: string
  dueDate: string
  reminderAt: string
  recurrence: TaskRecurrence | null
}

type SubtaskDetail = Awaited<ReturnType<typeof getTaskDetail>>['subtasks'][number]

function buildFriendlyMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message
  }

  return fallback
}

function toDateTimeLocalValue(value: string | null) {
  if (!value) {
    return ''
  }

  const date = new Date(value)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

function formatDueDate(value: string) {
  if (!value) {
    return 'No due date'
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(`${value}T12:00:00`))
}

function formatReminderValue(value: string) {
  if (!value) {
    return 'No reminder'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return 'No reminder'
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function formatRecurrenceValue(recurrence: TaskRecurrence | null) {
  if (!recurrence) {
    return 'One-off'
  }

  return recurrence.frequency.charAt(0).toUpperCase() + recurrence.frequency.slice(1)
}

function formatSubtaskCount(count: number) {
  return `${count} ${count === 1 ? 'subtask' : 'subtasks'}`
}

function buildReturnPath(searchParams: URLSearchParams) {
  const params = new URLSearchParams()
  const group = searchParams.get('group')

  if (group) {
    params.set('group', group)
  }

  const nextSearch = params.toString()
  return nextSearch ? `/tasks?${nextSearch}` : '/tasks'
}

function buildDraftState(task: Awaited<ReturnType<typeof getTaskDetail>>): DraftState {
  return {
    title: task.title,
    description: task.description ?? '',
    groupId: task.group.id,
    dueDate: task.due_date ?? '',
    reminderAt: toDateTimeLocalValue(task.reminder_at),
    recurrence: task.recurrence,
  }
}

function mergeSubtaskDrafts(
  current: Record<string, string>,
  subtasks: SubtaskDetail[]
): Record<string, string> {
  return Object.fromEntries(
    subtasks.map((subtask) => [subtask.id, current[subtask.id] ?? subtask.title])
  )
}

export function TaskDetailRoute() {
  const { taskId } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const [draft, setDraft] = useState<DraftState | null>(null)
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('')
  const [subtaskDrafts, setSubtaskDrafts] = useState<Record<string, string>>({})
  const [isEditMode, setIsEditMode] = useState(false)
  const [isGroupDropdownOpen, setIsGroupDropdownOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<{ scope: TaskDeleteScope } | null>(null)
  const [pendingSubtaskIds, setPendingSubtaskIds] = useState<string[]>([])
  const { dismissNotification, notifyError, notifySuccess, showNotification, updateNotification } =
    useNotifications()

  const sessionQuery = useQuery({
    queryKey: ['session-status'],
    queryFn: getSessionStatus,
    retry: false,
  })

  const taskQuery = useQuery({
    queryKey: ['task-detail', taskId],
    queryFn: () => getTaskDetail(taskId as string),
    enabled: sessionQuery.data?.signed_in === true && Boolean(taskId),
    staleTime: TASK_SCREEN_STALE_TIME_MS,
    gcTime: TASK_SCREEN_GC_TIME_MS,
  })

  const shouldLoadGroups = Boolean(
    sessionQuery.data?.signed_in === true && (isEditMode || taskQuery.data?.needs_review)
  )

  const groupsQuery = useQuery({
    queryKey: ['groups'],
    queryFn: listGroups,
    enabled: shouldLoadGroups,
    staleTime: TASK_SCREEN_STALE_TIME_MS,
    gcTime: TASK_SCREEN_GC_TIME_MS,
  })

  useEffect(() => {
    setDraft(null)
    setSubtaskDrafts({})
    setNewSubtaskTitle('')
    setIsEditMode(false)
    setIsGroupDropdownOpen(false)
  }, [taskId])

  useEffect(() => {
    if (!taskQuery.data) {
      return
    }

    setDraft((current) => current ?? buildDraftState(taskQuery.data))
    setSubtaskDrafts((current) => mergeSubtaskDrafts(current, taskQuery.data.subtasks))
    setIsEditMode((current) => current || taskQuery.data.needs_review)
  }, [taskQuery.data])

  function requireCsrf() {
    const csrfToken = sessionQuery.data?.csrf_token
    if (!csrfToken) {
      throw new ApiError('Your session is missing a CSRF token.', 'csrf_missing', 403)
    }
    return csrfToken
  }

  const refreshTaskData = useCallback(
    (groupIds: Array<string | null | undefined> = [taskQuery.data?.group.id]) =>
      refreshTaskScreenQueries(queryClient, {
        taskId,
        groupIds,
        statuses: ['open', 'completed'],
        includeAllOpen: true,
        includeAllCompleted: true,
      }),
    [queryClient, taskId, taskQuery.data?.group.id]
  )
  const isRefreshingTaskDetail =
    (taskQuery.isFetching && !taskQuery.isLoading) ||
    (groupsQuery.isFetching && !groupsQuery.isLoading)

  function markSubtaskPending(subtaskId: string, isPending: boolean) {
    setPendingSubtaskIds((current) => {
      if (isPending) {
        return current.includes(subtaskId) ? current : [...current, subtaskId]
      }
      return current.filter((candidate) => candidate !== subtaskId)
    })
  }

  function updateDraft(updater: (current: DraftState) => DraftState) {
    setDraft((current) => (current ? updater(current) : current))
  }

  function syncTaskCaches(task: Awaited<ReturnType<typeof getTaskDetail>>) {
    applyTaskListMutation(queryClient, (currentTask, statusSegment) => {
      if (currentTask.id !== task.id) {
        return currentTask
      }
      return statusSegment === task.status ? { ...currentTask, ...task } : null
    })
    prependTaskToMatchingLists(queryClient, task, task.status)
    updateTaskDetailCache(queryClient, task)
  }

  const returnPath = buildReturnPath(searchParams)

  async function returnToTasks(replace = false) {
    await navigate(returnPath, { replace })
  }

  const saveTaskMutation = useMutation({
    onMutate: async () => {
      if (!taskId || !draft || !taskQuery.data) {
        return {}
      }

      await Promise.all([
        queryClient.cancelQueries({ queryKey: ['tasks'] }),
        queryClient.cancelQueries({ queryKey: ['groups'] }),
        queryClient.cancelQueries({ queryKey: ['task-detail', taskId] }),
      ])

      const snapshots = snapshotTaskQueries(queryClient, taskId)
      const previousTask = taskQuery.data
      const optimisticTask = {
        ...previousTask,
        title: draft.title,
        description: draft.description || null,
        group: groupsQuery.data?.find((group) => group.id === draft.groupId) ?? previousTask.group,
        due_date: draft.dueDate || null,
        reminder_at: draft.reminderAt ? new Date(draft.reminderAt).toISOString() : null,
        recurrence: draft.recurrence,
        recurrence_frequency: draft.recurrence?.frequency ?? null,
        needs_review: draft.groupId !== previousTask.group.id ? false : previousTask.needs_review,
      }

      syncTaskCaches(optimisticTask)
      if (previousTask.group.id !== optimisticTask.group.id && previousTask.status === 'open') {
        adjustGroupOpenCount(queryClient, previousTask.group.id, -1)
        adjustGroupOpenCount(queryClient, optimisticTask.group.id, 1)
      }

      return {
        snapshots,
        previousGroupId: previousTask.group.id,
        nextGroupId: optimisticTask.group.id,
      }
    },
    mutationFn: async () => {
      if (!taskId || !draft) {
        throw new Error('Task detail is not ready.')
      }

      const csrfToken = requireCsrf()
      return updateTask(
        taskId,
        {
          title: draft.title,
          description: draft.description || null,
          group_id: draft.groupId,
          due_date: draft.dueDate || null,
          reminder_at: draft.reminderAt ? new Date(draft.reminderAt).toISOString() : null,
          recurrence: draft.recurrence,
        },
        csrfToken
      )
    },
    onSuccess: async (task, _variables, context) => {
      syncTaskCaches(task)
      notifySuccess('Task saved.')
      await refreshTaskData([context?.previousGroupId, context?.nextGroupId, task.group.id])
      await returnToTasks(true)
    },
    onError: (error, _variables, context) => {
      if (context?.snapshots) {
        restoreQuerySnapshots(queryClient, context.snapshots)
      }
      notifyError(buildFriendlyMessage(error, 'Task changes could not be saved.'))
    },
  })

  const createSubtaskMutation = useMutation({
    onMutate: async () => {
      if (!taskId || !taskQuery.data || !newSubtaskTitle.trim()) {
        return {}
      }
      await queryClient.cancelQueries({ queryKey: ['task-detail', taskId] })
      const snapshots = snapshotTaskQueries(queryClient, taskId)
      const optimisticId = `optimistic-${Date.now()}`
      markSubtaskPending(optimisticId, true)
      updateTaskDetailCache(queryClient, {
        ...taskQuery.data,
        subtasks: [
          ...taskQuery.data.subtasks,
          {
            id: optimisticId,
            title: newSubtaskTitle.trim(),
            is_completed: false,
            completed_at: null,
          },
        ],
      })
      applyTaskListMutation(queryClient, (currentTask) =>
        currentTask.id === taskId
          ? { ...currentTask, subtask_count: currentTask.subtask_count + 1 }
          : currentTask
      )
      return { snapshots, optimisticId }
    },
    mutationFn: async () => {
      if (!taskId) {
        throw new Error('Task detail is not ready.')
      }
      const csrfToken = requireCsrf()
      return createSubtask(taskId, newSubtaskTitle, csrfToken)
    },
    onSuccess: (_subtask, _variables, context) => {
      if (context?.optimisticId) {
        markSubtaskPending(context.optimisticId, false)
      }
      setNewSubtaskTitle('')
      notifySuccess('Subtask added.')
      void refreshTaskData()
    },
    onError: (error, _variables, context) => {
      if (context?.snapshots) {
        restoreQuerySnapshots(queryClient, context.snapshots)
      }
      if (context?.optimisticId) {
        markSubtaskPending(context.optimisticId, false)
      }
      notifyError(buildFriendlyMessage(error, 'Subtask could not be added.'))
    },
  })

  const updateSubtaskMutation = useMutation({
    onMutate: async (payload: { subtaskId: string; title?: string; is_completed?: boolean }) => {
      if (!taskId || !taskQuery.data) {
        return {}
      }
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
      if (!taskId) {
        throw new Error('Task detail is not ready.')
      }
      const csrfToken = requireCsrf()
      return updateSubtask(taskId, payload.subtaskId, payload, csrfToken)
    },
    onSuccess: (_subtask, payload) => {
      markSubtaskPending(payload.subtaskId, false)
      notifySuccess('Subtask updated.')
      void refreshTaskData()
    },
    onError: (error, payload, context) => {
      if (context?.snapshots) {
        restoreQuerySnapshots(queryClient, context.snapshots)
      }
      markSubtaskPending(payload.subtaskId, false)
      notifyError(buildFriendlyMessage(error, 'Subtask could not be updated.'))
    },
  })

  const deleteSubtaskMutation = useMutation({
    onMutate: async (subtaskId: string) => {
      if (!taskId || !taskQuery.data) {
        return {}
      }
      markSubtaskPending(subtaskId, true)
      await queryClient.cancelQueries({ queryKey: ['task-detail', taskId] })
      const snapshots = snapshotTaskQueries(queryClient, taskId)
      updateTaskDetailCache(queryClient, {
        ...taskQuery.data,
        subtasks: taskQuery.data.subtasks.filter((subtask) => subtask.id !== subtaskId),
      })
      applyTaskListMutation(queryClient, (currentTask) =>
        currentTask.id === taskId
          ? { ...currentTask, subtask_count: Math.max(0, currentTask.subtask_count - 1) }
          : currentTask
      )
      return { snapshots }
    },
    mutationFn: async (subtaskId: string) => {
      if (!taskId) {
        throw new Error('Task detail is not ready.')
      }
      const csrfToken = requireCsrf()
      return deleteSubtask(taskId, subtaskId, csrfToken)
    },
    onSuccess: (_result, subtaskId) => {
      markSubtaskPending(subtaskId, false)
      notifySuccess('Subtask deleted.')
      void refreshTaskData()
    },
    onError: (error, subtaskId, context) => {
      if (context?.snapshots) {
        restoreQuerySnapshots(queryClient, context.snapshots)
      }
      markSubtaskPending(subtaskId, false)
      notifyError(buildFriendlyMessage(error, 'Subtask could not be deleted.'))
    },
  })

  const deleteTaskMutation = useMutation({
    onMutate: async (scope: TaskDeleteScope) => {
      if (!taskId || !taskQuery.data) {
        return { scope }
      }
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ['tasks'] }),
        queryClient.cancelQueries({ queryKey: ['groups'] }),
        queryClient.cancelQueries({ queryKey: ['task-detail', taskId] }),
      ])
      const snapshots = snapshotTaskQueries(queryClient, taskId)
      applyTaskListMutation(queryClient, (currentTask) =>
        currentTask.id === taskId ? null : currentTask
      )
      if (taskQuery.data.status === 'open') {
        adjustGroupOpenCount(queryClient, taskQuery.data.group.id, -1)
      }
      updateTaskDetailCache(queryClient, {
        ...taskQuery.data,
        deleted_at: new Date().toISOString(),
      })
      return { snapshots, scope }
    },
    mutationFn: async (scope: TaskDeleteScope) => {
      if (!taskId) {
        throw new Error('Task detail is not ready.')
      }
      const csrfToken = requireCsrf()
      return deleteTask(taskId, csrfToken, scope)
    },
    onSuccess: async () => {
      setPendingDelete(null)
      const taskTitle = taskQuery.data?.title ?? 'task'
      const deletedTaskId = taskId as string
      const csrfToken = requireCsrf()
      const notificationId = showNotification({
        type: 'warning',
        message: `Deleted ${taskTitle}`,
        actionLabel: 'Undo',
        onAction: async () => {
          updateNotification(notificationId, {
            type: 'loading',
            message: `Restoring ${taskTitle}...`,
            actionLabel: undefined,
            onAction: undefined,
            dismissible: false,
            durationMs: null,
          })

          try {
            const restoredTask = await restoreTask(deletedTaskId, csrfToken)
            adjustGroupOpenCount(queryClient, restoredTask.group.id, 1)
            syncTaskCaches(restoredTask)
            dismissNotification(notificationId)
            notifySuccess(`Restored ${taskTitle}.`)
            await refreshTaskScreenQueries(queryClient, {
              taskId: deletedTaskId,
              groupIds: [restoredTask.group.id],
              statuses: ['open', 'completed'],
              includeAllOpen: true,
              includeAllCompleted: true,
            })
          } catch (error) {
            updateNotification(notificationId, {
              type: 'error',
              message: buildFriendlyMessage(error, 'Task could not be restored.'),
              dismissible: true,
              durationMs: 3000,
            })
          }
        },
      })
      await refreshTaskData()
      await returnToTasks(true)
    },
    onError: (error, _scope, context) => {
      if (context?.snapshots) {
        restoreQuerySnapshots(queryClient, context.snapshots)
      }
      notifyError(buildFriendlyMessage(error, 'Task could not be deleted.'))
      setPendingDelete(null)
    },
  })

  function handleDeleteTask() {
    const task = taskQuery.data
    if (!task) return
    setPendingDelete({ scope: 'occurrence' })
  }

  const isBusy =
    saveTaskMutation.isPending ||
    createSubtaskMutation.isPending ||
    updateSubtaskMutation.isPending ||
    deleteSubtaskMutation.isPending ||
    deleteTaskMutation.isPending

  const groupName =
    groupsQuery.data?.find((group) => group.id === draft?.groupId)?.name ??
    taskQuery.data?.group.name ??
    'Unknown group'
  const recurrenceLabel = draft ? formatRecurrenceValue(draft.recurrence) : 'One-off'
  const dueLabel = draft ? formatDueDate(draft.dueDate) : 'No due date'
  const reminderLabel = draft ? formatReminderValue(draft.reminderAt) : 'No reminder'
  const subtaskCount = taskQuery.data?.subtasks.length ?? 0

  return (
    <SessionGuard
      session={sessionQuery.data}
      isLoading={sessionQuery.isLoading}
      isError={sessionQuery.isError}
      title="Task Detail"
      eyebrow="Focused editing"
      description="Refine the title, group, dates, reminders, and subtasks for a single task."
    >
      <PullToRefresh isRefreshing={isRefreshingTaskDetail} onRefresh={refreshTaskData}>
      <section
        className="space-y-5"
        style={{ paddingBottom: 'calc(12.5rem + var(--safe-area-bottom))' }}
      >
        <TaskScreenRefreshButton
          isRefreshing={isRefreshingTaskDetail}
          label="Refresh task"
          onRefresh={refreshTaskData}
        />

        {taskQuery.isError ? (
          <div className="rounded-card bg-[rgba(80,18,18,0.92)] p-6 text-sm text-red-100 shadow-[0_18px_36px_rgba(0,0,0,0.4)]">
            {buildFriendlyMessage(taskQuery.error, 'Task detail could not be loaded.')}
          </div>
        ) : taskQuery.isLoading || !draft || !taskQuery.data ? (
          <div className="rounded-card bg-surface-container p-6 text-sm text-on-surface-variant">
            Loading task detail.
          </div>
        ) : (
          <>
            <div className="relative z-20 rounded-[1.7rem] bg-[radial-gradient(circle_at_top_left,_rgba(186,158,255,0.16),_rgba(32,32,31,0.98)_40%,_rgba(14,14,14,1)_100%)] p-5 shadow-[0_24px_60px_rgba(0,0,0,0.48)]">
              <div className="space-y-5">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-pill bg-white/6 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">
                      {isEditMode ? 'Editing task' : 'Task summary'}
                    </span>
                    <span className="rounded-pill bg-surface-container-high px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">
                      {groupName}
                    </span>
                    {taskQuery.data.needs_review ? (
                      <span className="rounded-pill bg-warning/20 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-warning">
                        Needs review
                      </span>
                    ) : null}
                  </div>

                  <div className="space-y-3">
                    {isEditMode ? (
                      <TaskFormFields
                        title={draft.title}
                        description={draft.description}
                        groupId={draft.groupId}
                        dueDate={draft.dueDate}
                        reminderAt={draft.reminderAt}
                        recurrence={draft.recurrence}
                        groups={groupsQuery.data ?? []}
                        isGroupDropdownOpen={isGroupDropdownOpen}
                        disabled={isBusy}
                        onTitleChange={(value) =>
                          updateDraft((current) => ({ ...current, title: value }))
                        }
                        onDescriptionChange={(value) =>
                          updateDraft((current) => ({ ...current, description: value }))
                        }
                        onGroupIdChange={(value) =>
                          updateDraft((current) => ({ ...current, groupId: value }))
                        }
                        onDueDateChange={(value) => {
                          if (!value) {
                            updateDraft((current) => ({
                              ...current,
                              dueDate: '',
                              reminderAt: '',
                              recurrence: null,
                            }))
                          } else {
                            updateDraft((current) => ({ ...current, dueDate: value }))
                          }
                        }}
                        onReminderAtChange={(value) =>
                          updateDraft((current) => ({ ...current, reminderAt: value }))
                        }
                        onRecurrenceChange={(value) =>
                          updateDraft((current) => ({ ...current, recurrence: value }))
                        }
                        onGroupDropdownOpenChange={setIsGroupDropdownOpen}
                      />
                    ) : (
                      <>
                        <h2 className="font-display text-[2.15rem] leading-tight text-on-surface">
                          {draft.title}
                        </h2>
                        <p className="max-w-sm text-sm leading-6 text-on-surface-variant">
                          {draft.description || 'No additional context yet. Edit this task to add the detail that helps you act faster later.'}
                        </p>
                      </>
                    )}
                  </div>
                </div>

                {!isEditMode && (
                  <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                    <div className="min-w-0 rounded-[1.35rem] bg-black/20 p-4 backdrop-blur-sm">
                      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">
                        Due date
                      </p>
                      <p className="mt-3 text-base font-medium text-on-surface">{dueLabel}</p>
                    </div>

                    <div className="min-w-0 rounded-[1.35rem] bg-black/20 p-4 backdrop-blur-sm">
                      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">
                        Reminder
                      </p>
                      <p className="mt-3 text-base font-medium text-on-surface">{reminderLabel}</p>
                    </div>

                    <div className="min-w-0 rounded-[1.35rem] bg-black/20 p-4 backdrop-blur-sm">
                      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">
                        Group
                      </p>
                      <p className="mt-3 text-base font-medium text-on-surface">{groupName}</p>
                    </div>

                    <div className="relative z-0 min-w-0 rounded-[1.35rem] bg-black/20 p-4 backdrop-blur-sm sm:col-span-2">
                      <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">
                        Recurrence
                      </p>
                      <p className="mt-3 text-base font-medium text-on-surface">{recurrenceLabel}</p>
                    </div>
                  </div>
                )}

                {!isEditMode && (
                  <div className="rounded-[1.35rem] bg-surface/45 p-4 text-sm text-on-surface-variant shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]">
                    Open edit mode when you want to change details. Delete still asks for confirmation before it removes this task.
                  </div>
                )}
              </div>
            </div>

            {!isEditMode && (
              <div className="rounded-soft bg-surface-container p-4 shadow-ambient">
                <div className="space-y-3">
                  <div>
                    <p className="font-display text-xl text-on-surface">Recurrence</p>
                    <p className="mt-1 font-body text-xs text-on-surface-variant">
                      This task keeps a simple cadence. Edit it if you need to change how often it repeats.
                    </p>
                  </div>
                  <div className="rounded-card bg-surface-dim px-4 py-4">
                    <p className="text-on-surface">{recurrenceLabel}</p>
                  </div>
                </div>
              </div>
            )}

            <div className="rounded-soft bg-surface-container p-4 shadow-ambient">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-display text-xl text-on-surface">Subtasks</p>
                    <p className="mt-1 font-body text-xs text-on-surface-variant">
                      {isEditMode
                        ? 'Add, rename, complete, or remove checklist items.'
                        : 'These are the smaller actions that drive this task forward.'}
                    </p>
                  </div>
                  <span className="inline-flex shrink-0 whitespace-nowrap rounded-pill bg-surface-container-high px-3 py-1 text-xs uppercase tracking-[0.12em] text-on-surface-variant">
                    {formatSubtaskCount(subtaskCount)}
                  </span>
                </div>

                <div className="space-y-2">
                  {taskQuery.data.subtasks.length === 0 ? (
                    <div className="rounded-card bg-surface-dim px-4 py-4 text-sm text-on-surface-variant">
                      No subtasks yet.
                    </div>
                  ) : (
                    taskQuery.data.subtasks.map((subtask) => (
                      <div key={subtask.id} className="rounded-card bg-surface-dim p-3">
                        <div className="flex items-start gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              updateSubtaskMutation.mutate({
                                subtaskId: subtask.id,
                                is_completed: !subtask.is_completed,
                              })
                            }
                            disabled={pendingSubtaskIds.includes(subtask.id)}
                            className={[
                              'mt-0.5 h-5 w-5 rounded-pill border',
                              subtask.is_completed
                                ? 'border-primary bg-primary'
                                : 'border-outline/25 bg-surface-container-high',
                            ].join(' ')}
                            aria-label={`Toggle ${subtask.title}`}
                          />
                          <div className="flex-1 space-y-2">
                            {isEditMode ? (
                              <input
                                value={subtaskDrafts[subtask.id] ?? subtask.title}
                                onChange={(event) =>
                                  setSubtaskDrafts({
                                    ...subtaskDrafts,
                                    [subtask.id]: event.target.value,
                                  })
                                }
                                className="w-full rounded-card bg-surface-container px-3 py-2 text-on-surface outline-none focus:bg-surface-container-high"
                                aria-label={`Subtask ${subtask.title}`}
                              />
                            ) : (
                              <p
                                className={[
                                  'text-on-surface',
                                  subtask.is_completed ? 'line-through text-on-surface-variant' : '',
                                ].join(' ')}
                              >
                                {subtask.title}
                              </p>
                            )}
                            {isEditMode ? (
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateSubtaskMutation.mutate({
                                      subtaskId: subtask.id,
                                      title: subtaskDrafts[subtask.id],
                                    })
                                  }
                                  disabled={pendingSubtaskIds.includes(subtask.id)}
                                  className="rounded-pill bg-primary px-3 py-1.5 text-sm font-medium text-surface"
                                >
                                  Save
                                </button>
                                <button
                                  type="button"
                                  onClick={() => deleteSubtaskMutation.mutate(subtask.id)}
                                  disabled={pendingSubtaskIds.includes(subtask.id)}
                                  className="rounded-pill border border-outline/30 px-3 py-1.5 text-sm text-on-surface-variant"
                                >
                                  Delete
                                </button>
                              </div>
                            ) : null}
                          </div>
                        </div>
                      </div>
                    ))
                  )}
                </div>

                {isEditMode ? (
                  <div className="flex gap-2">
                    <input
                      value={newSubtaskTitle}
                      onChange={(event) => setNewSubtaskTitle(event.target.value)}
                      placeholder="Add a subtask..."
                      className="flex-1 rounded-card border border-dashed border-outline/30 bg-surface-dim px-3 py-3 text-on-surface outline-none focus:border-primary"
                    />
                    <button
                      type="button"
                      onClick={() => createSubtaskMutation.mutate()}
                      disabled={!newSubtaskTitle.trim()}
                      className="rounded-pill bg-primary px-4 py-2 text-sm font-medium text-surface disabled:opacity-50"
                    >
                      Add
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            <TaskDeleteDialog
              isOpen={pendingDelete !== null}
              taskTitle={taskQuery.data.title}
              isRecurring={Boolean(taskQuery.data.series_id || taskQuery.data.recurrence_frequency)}
              isDeleting={deleteTaskMutation.isPending}
              followUpMessage="After delete, you'll return to the task list."
              onDeleteOccurrence={() => deleteTaskMutation.mutate('occurrence')}
              onDeleteSeries={() => deleteTaskMutation.mutate('series')}
              onClose={() => setPendingDelete(null)}
            />
          </>
        )}

        {taskQuery.data && draft ? (
          <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40">
            <div
              className="mx-auto w-full max-w-md px-3"
              style={{ paddingBottom: 'max(var(--safe-area-bottom), 0.75rem)' }}
            >
              <div className="pointer-events-auto rounded-[1.8rem] bg-[rgba(20,20,20,0.9)] p-3 shadow-[0_24px_60px_rgba(0,0,0,0.6)] backdrop-blur-xl">
                <p className="px-1 pb-3 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-on-surface-variant">
                  {isEditMode
                    ? 'Save writes your changes and closes this detail view.'
                    : 'Edit unlocks every field. Delete asks before it removes this task.'}
                </p>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => {
                      void returnToTasks(false)
                    }}
                    className="flex items-start justify-start gap-2 rounded-pill border border-white/10 bg-white/5 px-3 py-3 text-left text-sm font-medium text-on-surface transition hover:bg-white/10"
                  >
                    <span aria-hidden="true" className="pt-0.5 text-base leading-none">
                      ←
                    </span>
                    <span className="leading-tight">Back to tasks</span>
                  </button>

                  {isEditMode ? (
                    <button
                      type="button"
                      onClick={() => saveTaskMutation.mutate()}
                      disabled={isBusy}
                      className="rounded-pill bg-[radial-gradient(circle_at_top,_#c4b5fd_10%,_#7c3aed_90%)] px-4 py-3 text-sm font-semibold text-white shadow-[0_8px_0_#4c1d95,_0_16px_22px_rgba(0,0,0,0.35),_inset_0_2px_3px_rgba(255,255,255,0.38)] transition-all hover:-translate-y-[1px] active:translate-y-[4px] active:shadow-[0_0px_0_#4c1d95,_0_4px_10px_rgba(0,0,0,0.35),_inset_0_2px_4px_rgba(0,0,0,0.18)] disabled:opacity-50 disabled:hover:translate-y-0 disabled:active:translate-y-0"
                    >
                      Save and return
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setIsEditMode(true)}
                      className="rounded-pill bg-[radial-gradient(circle_at_top,_rgba(196,181,253,0.32),_rgba(124,58,237,0.92)_88%)] px-4 py-3 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(76,29,149,0.32),_inset_0_1px_2px_rgba(255,255,255,0.32)] transition-transform hover:-translate-y-[1px] active:translate-y-[1px]"
                    >
                      Edit task
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={handleDeleteTask}
                    disabled={isBusy}
                    className="col-span-2 rounded-pill border border-tertiary/35 bg-tertiary/10 px-4 py-3 text-sm font-medium text-tertiary transition hover:bg-tertiary/15 disabled:opacity-50 sm:col-span-1"
                  >
                    Delete task
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </section>
      </PullToRefresh>
    </SessionGuard>
  )
}
