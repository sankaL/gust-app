import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import {
  updateSessionTimezone,
  type SessionStatus,
} from '../lib/api'

type TimezoneSyncStatus = 'checking' | 'ready' | 'error'

function getBrowserTimezone(): string {
  const timezone = Intl.DateTimeFormat().resolvedOptions().timeZone
  if (!timezone) throw new Error('Browser timezone is unavailable.')
  return timezone
}

function isDateSensitiveQuery(queryKey: readonly unknown[]): boolean {
  return queryKey[0] === 'tasks' ||
    queryKey[0] === 'task-detail' ||
    (queryKey[0] === 'desktop' && queryKey[1] === 'tasks')
}

export function useSessionTimezoneSync(session: SessionStatus | undefined) {
  const queryClient = useQueryClient()
  const sessionRef = useRef(session)
  const inFlightRef = useRef<Promise<void> | null>(null)
  const [status, setStatus] = useState<TimezoneSyncStatus>('checking')
  sessionRef.current = session

  const synchronize = useCallback((): Promise<void> => {
    if (inFlightRef.current) return inFlightRef.current

    const operation = (async () => {
      const current = queryClient.getQueryData<SessionStatus>(['session-status']) ?? sessionRef.current
      if (!current?.signed_in) {
        setStatus('ready')
        return
      }

      setStatus('checking')
      try {
        const browserTimezone = getBrowserTimezone()
        if (current.timezone === browserTimezone) {
          setStatus('ready')
          return
        }
        if (!current.csrf_token) throw new Error('Session CSRF token is unavailable.')

        const updatedSession = await updateSessionTimezone(browserTimezone, current.csrf_token)
        queryClient.setQueryData(['session-status'], updatedSession)
        await queryClient.invalidateQueries({
          predicate: (query) => isDateSensitiveQuery(query.queryKey),
          refetchType: 'active',
        })
        setStatus('ready')
      } catch {
        setStatus('error')
      }
    })()

    inFlightRef.current = operation
    void operation.finally(() => {
      if (inFlightRef.current === operation) inFlightRef.current = null
    })
    return operation
  }, [queryClient])

  useEffect(() => {
    void synchronize()
  }, [session?.signed_in, session?.timezone, session?.user?.id, synchronize])

  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') void synchronize()
    }
    document.addEventListener('visibilitychange', handleVisibilityChange)
    return () => document.removeEventListener('visibilitychange', handleVisibilityChange)
  }, [synchronize])

  let sessionMatchesBrowser = !session?.signed_in
  try {
    if (session?.signed_in) sessionMatchesBrowser = session.timezone === getBrowserTimezone()
  } catch {
    sessionMatchesBrowser = false
  }

  return {
    isReady: status === 'ready' && sessionMatchesBrowser,
    isError: status === 'error',
    retry: synchronize,
  }
}
