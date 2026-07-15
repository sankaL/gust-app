import { useCallback, useEffect, useState } from 'react'
import { RotateCcw } from 'lucide-react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import {
  ApiError,
  getSessionStatus,
  listAllTasks,
  listGroups,
  listTasks,
  reopenTask,
  type TaskSummary
} from '../lib/api'
import {
  applyTaskListMutation,
  prependTaskToMatchingLists,
  prepareOptimisticTaskStatus,
  restoreQuerySnapshots,
  updateTaskDetailCache,
} from '../lib/taskQueryCache'
import { useNotifications } from '../components/Notifications'
import { SessionGuard } from '../components/SessionGuard'
import { useAppShellActions } from '../components/AppShellActions'
import { PullToRefresh, TaskScreenRefreshButton } from '../components/TaskScreenRefresh'
import { TaskPreviewModal } from '../components/TaskPreviewModal'
import { TaskRestoreDialog } from '../components/TaskRestoreDialog'
import {
  refreshTaskScreenQueries,
  TASK_SCREEN_GC_TIME_MS,
  TASK_SCREEN_STALE_TIME_MS,
} from '../lib/taskScreenCache'
import { dedupeCompletedTasks } from '../lib/desktopData'
import { requireCsrfToken } from '../lib/sessionSecurity'
import { useTaskListRouteState } from '../hooks/useTaskListRouteState'

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
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(value)
}

