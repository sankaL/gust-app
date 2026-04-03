import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'

import {
  ApiError,
  getSessionStatus,
  listAllTasks,
  listGroups,
  listTasks,
  reopenTask,
  type SessionStatus,
  type TaskSummary
} from '../lib/api'
import {
  adjustGroupOpenCount,
  applyTaskListMutation,
  prependTaskToMatchingLists,
  restoreQuerySnapshots,
  snapshotTaskQueries,
  updateTaskDetailCache,
} from '../lib/taskQueryCache'
import { useNotifications } from '../components/Notifications'
import { SessionGuard } from '../components/SessionGuard'

function buildFriendlyMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message
  }

  return fallback
}

function buildCompletedLabel(task: TaskSummary) {
  if (!task.completed_at) {
    return 'Completed'
  }

  const value = new Date(task.completed_at)
  return `Completed ${new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(value)}`
}

function dedupeCompletedTasks(tasks: TaskSummary[]) {
  const seen = new Set<string>()
  const result: TaskSummary[] = []

  for (const task of tasks) {
    const completedSecond = task.completed_at ? task.completed_at.slice(0, 19) : 'none'
    const normalizedTitle = task.title.trim().toLowerCase()
    const dueValue = task.due_date ?? 'none'
    const candidateKeys = [`task:${task.id}`]

    if (task.series_id) {
      candidateKeys.push(`series:${task.series_id}|second:${completedSecond}`)
    } else if (task.recurrence_frequency) {
      candidateKeys.push(
        `recurrence:${normalizedTitle}|group:${task.group.id}|due:${dueValue}|second:${completedSecond}`
      )
    }

    if (task.completed_at && !task.series_id && !task.recurrence_frequency) {
      candidateKeys.push(
        `legacy:${normalizedTitle}|group:${task.group.id}|due:${dueValue}|second:${completedSecond}`
      )
    }

    if (candidateKeys.some((key) => seen.has(key))) {
      continue
    }
    candidateKeys.forEach((key) => seen.add(key))
    result.push(task)
  }

  return result
}

