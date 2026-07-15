import { useMutation, type QueryClient } from '@tanstack/react-query'

import {
  ApiError,
  completeTask,
  deleteTask,
  reopenTask,
  restoreTask,
  type SessionStatus,
  type TaskDeleteScope,
  type TaskSummary,
} from '../lib/api'
import {
  adjustGroupOpenCount,
  applyTaskListMutation,
  prependTaskToMatchingLists,
  prepareOptimisticTaskStatus,
  restoreQuerySnapshots,
  snapshotTaskQueries,
  updateTaskDetailCache,
} from '../lib/taskQueryCache'
import { refreshTaskScreenQueries, type TaskStatusSegment } from '../lib/taskScreenCache'
import { requireCsrfToken } from '../lib/sessionSecurity'

type Notifications = {
  dismiss: (id: string) => void
  error: (message: string) => unknown
  success: (message: string) => unknown
  show: (input: {
    type: 'success' | 'warning'
    message: string
    actionLabel: string
    onAction: () => Promise<void>
  }) => string
  update: (id: string, input: Record<string, unknown>) => void
}

function friendlyError(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback
}

function syncTaskCaches(queryClient: QueryClient, task: TaskSummary) {
  applyTaskListMutation(queryClient, (currentTask, status) => {
    if (currentTask.id !== task.id) return currentTask
    if (task.deleted_at) return null
    return status === task.status ? { ...currentTask, ...task } : null
  })
  if (!task.deleted_at) prependTaskToMatchingLists(queryClient, task, task.status)
  updateTaskDetailCache(queryClient, task)
}

async function refreshTaskViews(
  queryClient: QueryClient,
  taskId: string,
  groupId: string,
  statusesOrRefreshOpen: TaskStatusSegment[] | boolean
) {
  if (statusesOrRefreshOpen === false) {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['task-detail', taskId], refetchType: 'inactive' }),
      queryClient.invalidateQueries({ queryKey: ['groups'], refetchType: 'inactive' }),
    ])
    return
  }
  const statuses = statusesOrRefreshOpen === true ? ['open'] as TaskStatusSegment[] : statusesOrRefreshOpen
  await refreshTaskScreenQueries(queryClient, {
    taskId,
    groupIds: [groupId],
    statuses,
    includeAllOpen: true,
    includeAllCompleted: statuses.includes('completed'),
  })
}

function shouldRefreshOpenAfterDelete(scope: TaskDeleteScope, task: TaskSummary) {
  return scope === 'series' || (scope === 'occurrence' && Boolean(task.series_id || task.recurrence_frequency))
}

export function useOpenTaskActions({
  queryClient,
  session,
  markTaskPending,
  notifications,
  onDeleteFinished,
}: {
  queryClient: QueryClient
  session: SessionStatus | undefined
  markTaskPending: (taskId: string, pending: boolean) => void
  notifications: Notifications
  onDeleteFinished: () => void
}) {
  const completeMutation = useMutation({
    onMutate: async (task: TaskSummary) => {
      markTaskPending(task.id, true)
      return prepareOptimisticTaskStatus(queryClient, task, 'completed', new Date().toISOString())
    },
    mutationFn: (task: TaskSummary) => completeTask(task.id, requireCsrfToken(session)),
    onSuccess: (task) => {
      syncTaskCaches(queryClient, task)
      const notificationId = notifications.show({
        type: 'success',
        message: `Completed ${task.title}`,
        actionLabel: 'Undo',
        onAction: async () => {
          notifications.update(notificationId, { type: 'loading', message: `Undoing ${task.title}...`, actionLabel: undefined, onAction: undefined, dismissible: false, durationMs: null })
          try {
            const reopened = await reopenTask(task.id, requireCsrfToken(session))
            adjustGroupOpenCount(queryClient, reopened.group.id, 1)
            syncTaskCaches(queryClient, reopened)
            notifications.dismiss(notificationId)
            notifications.success(`Moved ${task.title} back to To-do.`)
            await refreshTaskViews(queryClient, task.id, task.group.id, ['open', 'completed'])
          } catch (error) {
            notifications.update(notificationId, { type: 'error', message: friendlyError(error, 'Undo failed.'), dismissible: true, durationMs: 3000 })
          }
        },
      })
      void refreshTaskViews(queryClient, task.id, task.group.id, ['open', 'completed'])
    },
    onError: (error, task, context) => {
      if (context?.snapshots) restoreQuerySnapshots(queryClient, context.snapshots)
      markTaskPending(task.id, false)
      notifications.error(friendlyError(error, 'Task could not be completed.'))
    },
    onSettled: (_result, _error, task) => markTaskPending(task.id, false),
  })

  const deleteMutation = useMutation({
    onMutate: async ({ task }: { task: TaskSummary; scope: TaskDeleteScope }) => {
      markTaskPending(task.id, true)
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ['groups'] }),
        queryClient.cancelQueries({ queryKey: ['tasks'] }),
        queryClient.cancelQueries({ queryKey: ['task-detail', task.id] }),
      ])
      const snapshots = snapshotTaskQueries(queryClient, task.id)
      applyTaskListMutation(queryClient, (currentTask) => currentTask.id === task.id ? null : currentTask)
      if (task.status === 'open') adjustGroupOpenCount(queryClient, task.group.id, -1)
      updateTaskDetailCache(queryClient, { ...task, deleted_at: new Date().toISOString() })
      return { snapshots }
    },
    mutationFn: ({ task, scope }: { task: TaskSummary; scope: TaskDeleteScope }) => deleteTask(task.id, requireCsrfToken(session), scope),
    onSuccess: (deletedTask, { task, scope }) => {
      syncTaskCaches(queryClient, deletedTask)
      onDeleteFinished()
      const shouldRefresh = shouldRefreshOpenAfterDelete(scope, task)
      const notificationId = notifications.show({
        type: 'warning',
        message: `Deleted ${task.title}`,
        actionLabel: 'Undo',
        onAction: async () => {
          notifications.update(notificationId, { type: 'loading', message: `Restoring ${task.title}...`, actionLabel: undefined, onAction: undefined, dismissible: false, durationMs: null })
          try {
            const restored = await restoreTask(task.id, requireCsrfToken(session))
            adjustGroupOpenCount(queryClient, restored.group.id, 1)
            syncTaskCaches(queryClient, restored)
            notifications.dismiss(notificationId)
            notifications.success(`Restored ${task.title}.`)
            await refreshTaskViews(queryClient, task.id, task.group.id, shouldRefresh)
          } catch (error) {
            notifications.update(notificationId, { type: 'error', message: friendlyError(error, 'Undo failed.'), dismissible: true, durationMs: 3000 })
          }
        },
      })
      void refreshTaskViews(queryClient, task.id, task.group.id, shouldRefresh)
    },
    onError: (error, { task }, context) => {
      if (context?.snapshots) restoreQuerySnapshots(queryClient, context.snapshots)
      markTaskPending(task.id, false)
      notifications.error(friendlyError(error, 'Task could not be deleted.'))
      onDeleteFinished()
    },
    onSettled: (_result, _error, { task }) => markTaskPending(task.id, false),
  })

  return {
    complete: (task: TaskSummary) => completeMutation.mutate(task),
    delete: (task: TaskSummary, scope: TaskDeleteScope) => deleteMutation.mutate({ task, scope }),
    isDeleting: deleteMutation.isPending,
  }
}
