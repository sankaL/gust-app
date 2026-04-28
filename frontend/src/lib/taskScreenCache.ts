import type { QueryClient, QueryKey } from '@tanstack/react-query'

export { TASK_SCREEN_GC_TIME_MS, TASK_SCREEN_STALE_TIME_MS } from './queryTuning'

export type TaskStatusSegment = 'open' | 'completed'

type RefreshTaskScreenQueriesOptions = {
  taskId?: string | null
  groupIds?: Array<string | null | undefined>
  statuses?: TaskStatusSegment[]
  includeAllOpen?: boolean
  includeAllCompleted?: boolean
  includeGroupedTaskLists?: boolean
  includeTaskDetails?: boolean
}

function addQueryKey(queryKeys: QueryKey[], nextKey: QueryKey) {
  if (queryKeys.some((queryKey) => JSON.stringify(queryKey) === JSON.stringify(nextKey))) {
    return
  }
  queryKeys.push(nextKey)
}

export async function refreshTaskScreenQueries(
  queryClient: QueryClient,
  {
    taskId = null,
    groupIds = [],
    statuses = ['open'],
    includeAllOpen = true,
    includeAllCompleted = false,
    includeGroupedTaskLists = false,
    includeTaskDetails = false,
  }: RefreshTaskScreenQueriesOptions = {}
) {
  const queryKeys: QueryKey[] = [['groups']]

  if (includeGroupedTaskLists) {
    addQueryKey(queryKeys, ['tasks'])
  }

  if (includeTaskDetails) {
    addQueryKey(queryKeys, ['task-detail'])
  }

  if (taskId) {
    addQueryKey(queryKeys, ['task-detail', taskId])
  }

  for (const groupId of groupIds) {
    if (!groupId || groupId === 'all') {
      continue
    }
    for (const status of statuses) {
      addQueryKey(queryKeys, ['tasks', groupId, status])
    }
  }

  if (includeAllOpen || statuses.includes('open')) {
    addQueryKey(queryKeys, ['tasks', 'all', 'open'])
  }

  if (includeAllCompleted || statuses.includes('completed')) {
    addQueryKey(queryKeys, ['tasks', 'all', 'completed'])
  }

  await Promise.all(
    queryKeys.map((queryKey) =>
      queryClient.invalidateQueries({
        queryKey,
        refetchType: 'active',
      })
    )
  )
}
