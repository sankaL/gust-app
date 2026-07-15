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
import { refreshTaskScreenQueries } from '../lib/taskScreenCache'
import { acquireTaskMutationLock } from '../lib/taskMutationLocks'
import { requireCsrfToken } from '../lib/sessionSecurity'

type CompleteVariables = { task: TaskSummary; releaseLock: () => void }
type MoveDueDateVariables = { task: TaskSummary; dueDate: string | null; releaseLock: () => void }

function buildFriendlyMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message
  }
  return fallback
}

export function useDesktopTaskActions(session: SessionStatus | undefined) {
  const queryClient = useQueryClient()
  const { notifyError, notifySuccess } = useNotifications()

  function acquireLock(task: TaskSummary) {
    const releaseLock = acquireTaskMutationLock(task.id)
    if (!releaseLock) {
      notifyError('Task is already updating.')
      return null
    }
    return releaseLock
  }

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

  async function prepareStatusMutation(
    task: TaskSummary,
    status: TaskSummary['status'],
    completedAt: string | null,
    openCountDelta: number
  ) {
    await Promise.all([
      queryClient.cancelQueries({ queryKey: ['tasks'] }),
      queryClient.cancelQueries({ queryKey: ['desktop', 'tasks'] }),
      queryClient.cancelQueries({ queryKey: ['groups'] }),
      queryClient.cancelQueries({ queryKey: ['task-detail', task.id] }),
    ])
    const snapshots = snapshotTaskQueries(queryClient, task.id)
    syncTaskCaches({ ...task, status, completed_at: completedAt })
    adjustGroupOpenCount(queryClient, task.group.id, openCountDelta)
    return { snapshots }
  }

  const completeMutation = useMutation({
    onMutate: async ({ task }: CompleteVariables) =>
      prepareStatusMutation(task, 'completed', new Date().toISOString(), -1),
    mutationFn: async ({ task }: CompleteVariables) => completeTask(task.id, requireCsrfToken(session)),
    onSuccess: (task) => {
      syncTaskCaches(task)
      notifySuccess(`Completed ${task.title}.`)
      void refreshDesktopTaskData(task)
    },
    onError: (error, variables, context) => {
      if (context?.snapshots) {
        restoreQuerySnapshots(queryClient, context.snapshots)
      }
      notifyError(buildFriendlyMessage(error, `Could not complete ${variables.task.title}.`))
    },
    onSettled: (_data, _error, variables) => {
      variables.releaseLock()
    },
  })

  const reopenMutation = useMutation({
    onMutate: async ({ task }: CompleteVariables) => prepareStatusMutation(task, 'open', null, 1),
    mutationFn: async ({ task }: CompleteVariables) => reopenTask(task.id, requireCsrfToken(session)),
    onSuccess: (task) => {
      syncTaskCaches(task)
      notifySuccess(`Moved ${task.title} back to To-do.`)
      void refreshDesktopTaskData(task)
    },
    onError: (error, variables, context) => {
      if (context?.snapshots) {
        restoreQuerySnapshots(queryClient, context.snapshots)
      }
      notifyError(buildFriendlyMessage(error, `Could not restore ${variables.task.title}.`))
    },
    onSettled: (_data, _error, variables) => {
      variables.releaseLock()
    },
  })

  const moveDueDateMutation = useMutation({
    onMutate: async ({ task, dueDate }: MoveDueDateVariables) => {
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ['tasks'] }),
        queryClient.cancelQueries({ queryKey: ['desktop', 'tasks'] }),
        queryClient.cancelQueries({ queryKey: ['task-detail', task.id] }),
      ])
      const snapshots = snapshotTaskQueries(queryClient, task.id)
      const optimisticTask: TaskSummary = {
        ...task,
        due_date: dueDate,
        reminder_at: dueDate ? task.reminder_at : null,
        recurrence_frequency: dueDate ? task.recurrence_frequency : null,
      }
      applyTaskListMutation(queryClient, (currentTask, statusSegment) => {
        if (currentTask.id !== task.id) {
          return currentTask
        }
        return statusSegment === task.status ? { ...currentTask, ...optimisticTask } : null
      })
      const currentDetail = queryClient.getQueryData<TaskDetail>(['task-detail', task.id])
      if (currentDetail) {
        updateTaskDetailCache(queryClient, {
          ...currentDetail,
          due_date: dueDate,
          reminder_at: dueDate ? currentDetail.reminder_at : null,
          recurrence: dueDate ? currentDetail.recurrence : null,
          recurrence_frequency: dueDate ? currentDetail.recurrence_frequency : null,
        })
      }
      return { snapshots }
    },
    mutationFn: async ({ task, dueDate }: MoveDueDateVariables) => {
      const detail = await queryClient.fetchQuery({
        queryKey: ['task-detail', task.id],
        queryFn: () => getTaskDetail(task.id),
        staleTime: 0,
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
        requireCsrfToken(session)
      )
    },
    onSuccess: (task) => {
      syncTaskCaches(task)
      notifySuccess('Task date updated.')
      void refreshDesktopTaskData(task)
    },
    onError: (error, _variables, context) => {
      if (context?.snapshots) {
        restoreQuerySnapshots(queryClient, context.snapshots)
      }
      notifyError(buildFriendlyMessage(error, 'Task date could not be updated.'))
    },
    onSettled: (_data, _error, variables) => {
      variables.releaseLock()
    },
  })

  return {
    completeTask: (task: TaskSummary) => {
      const releaseLock = acquireLock(task)
      if (!releaseLock) return
      completeMutation.mutate({ task, releaseLock })
    },
    reopenTask: (task: TaskSummary) => {
      const releaseLock = acquireLock(task)
      if (!releaseLock) return
      reopenMutation.mutate({ task, releaseLock })
    },
    moveTaskDueDate: (task: TaskSummary, dueDate: string | null) => {
      const releaseLock = acquireLock(task)
      if (!releaseLock) return
      moveDueDateMutation.mutate({ task, dueDate, releaseLock })
    },
    busyTaskIds: [
      completeMutation.variables?.task.id,
      reopenMutation.variables?.task.id,
      moveDueDateMutation.variables?.task.id,
    ].filter(Boolean) as string[],
    isBusy:
      completeMutation.isPending || reopenMutation.isPending || moveDueDateMutation.isPending,
  }
}
