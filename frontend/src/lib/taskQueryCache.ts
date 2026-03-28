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
  const status = queryKey[2]
  return typeof status === 'string' ? status : null
}

export function getTaskSummaryFromCache(
  queryClient: QueryClient,
  taskId: string
): TaskSummary | null {
  const taskQueries = queryClient.getQueriesData<TaskListData>({ queryKey: ['tasks'] })

  for (const [, data] of taskQueries) {
    const items = flattenTaskListData(data)
    const task = items.find((candidate) => candidate.id === taskId)
    if (task) {
      return task
    }
  }

  return null
}

export function flattenTaskListData(data: TaskListData | undefined): TaskSummary[] {
  if (!data) {
    return []
  }

  if (Array.isArray(data)) {
    return data
  }

  if (isPaginatedResponse(data)) {
    return data.items
  }

  if (isInfiniteTaskData(data)) {
    return data.pages.flatMap((page) => page.items)
  }

  return []
}

export function snapshotTaskQueries(
  queryClient: QueryClient,
  taskId?: string
): QuerySnapshot[] {
  const snapshots: QuerySnapshot[] = []
  for (const [queryKey, data] of queryClient.getQueriesData({ queryKey: ['tasks'] })) {
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

    return {
      ...task,
      recurrence:
        task.recurrence_frequency != null
          ? {
              frequency: task.recurrence_frequency,
              weekday: null,
              day_of_month: null,
            }
          : null,
      subtasks: current?.subtasks ?? [],
    }
  })
}

export function applyTaskListMutation(
  queryClient: QueryClient,
  updater: (task: TaskSummary, statusSegment: string | null, queryKey: QueryKey) => TaskSummary | null
): void {
  for (const [queryKey, data] of queryClient.getQueriesData<TaskListData>({ queryKey: ['tasks'] })) {
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
  for (const [queryKey, data] of queryClient.getQueriesData<TaskListData>({ queryKey: ['tasks'] })) {
    const statusSegment = getTaskStatusSegment(queryKey)
    if (statusSegment !== statusValue) {
      continue
    }

    const scope = queryKey[1]
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

export function updateGroupCounts(
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
