import { useState } from 'react'
import type { QueryClient } from '@tanstack/react-query'
import { useSearchParams } from 'react-router-dom'

import { getTaskDetail } from '../lib/api'
import { TASK_SCREEN_GC_TIME_MS, TASK_SCREEN_STALE_TIME_MS } from '../lib/taskScreenCache'

export function useTaskListRouteState(queryClient: QueryClient) {
  const [searchParams, setSearchParams] = useSearchParams()
  const [pendingTaskIds, setPendingTaskIds] = useState<string[]>([])

  function markTaskPending(taskId: string, isPending: boolean) {
    setPendingTaskIds((current) => {
      if (isPending) return current.includes(taskId) ? current : [...current, taskId]
      return current.filter((candidate) => candidate !== taskId)
    })
  }

  function prefetchTaskDetail(taskId: string) {
    void queryClient.prefetchQuery({
      queryKey: ['task-detail', taskId],
      queryFn: () => getTaskDetail(taskId),
      staleTime: TASK_SCREEN_STALE_TIME_MS,
      gcTime: TASK_SCREEN_GC_TIME_MS,
    })
  }

  function openTaskPreview(taskId: string) {
    prefetchTaskDetail(taskId)
    const next = new URLSearchParams(searchParams)
    next.set('task', taskId)
    setSearchParams(next)
  }

  function closeTaskPreview() {
    const next = new URLSearchParams(searchParams)
    next.delete('task')
    setSearchParams(next, { replace: true })
  }

  return {
    searchParams,
    setSearchParams,
    selectedTaskId: searchParams.get('task'),
    pendingTaskIds,
    markTaskPending,
    prefetchTaskDetail,
    openTaskPreview,
    closeTaskPreview,
  }
}