export function CompletedTasksRoute() {
  const queryClient = useQueryClient()
  const shellActions = useAppShellActions()
  const {
    searchParams,
    setSearchParams,
    selectedTaskId,
    pendingTaskIds,
    markTaskPending,
    openTaskPreview,
    closeTaskPreview,
  } = useTaskListRouteState(queryClient)
  const [restoreCandidate, setRestoreCandidate] = useState<TaskSummary | null>(null)
  const { notifyError, notifySuccess } = useNotifications()

  const sessionQuery = useQuery({
    queryKey: ['session-status'],
    queryFn: getSessionStatus,
    retry: false,
  })

  const groupsQuery = useQuery({
    queryKey: ['groups'],
    queryFn: listGroups,
    enabled: sessionQuery.data?.signed_in === true,
    staleTime: TASK_SCREEN_STALE_TIME_MS,
    gcTime: TASK_SCREEN_GC_TIME_MS,
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
    const next = new URLSearchParams(searchParams)
    next.set('group', nextGroupId)
    setSearchParams(next, { replace: true })
  }, [groupsQuery.data, searchParams, selectedGroupId, sessionQuery.data, setSearchParams])

  const completedTasksQuery = useQuery({
    queryKey: ['tasks', isAllGroupsView ? 'all' : resolvedGroupId, 'completed'],
    queryFn: () =>
      isAllGroupsView ? listAllTasks('completed') : listTasks(resolvedGroupId as string, 'completed'),
    enabled:
      sessionQuery.data?.signed_in === true && (isAllGroupsView || Boolean(resolvedGroupId)),
    staleTime: TASK_SCREEN_STALE_TIME_MS,
    gcTime: TASK_SCREEN_GC_TIME_MS,
  })

  const refreshCompletedTasks = useCallback(
    () =>
      refreshTaskScreenQueries(queryClient, {
        groupIds: [resolvedGroupId],
        statuses: ['completed'],
        includeAllOpen: true,
        includeAllCompleted: true,
      }),
    [queryClient, resolvedGroupId]
  )
  const isRefreshingCompletedTasks =
    (completedTasksQuery.isFetching && !completedTasksQuery.isLoading) ||
    (groupsQuery.isFetching && !groupsQuery.isLoading)

  useEffect(() => {
    shellActions?.setTopBarAction(
      <TaskScreenRefreshButton
        isRefreshing={isRefreshingCompletedTasks}
        label="Refresh completed tasks"
        onRefresh={refreshCompletedTasks}
      />
    )

    return () => {
      shellActions?.setTopBarAction(null)
    }
  }, [isRefreshingCompletedTasks, refreshCompletedTasks, shellActions])

  async function refreshTaskData() {
    await refreshCompletedTasks()
  }

  function requestRestore(task: TaskSummary) {
    setRestoreCandidate(task)
  }

  function confirmRestore() {
    if (!restoreCandidate || reopenMutation.isPending) {
      return
    }

    reopenMutation.mutate(restoreCandidate)
  }

  const reopenMutation = useMutation({
    onMutate: async (task) => {
      markTaskPending(task.id, true)
      return prepareOptimisticTaskStatus(queryClient, task, 'open', null)
    },
    mutationFn: async (task: TaskSummary) => {
      const csrfToken = requireCsrfToken(sessionQuery.data)
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
      setRestoreCandidate(null)
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
      <PullToRefresh isRefreshing={isRefreshingCompletedTasks} onRefresh={refreshCompletedTasks}>
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

        <div className="space-y-2">
          {visibleCompletedTasks.map((task) => (
            <article
              key={task.id}
              role="button"
              tabIndex={0}
              onClick={() => openTaskPreview(task.id)}
              onKeyDown={(event) => {
                if (event.key === 'Enter' || event.key === ' ') {
                  event.preventDefault()
                  openTaskPreview(task.id)
                }
              }}
              className="rounded-card bg-surface-container-high px-3 py-2.5 transition hover:bg-surface-container-highest/80 active:scale-[0.99]"
            >
              <div className="flex min-w-0 items-center gap-3">
                <div className="min-w-0 flex-1">
                  <h3
                    className="min-w-0 truncate pr-1 font-display text-[0.98rem] font-medium leading-tight text-on-surface"
                    title={task.title}
                  >
                    {task.title}
                  </h3>

                  <div className="mt-1 flex min-w-0 flex-nowrap items-center gap-1.5 overflow-hidden font-body text-[0.62rem] uppercase tracking-[0.12em] text-on-surface-variant">
                    <span className="min-w-0 max-w-[36%] shrink truncate font-medium text-on-surface-variant/85">
                      {task.group?.name || 'Inbox'}
                    </span>
                    <span className="shrink-0 text-on-surface-variant/35">•</span>
                    <span className="min-w-0 shrink truncate font-bold text-tertiary">
                      {buildCompletedLabel(task)}
                    </span>
                    {task.recurrence_frequency ? (
                      <span
                        className="recurrence-badge shrink-0"
                        title={`Recurring: ${task.recurrence_frequency}`}
                      >
                        {task.recurrence_frequency.toUpperCase()}
                      </span>
                    ) : null}
                  </div>
                </div>

                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    requestRestore(task)
                  }}
                  disabled={pendingTaskIds.includes(task.id)}
                  className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-dim text-on-surface-variant shadow-[0_4px_12px_rgba(0,0,0,0.5),_inset_0_2px_4px_rgba(255,255,255,0.1)] transition-all hover:-translate-y-0.5 hover:bg-surface-container-highest hover:text-on-surface active:translate-y-0 active:scale-95 disabled:opacity-50 disabled:hover:-translate-y-0 disabled:active:scale-100"
                  aria-label={`Restore ${task.title}`}
                  title="Restore"
                >
                  <RotateCcw className="h-4 w-4" strokeWidth={2} />
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
      </PullToRefresh>

      <TaskPreviewModal
        taskId={selectedTaskId}
        isOpen={Boolean(selectedTaskId)}
        onClose={closeTaskPreview}
        onRestore={(task) => {
          requestRestore(task)
          closeTaskPreview()
        }}
        busyTaskIds={pendingTaskIds}
        session={sessionQuery.data}
        groups={groupsQuery.data ?? []}
      />
      <TaskRestoreDialog
        isOpen={restoreCandidate !== null}
        taskTitle={restoreCandidate?.title ?? ''}
        isRestoring={
          reopenMutation.isPending ||
          (restoreCandidate ? pendingTaskIds.includes(restoreCandidate.id) : false)
        }
        onRestore={confirmRestore}
        onClose={() => setRestoreCandidate(null)}
      />
    </SessionGuard>
  )
}
