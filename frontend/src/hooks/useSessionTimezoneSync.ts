import { useCallback, useEffect, useRef, useState } from 'react'
import { useQueryClient, type QueryClient } from '@tanstack/react-query'

import {
  updateSessionTimezone,
  type SessionStatus,
} from '../lib/api'

type TimezoneSyncStatus = 'checking' | 'ready' | 'error'

export const SESSION_TIMEZONE_SYNC_TIMEOUT_MS = 8_000

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

function cancelDateSensitiveQueries(queryClient: QueryClient) {
  return queryClient.cancelQueries({
    predicate: (query) => isDateSensitiveQuery(query.queryKey),
  })
}

function abortPromise(signal: AbortSignal): Promise<never> {
  return new Promise((_resolve, reject) => {
    signal.addEventListener(
      'abort',
      () => reject(new DOMException('Timezone synchronization was aborted.', 'AbortError')),
      { once: true }
    )
  })
}

export function useSessionTimezoneSync(
  session: SessionStatus | undefined,
  timeoutMs = SESSION_TIMEZONE_SYNC_TIMEOUT_MS
) {
  const queryClient = useQueryClient()
  const sessionRef = useRef(session)
  const inFlightRef = useRef<Promise<void> | null>(null)
  const abortControllerRef = useRef<AbortController | null>(null)
  const mountedRef = useRef(false)
  const generationRef = useRef(0)
  const [status, setStatus] = useState<TimezoneSyncStatus>('checking')
  sessionRef.current = session

  const synchronize = useCallback((): Promise<void> => {
    if (inFlightRef.current) return inFlightRef.current

    const operation = (async () => {
      const generation = generationRef.current
      const isCurrent = () => mountedRef.current && generation === generationRef.current
      const current = queryClient.getQueryData<SessionStatus>(['session-status']) ?? sessionRef.current
      if (!current?.signed_in) {
        if (isCurrent()) setStatus('ready')
        return
      }

      if (isCurrent()) setStatus('checking')
      const abortController = new AbortController()
      abortControllerRef.current = abortController
      let timeoutId: number | undefined
      try {
        const browserTimezone = getBrowserTimezone()
        if (current.timezone === browserTimezone) {
          if (isCurrent()) setStatus('ready')
          return
        }
        const csrfToken = current.csrf_token
        if (!csrfToken) throw new Error('Session CSRF token is unavailable.')

        const synchronization = (async () => {
          const updated = await updateSessionTimezone(
            browserTimezone,
            csrfToken,
            abortController.signal
          )
          await queryClient.invalidateQueries({
            predicate: (query) => isDateSensitiveQuery(query.queryKey),
            refetchType: 'active',
          })
          return updated
        })()
        const timeout = new Promise<never>((_resolve, reject) => {
          timeoutId = window.setTimeout(() => {
            abortController.abort()
            void cancelDateSensitiveQueries(queryClient)
            reject(new Error('Timezone synchronization timed out.'))
          }, timeoutMs)
        })
        const updatedSession = await Promise.race([
          synchronization,
          abortPromise(abortController.signal),
          timeout,
        ])
        if (!isCurrent()) return
        queryClient.setQueryData(['session-status'], updatedSession)
        setStatus('ready')
      } catch {
        if (isCurrent()) setStatus('error')
      } finally {
        if (timeoutId !== undefined) window.clearTimeout(timeoutId)
        if (abortControllerRef.current === abortController) abortControllerRef.current = null
      }
    })()

    inFlightRef.current = operation
    void operation.finally(() => {
      if (inFlightRef.current === operation) inFlightRef.current = null
    })
    return operation
  }, [queryClient, timeoutMs])

  useEffect(() => {
    mountedRef.current = true
    return () => {
      mountedRef.current = false
      generationRef.current += 1
      abortControllerRef.current?.abort()
      abortControllerRef.current = null
      inFlightRef.current = null
      void cancelDateSensitiveQueries(queryClient)
    }
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
