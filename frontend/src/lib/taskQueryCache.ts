import type { InfiniteData, QueryClient, QueryKey } from '@tanstack/react-query'

import type {
  GroupSummary,
  PaginatedTasksResponse,
  TaskDetail,
  TaskSummary,
} from './api'

type TaskListData = PaginatedTasksResponse | InfiniteData<PaginatedTasksResponse> | TaskSummary[]

type QuerySnapshot = {
  queryKey: QueryKey
  data: unknown
}

function getTaskListQueries(queryClient: QueryClient) {
  return [
    ...queryClient.getQueriesData<TaskListData>({ queryKey: ['tasks'] }),
    ...queryClient.getQueriesData<TaskListData>({ queryKey: ['desktop', 'tasks'] }),
  ]
}

function isPaginatedResponse(value: unknown): value is PaginatedTasksResponse {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'items' in value &&
      Array.isArray((value as PaginatedTasksResponse).items)
  )
}

function isInfiniteTaskData(value: unknown): value is InfiniteData<PaginatedTasksResponse> {
  return Boolean(
    value &&
      typeof value === 'object' &&
      'pages' in value &&
      Array.isArray((value as InfiniteData<PaginatedTasksResponse>).pages)
  )
}

function mapTaskListData(
  data: TaskListData | undefined,
  updater: (items: TaskSummary[]) => TaskSummary[]
): TaskListData | undefined {
  if (Array.isArray(data)) {
    return updater(data)
  }

  if (isPaginatedResponse(data)) {
    return {
      ...data,
      items: updater(data.items),
    }
  }

  if (isInfiniteTaskData(data)) {
    return {
      ...data,
      pages: data.pages.map((page) => ({
        ...page,
        items: updater(page.items),
      })),
    }
  }

  return data
}

function getTaskStatusSegment(queryKey: QueryKey): string | null {
  const status = queryKey[0] === 'desktop' ? queryKey[3] : queryKey[2]
  return typeof status === 'string' ? status : null
}

function getTaskScopeSegment(queryKey: QueryKey): unknown {
  return queryKey[0] === 'desktop' ? queryKey[2] : queryKey[1]
}

export function snapshotTaskQueries(
  queryClient: QueryClient,
  taskId?: string
): QuerySnapshot[] {
  const snapshots: QuerySnapshot[] = []
  for (const [queryKey, data] of queryClient.getQueriesData({ queryKey: ['tasks'] })) {
    snapshots.push({ queryKey, data })
  }
  for (const [queryKey, data] of queryClient.getQueriesData({ queryKey: ['desktop', 'tasks'] })) {
    snapshots.push({ queryKey, data })
  }
  for (const [queryKey, data] of queryClient.getQueriesData({ queryKey: ['groups'] })) {
    snapshots.push({ queryKey, data })
  }
  if (taskId) {
    snapshots.push({
      queryKey: ['task-detail', taskId],
      data: queryClient.getQueryData(['task-detail', taskId]),
    })
  }

  return snapshots
}

export function restoreQuerySnapshots(
  queryClient: QueryClient,
  snapshots: QuerySnapshot[]
): void {
  for (const snapshot of snapshots) {
    queryClient.setQueryData(snapshot.queryKey, snapshot.data)
  }
}

export function updateTaskDetailCache(queryClient: QueryClient, task: TaskDetail | TaskSummary): void {
  queryClient.setQueryData(['task-detail', task.id], (current: TaskDetail | undefined) => {
    if (current && !('subtasks' in task)) {
      return {
        ...current,
        ...task,
      }
    }

    if ('subtasks' in task) {
      return task
    }

    return current
  })
}

export function applyTaskListMutation(
  queryClient: QueryClient,
  updater: (task: TaskSummary, statusSegment: string | null, queryKey: QueryKey) => TaskSummary | null
): void {
  for (const [queryKey, data] of getTaskListQueries(queryClient)) {
    queryClient.setQueryData(queryKey, (current: TaskListData | undefined) =>
      mapTaskListData(current ?? data ?? undefined, (items) =>
        items.flatMap((task) => {
          const next = updater(task, getTaskStatusSegment(queryKey), queryKey)
          return next ? [next] : []
        })
      )
    )
  }
}

export function prependTaskToMatchingLists(
  queryClient: QueryClient,
  task: TaskSummary,
  statusValue: 'open' | 'completed'
): void {
  for (const [queryKey, data] of getTaskListQueries(queryClient)) {
    const statusSegment = getTaskStatusSegment(queryKey)
    if (statusSegment !== statusValue) {
      continue
    }

    const scope = getTaskScopeSegment(queryKey)
    const isAllScope = scope === 'all'
    const isMatchingGroup = scope === task.group.id
    if (!isAllScope && !isMatchingGroup) {
      continue
    }

    queryClient.setQueryData(queryKey, (current: TaskListData | undefined) =>
      mapTaskListData(current ?? data ?? undefined, (items) => {
        if (items.some((candidate) => candidate.id === task.id)) {
          return items.map((candidate) => (candidate.id === task.id ? task : candidate))
        }
        return [task, ...items]
      })
    )
  }
}

function updateGroupCounts(
  queryClient: QueryClient,
  updater: (group: GroupSummary) => GroupSummary
): void {
  queryClient.setQueryData(['groups'], (current: GroupSummary[] | undefined) =>
    current?.map(updater) ?? current
  )
}

export function adjustGroupOpenCount(
  queryClient: QueryClient,
  groupId: string,
  delta: number
): void {
  if (delta === 0) {
    return
  }

  updateGroupCounts(queryClient, (group) =>
    group.id === groupId
      ? {
          ...group,
          open_task_count: Math.max(0, group.open_task_count + delta),
        }
      : group
  )
}

export async function prepareOptimisticTaskStatus(
  queryClient: QueryClient,
  task: TaskSummary,
  status: TaskSummary['status'],
  completedAt: string | null
) {
  await Promise.all([
    queryClient.cancelQueries({ queryKey: ['groups'] }),
    queryClient.cancelQueries({ queryKey: ['tasks'] }),
    queryClient.cancelQueries({ queryKey: ['desktop', 'tasks'] }),
    queryClient.cancelQueries({ queryKey: ['task-detail', task.id] }),
  ])
  const snapshots = snapshotTaskQueries(queryClient, task.id)
  const optimisticTask: TaskSummary = { ...task, status, completed_at: completedAt }
  applyTaskListMutation(queryClient, (currentTask, statusSegment) => {
    if (currentTask.id !== task.id) return currentTask
    return statusSegment === status ? optimisticTask : null
  })
  prependTaskToMatchingLists(queryClient, optimisticTask, status)
  adjustGroupOpenCount(queryClient, task.group.id, status === 'open' ? 1 : -1)
  updateTaskDetailCache(queryClient, optimisticTask)
  return { snapshots, optimisticTask }
}
