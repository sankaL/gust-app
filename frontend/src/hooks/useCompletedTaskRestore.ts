import { useState } from 'react'
import { useMutation, type QueryClient } from '@tanstack/react-query'

import { ApiError, reopenTask, type SessionStatus, type TaskSummary } from '../lib/api'
import {
  applyTaskListMutation,
  prependTaskToMatchingLists,
  prepareOptimisticTaskStatus,
  restoreQuerySnapshots,
  updateTaskDetailCache,
} from '../lib/taskQueryCache'
import { requireCsrfToken } from '../lib/sessionSecurity'

function friendlyError(error: unknown) {
  return error instanceof ApiError ? error.message : 'Task could not be moved back to To-do.'
}

function syncReopenedTask(queryClient: QueryClient, task: TaskSummary) {
  applyTaskListMutation(queryClient, (currentTask, status) => {
    if (currentTask.id !== task.id) return currentTask
    return status === 'open' ? { ...currentTask, ...task } : null
  })
  prependTaskToMatchingLists(queryClient, task, 'open')
  updateTaskDetailCache(queryClient, task)
}

export function useCompletedTaskRestore({
  queryClient,
  session,
  markTaskPending,
  onSuccess,
  onError,
  refresh,
}: {
  queryClient: QueryClient
  session: SessionStatus | undefined
  markTaskPending: (taskId: string, isPending: boolean) => void
  onSuccess: (message: string) => void
  onError: (message: string) => void
  refresh: () => Promise<void>
}) {
  const [candidate, setCandidate] = useState<TaskSummary | null>(null)
  const mutation = useMutation({
    onMutate: async (task: TaskSummary) => {
      markTaskPending(task.id, true)
      return prepareOptimisticTaskStatus(queryClient, task, 'open', null)
    },
    mutationFn: (task: TaskSummary) => reopenTask(task.id, requireCsrfToken(session)),
    onSuccess: (task) => {
      syncReopenedTask(queryClient, task)
      setCandidate(null)
      onSuccess(`Moved ${task.title} back to To-do.`)
      void refresh()
    },
    onError: (error, task, context) => {
      if (context?.snapshots) restoreQuerySnapshots(queryClient, context.snapshots)
      markTaskPending(task.id, false)
      onError(friendlyError(error))
    },
    onSettled: (_result, _error, task) => markTaskPending(task.id, false),
  })

  function confirm() {
    if (candidate && !mutation.isPending) mutation.mutate(candidate)
  }

  return {
    candidate,
    request: setCandidate,
    cancel: () => setCandidate(null),
    confirm,
    isPending: mutation.isPending,
  }
}
