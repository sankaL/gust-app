import { useMutation, useQueryClient } from '@tanstack/react-query'

import { useNotifications } from '../components/Notifications'
import {
  ApiError,
  completeTask,
  getTaskDetail,
  reopenTask,
  updateTask,
  type SessionStatus,
  type TaskDetail,
  type TaskSummary,
} from '../lib/api'
import {
  adjustGroupOpenCount,
  applyTaskListMutation,
  prependTaskToMatchingLists,
  restoreQuerySnapshots,
  snapshotTaskQueries,
  updateTaskDetailCache,
} from '../lib/taskQueryCache'
import { refreshTaskScreenQueries, TASK_SCREEN_GC_TIME_MS, TASK_SCREEN_STALE_TIME_MS } from '../lib/taskScreenCache'

function buildFriendlyMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message
  }
  return fallback
}

function requireCsrf(session: SessionStatus | undefined) {
  const csrfToken = session?.csrf_token
  if (!csrfToken) {
    throw new ApiError('Your session is missing a CSRF token.', 'csrf_missing', 403)
  }
  return csrfToken
}

export function useDesktopTaskActions(session: SessionStatus | undefined) {
  const queryClient = useQueryClient()
  const { notifyError, notifySuccess } = useNotifications()

  function syncTaskCaches(task: TaskSummary | TaskDetail) {
    applyTaskListMutation(queryClient, (currentTask, statusSegment) => {
      if (currentTask.id !== task.id) {
        return currentTask
      }
      return statusSegment === task.status ? { ...currentTask, ...task } : null
    })
    prependTaskToMatchingLists(queryClient, task, task.status)
    updateTaskDetailCache(queryClient, task)
  }

  async function refreshDesktopTaskData(task: TaskSummary | TaskDetail) {
    await refreshTaskScreenQueries(queryClient, {
      taskId: task.id,
      groupIds: [task.group.id],
      statuses: ['open', 'completed'],
      includeAllOpen: true,
      includeAllCompleted: true,
      includeGroupedTaskLists: true,
      includeTaskDetails: true,
    })
  }

  const completeMutation = useMutation({
    onMutate: async (task: TaskSummary) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ['tasks'] }),
        queryClient.cancelQueries({ queryKey: ['groups'] }),
        queryClient.cancelQueries({ queryKey: ['task-detail', task.id] }),
      ])
      const snapshots = snapshotTaskQueries(queryClient, task.id)
      const optimisticTask: TaskSummary = {
        ...task,
        status: 'completed',
        completed_at: new Date().toISOString(),
      }
      syncTaskCaches(optimisticTask)
      adjustGroupOpenCount(queryClient, task.group.id, -1)
      return { snapshots }
    },
    mutationFn: async (task: TaskSummary) => completeTask(task.id, requireCsrf(session)),
    onSuccess: (task) => {
      syncTaskCaches(task)
      notifySuccess(`Completed ${task.title}.`)
      void refreshDesktopTaskData(task)
    },
    onError: (error, task, context) => {
      if (context?.snapshots) {
        restoreQuerySnapshots(queryClient, context.snapshots)
      }
      notifyError(buildFriendlyMessage(error, `Could not complete ${task.title}.`))
    },
  })

  const reopenMutation = useMutation({
    onMutate: async (task: TaskSummary) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ['tasks'] }),
        queryClient.cancelQueries({ queryKey: ['groups'] }),
        queryClient.cancelQueries({ queryKey: ['task-detail', task.id] }),
      ])
      const snapshots = snapshotTaskQueries(queryClient, task.id)
      const optimisticTask: TaskSummary = {
        ...task,
        status: 'open',
        completed_at: null,
      }
      syncTaskCaches(optimisticTask)
      adjustGroupOpenCount(queryClient, task.group.id, 1)
      return { snapshots }
    },
    mutationFn: async (task: TaskSummary) => reopenTask(task.id, requireCsrf(session)),
    onSuccess: (task) => {
      syncTaskCaches(task)
      notifySuccess(`Moved ${task.title} back to To-do.`)
      void refreshDesktopTaskData(task)
    },
    onError: (error, task, context) => {
      if (context?.snapshots) {
        restoreQuerySnapshots(queryClient, context.snapshots)
      }
      notifyError(buildFriendlyMessage(error, `Could not restore ${task.title}.`))
    },
  })

  const moveDueDateMutation = useMutation({
    mutationFn: async ({ task, dueDate }: { task: TaskSummary; dueDate: string | null }) => {
      const detail = await queryClient.ensureQueryData({
        queryKey: ['task-detail', task.id],
        queryFn: () => getTaskDetail(task.id),
        staleTime: TASK_SCREEN_STALE_TIME_MS,
        gcTime: TASK_SCREEN_GC_TIME_MS,
      })

      return updateTask(
        task.id,
        {
          title: detail.title,
          description: detail.description,
          group_id: detail.group.id,
          due_date: dueDate,
          reminder_at: dueDate ? detail.reminder_at : null,
          recurrence: dueDate ? detail.recurrence : null,
        },
        requireCsrf(session)
      )
    },
    onSuccess: (task) => {
      syncTaskCaches(task)
      notifySuccess('Task date updated.')
      void refreshDesktopTaskData(task)
    },
    onError: (error) => {
      notifyError(buildFriendlyMessage(error, 'Task date could not be updated.'))
    },
  })

  return {
    completeTask: (task: TaskSummary) => completeMutation.mutate(task),
    reopenTask: (task: TaskSummary) => reopenMutation.mutate(task),
    moveTaskDueDate: (task: TaskSummary, dueDate: string | null) =>
      moveDueDateMutation.mutate({ task, dueDate }),
    busyTaskIds: [
      completeMutation.variables?.id,
      reopenMutation.variables?.id,
      moveDueDateMutation.variables?.task.id,
    ].filter(Boolean) as string[],
    isBusy:
      completeMutation.isPending || reopenMutation.isPending || moveDueDateMutation.isPending,
  }
}
