import { useQuery } from '@tanstack/react-query'

import { listGroups, type SessionStatus } from '../lib/api'
import { TASK_SCREEN_GC_TIME_MS, TASK_SCREEN_STALE_TIME_MS } from '../lib/taskScreenCache'

export function useSessionGroups(session: SessionStatus | undefined) {
  return useQuery({
    queryKey: ['groups'],
    queryFn: listGroups,
    enabled: session?.signed_in === true,
    staleTime: TASK_SCREEN_STALE_TIME_MS,
    gcTime: TASK_SCREEN_GC_TIME_MS,
  })
}