export function CompletedTasksRoute() {
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [pendingTaskIds, setPendingTaskIds] = useState<string[]>([])
  const { notifyError, notifySuccess } = useNotifications()

  const sessionQuery = useQuery({
    queryKey: ['session-status'],
    queryFn: getSessionStatus,
    retry: false,
  })

  const groupsQuery = useQuery({
    queryKey: ['groups'],
    queryFn: listGroups,
    enabled: sessionQuery.data?.signed_in === true
  })

  const selectedGroupId = searchParams.get('group')
  const isAllGroupsView = selectedGroupId === 'all'
  const resolvedGroupId = isAllGroupsView
    ? null
    : selectedGroupId ?? sessionQuery.data?.inbox_group_id ?? groupsQuery.data?.[0]?.id ?? null

  useEffect(() => {
    if (!sessionQuery.data?.signed_in || !groupsQuery.data?.length || selectedGroupId) {
      return
    }

    const nextGroupId = sessionQuery.data.inbox_group_id ?? groupsQuery.data[0].id
    setSearchParams({ group: nextGroupId }, { replace: true })
  }, [groupsQuery.data, selectedGroupId, sessionQuery.data, setSearchParams])

  const completedTasksQuery = useQuery({
    queryKey: ['tasks', isAllGroupsView ? 'all' : resolvedGroupId, 'completed'],
    queryFn: () =>
      isAllGroupsView ? listAllTasks('completed') : listTasks(resolvedGroupId as string, 'completed'),
    enabled:
      sessionQuery.data?.signed_in === true && (isAllGroupsView || Boolean(resolvedGroupId))
  })

  function requireCsrf(session: SessionStatus | undefined) {
    const csrfToken = session?.csrf_token
    if (!csrfToken) {
      throw new ApiError('Your session is missing a CSRF token.', 'csrf_missing', 403)
    }
    return csrfToken
  }

  async function refreshTaskData() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['groups'] }),
      queryClient.invalidateQueries({ queryKey: ['tasks', resolvedGroupId ?? 'all', 'completed'] }),
      queryClient.invalidateQueries({ queryKey: ['tasks', resolvedGroupId ?? 'all', 'open'] }),
      queryClient.invalidateQueries({ queryKey: ['tasks', 'all', 'completed'] }),
      queryClient.invalidateQueries({ queryKey: ['tasks', 'all', 'open'] })
    ])
  }

  function markTaskPending(taskId: string, isPending: boolean) {
    setPendingTaskIds((current) => {
      if (isPending) {
        return current.includes(taskId) ? current : [...current, taskId]
      }
      return current.filter((candidate) => candidate !== taskId)
    })
  }

  const reopenMutation = useMutation({
    onMutate: async (task) => {
      markTaskPending(task.id, true)
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ['groups'] }),
        queryClient.cancelQueries({ queryKey: ['tasks'] }),
        queryClient.cancelQueries({ queryKey: ['task-detail', task.id] }),
      ])
      const snapshots = snapshotTaskQueries(queryClient, task.id)
      const optimisticTask: TaskSummary = {
        ...task,
        status: 'open',
        completed_at: null,
      }

      applyTaskListMutation(queryClient, (currentTask, statusSegment) => {
        if (currentTask.id !== task.id) {
          return currentTask
        }
        return statusSegment === 'open' ? optimisticTask : null
      })
      prependTaskToMatchingLists(queryClient, optimisticTask, 'open')
      adjustGroupOpenCount(queryClient, task.group.id, 1)
      updateTaskDetailCache(queryClient, optimisticTask)

      return { snapshots }
    },
    mutationFn: async (task: TaskSummary) => {
      const csrfToken = requireCsrf(sessionQuery.data)
      return reopenTask(task.id, csrfToken)
    },
    onSuccess: (task) => {
      applyTaskListMutation(queryClient, (currentTask, statusSegment) => {
        if (currentTask.id !== task.id) {
          return currentTask
        }
        return statusSegment === 'open' ? { ...currentTask, ...task } : null
      })
      prependTaskToMatchingLists(queryClient, task, 'open')
      updateTaskDetailCache(queryClient, task)
      notifySuccess(`Moved ${task.title} back to To-do.`)
      void refreshTaskData()
    },
    onError: (error, task, context) => {
      if (context?.snapshots) {
        restoreQuerySnapshots(queryClient, context.snapshots)
      }
      markTaskPending(task.id, false)
      notifyError(buildFriendlyMessage(error, 'Task could not be moved back to To-do.'))
    },
    onSettled: (_result, _error, task) => {
      markTaskPending(task.id, false)
    }
  })


  const rawCompletedItems = Array.isArray(completedTasksQuery.data)
    ? completedTasksQuery.data
    : completedTasksQuery.data?.items ?? []
  const visibleCompletedTasks = dedupeCompletedTasks(rawCompletedItems)

  return (
    <SessionGuard
      session={sessionQuery.data}
      isLoading={sessionQuery.isLoading}
      isError={sessionQuery.isError}
      title="Completed Tasks"
      eyebrow="Completed history"
      description={
        isAllGroupsView
          ? 'Review completed tasks across every group and move them back to To-do when needed.'
          : 'Review completed tasks and move them back to To-do when needed.'
      }
    >
      <section className="space-y-4">
        {completedTasksQuery.isLoading ? (
          <div className="rounded-card bg-surface-container p-6 text-sm text-on-surface-variant">
            Loading completed tasks.
          </div>
        ) : null}

        {completedTasksQuery.data && visibleCompletedTasks.length === 0 ? (
          <div className="rounded-soft bg-surface-container p-6 shadow-ambient">
            <p className="font-display text-2xl text-on-surface">No completed tasks here</p>
            <p className="mt-3 font-body text-sm leading-6 text-on-surface-variant">
              Complete tasks from the open list, then review them here.
            </p>
          </div>
        ) : null}

        <div className="space-y-3">
          {visibleCompletedTasks.map((task) => (
            <article key={task.id} className="rounded-card bg-surface-container-high border border-white/5 p-4 flex flex-col gap-4">
              <div className="flex items-stretch justify-between gap-4">
                <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                  <div className="flex flex-col gap-1.5 align-top">
                    <h3 className="font-display text-lg font-medium text-on-surface truncate leading-tight">
                      {task.title}
                    </h3>
                    <p className="font-body text-xs text-on-surface-variant/80 font-medium">
                      {task.group?.name || 'Inbox'}
                    </p>
                  </div>
                  <div className="mt-4">
                    <span className="text-tertiary uppercase tracking-wider text-[0.65rem] font-bold">
                      {buildCompletedLabel(task)}
                    </span>
                  </div>
                </div>
                
                <div className="flex flex-col items-end justify-between gap-4 shrink-0 px-2">
                  <div className="flex items-center gap-2">
                    {task.recurrence_frequency && (
                      <span className="recurrence-badge shrink-0">
                        {task.recurrence_frequency.toUpperCase()}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      type="button"
                      onClick={() => reopenMutation.mutate(task)}
                      disabled={pendingTaskIds.includes(task.id)}
                      className="rounded-pill bg-surface-dim px-3 py-1.5 font-body text-[0.65rem] font-bold uppercase tracking-widest text-on-surface-variant shadow-[0_4px_12px_rgba(0,0,0,0.5),_inset_0_2px_4px_rgba(255,255,255,0.1)] hover:-translate-y-0.5 transition-all active:scale-95 disabled:opacity-50 disabled:hover:-translate-y-0 disabled:active:scale-100"
                    >
                      Restore
                    </button>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </SessionGuard>
  )
}
