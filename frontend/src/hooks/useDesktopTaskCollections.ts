import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'

import { fetchAllDesktopTasks } from '../lib/desktopData'
import { TASK_SCREEN_GC_TIME_MS, TASK_SCREEN_STALE_TIME_MS } from '../lib/taskScreenCache'

export function useDesktopTaskCollections({ groupId, completedStart, enabled = true }: { groupId?: string; completedStart?: string; enabled?: boolean } = {}) {
  const scope = groupId ?? 'all'
  const openQuery = useQuery({ queryKey: ['desktop', 'tasks', scope, 'open'], queryFn: () => fetchAllDesktopTasks('open', groupId ?? null), enabled, staleTime: TASK_SCREEN_STALE_TIME_MS, gcTime: TASK_SCREEN_GC_TIME_MS })
  const completedKey = completedStart ? ['desktop', 'tasks', scope, 'completed', completedStart] : ['desktop', 'tasks', scope, 'completed']
  const completedQuery = useQuery({ queryKey: completedKey, queryFn: () => fetchAllDesktopTasks('completed', groupId ?? null, completedStart ? { completedStart } : undefined), enabled, staleTime: TASK_SCREEN_STALE_TIME_MS, gcTime: TASK_SCREEN_GC_TIME_MS })
  const openTasks = useMemo(() => openQuery.data ?? [], [openQuery.data])
  const completedTasks = useMemo(() => completedQuery.data ?? [], [completedQuery.data])
  return { openQuery, completedQuery, openTasks, completedTasks }
}
