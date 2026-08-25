import { useQuery } from '@tanstack/react-query'

import { getSessionStatus, listAllTasks, listTasks } from '../lib/api'
import { TASK_SCREEN_GC_TIME_MS, TASK_SCREEN_STALE_TIME_MS } from '../lib/taskScreenCache'
import { useSessionGroups } from './useSessionGroups'

export function useOpenTaskRouteQueries(selectedGroupId: string | null, searchQuery = '') {
  const session = useQuery({ queryKey: ['session-status'], queryFn: getSessionStatus, retry: false })
  const groups = useSessionGroups(session.data)
  const effectiveGroupId = selectedGroupId ?? 'all'
  const isAllView = effectiveGroupId === 'all'
  const resolvedGroupId = isAllView ? null : effectiveGroupId
  const tasks = useQuery({
    queryKey: ['tasks', resolvedGroupId, 'open', searchQuery],
    queryFn: () => listTasks(resolvedGroupId as string, 'open', null, 50, null, null, searchQuery),
    enabled: session.data?.signed_in === true && Boolean(resolvedGroupId) && !isAllView,
    staleTime: TASK_SCREEN_STALE_TIME_MS,
    gcTime: TASK_SCREEN_GC_TIME_MS,
    placeholderData: (previous, previousQuery) => previousQuery?.queryKey[1] === resolvedGroupId ? previous : undefined,
  })
  const isRefreshing = !isAllView && ((tasks.isFetching && !tasks.isLoading) || (groups.isFetching && !groups.isLoading))
  return { session, groups, tasks, effectiveGroupId, isAllView, resolvedGroupId, isRefreshing }
}

export function useCompletedTaskRouteQueries(selectedGroupId: string | null) {
  const session = useQuery({ queryKey: ['session-status'], queryFn: getSessionStatus, retry: false })
  const groups = useSessionGroups(session.data)
  const isAllView = selectedGroupId === 'all'
  const resolvedGroupId = isAllView ? null : selectedGroupId ?? session.data?.inbox_group_id ?? groups.data?.[0]?.id ?? null
  const tasks = useQuery({
    queryKey: ['tasks', isAllView ? 'all' : resolvedGroupId, 'completed'],
    queryFn: () => isAllView ? listAllTasks('completed') : listTasks(resolvedGroupId as string, 'completed'),
    enabled: session.data?.signed_in === true && (isAllView || Boolean(resolvedGroupId)),
    staleTime: TASK_SCREEN_STALE_TIME_MS,
    gcTime: TASK_SCREEN_GC_TIME_MS,
  })
  const isRefreshing = (tasks.isFetching && !tasks.isLoading) || (groups.isFetching && !groups.isLoading)
  return { session, groups, tasks, isAllView, resolvedGroupId, isRefreshing }
}
