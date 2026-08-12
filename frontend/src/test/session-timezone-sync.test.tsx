import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import {
  SESSION_TIMEZONE_SYNC_TIMEOUT_MS,
  useSessionTimezoneSync,
} from '../hooks/useSessionTimezoneSync'
import {
  updateSessionTimezone,
  type SessionStatus,
} from '../lib/api'
import { signedInSession } from './session-fixtures'

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return { ...actual, updateSessionTimezone: vi.fn() }
})

const mockedUpdateSessionTimezone = vi.mocked(updateSessionTimezone)
const nativeResolvedOptions = new Intl.DateTimeFormat().resolvedOptions()

function browserTimezone(timezone: string) {
  vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({
    ...nativeResolvedOptions,
    timeZone: timezone,
  })
}

function setup(session: SessionStatus, timeoutMs = SESSION_TIMEZONE_SYNC_TIMEOUT_MS) {
  const client = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  client.setQueryData(['session-status'], session)
  client.setQueryData(['tasks', 'all', 'open'], { items: [] })
  const wrapper = ({ children }: { children: React.ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
  const hook = renderHook(() => {
    const sessionQuery = useQuery<SessionStatus>({
      queryKey: ['session-status'],
      queryFn: () => Promise.resolve(session),
      enabled: false,
    })
    return useSessionTimezoneSync(sessionQuery.data, timeoutMs)
  }, { wrapper })
  return { client, hook }
}

beforeEach(() => {
  mockedUpdateSessionTimezone.mockReset()
})

afterEach(() => {
  vi.useRealTimers()
  vi.restoreAllMocks()
})

describe('session timezone synchronization', () => {
  it('persists a different browser timezone before marking task dates ready', async () => {
    browserTimezone('America/Toronto')
    const initial = signedInSession()
    const updated = { ...initial, timezone: 'America/Toronto' }
    mockedUpdateSessionTimezone.mockResolvedValue(updated)

    const { client, hook } = setup(initial)

    expect(hook.result.current.isReady).toBe(false)
    await waitFor(() => expect(hook.result.current.isReady).toBe(true))
    expect(mockedUpdateSessionTimezone).toHaveBeenCalledTimes(1)
    expect(mockedUpdateSessionTimezone).toHaveBeenCalledWith(
      'America/Toronto',
      'csrf-token',
      expect.any(AbortSignal)
    )
    expect(client.getQueryData(['session-status'])).toEqual(updated)
    expect(client.getQueryState(['tasks', 'all', 'open'])?.isInvalidated).toBe(true)
  })

  it('does not write when the session already matches the browser timezone', async () => {
    browserTimezone('UTC')
    const { hook } = setup(signedInSession())

    await waitFor(() => expect(hook.result.current.isReady).toBe(true))
    expect(mockedUpdateSessionTimezone).not.toHaveBeenCalled()
  })

  it('blocks stale dates on failure and retries successfully', async () => {
    browserTimezone('America/Toronto')
    const initial = signedInSession()
    const updated = { ...initial, timezone: 'America/Toronto' }
    mockedUpdateSessionTimezone.mockRejectedValueOnce(new Error('network unavailable'))
    mockedUpdateSessionTimezone.mockResolvedValueOnce(updated)

    const { hook } = setup(initial)

    await waitFor(() => expect(hook.result.current.isError).toBe(true))
    expect(hook.result.current.isReady).toBe(false)

    await act(async () => {
      await hook.result.current.retry()
    })

    await waitFor(() => expect(hook.result.current.isReady).toBe(true))
    expect(mockedUpdateSessionTimezone).toHaveBeenCalledTimes(2)
  })

  it('times out and aborts a stalled synchronization before allowing retry', async () => {
    browserTimezone('America/Toronto')
    const initial = signedInSession()
    const updated = { ...initial, timezone: 'America/Toronto' }
    let firstSignal: AbortSignal | undefined
    mockedUpdateSessionTimezone.mockImplementationOnce((_timezone, _csrfToken, signal) => {
      firstSignal = signal
      return new Promise((_resolve, reject) => {
        signal?.addEventListener(
          'abort',
          () => reject(new DOMException('aborted', 'AbortError')),
          { once: true }
        )
      })
    })

    const { hook } = setup(initial, 20)
    await waitFor(() => expect(hook.result.current.isError).toBe(true))

    expect(firstSignal?.aborted).toBe(true)
    expect(hook.result.current.isError).toBe(true)
    expect(hook.result.current.isReady).toBe(false)

    vi.useRealTimers()
    mockedUpdateSessionTimezone.mockResolvedValueOnce(updated)
    await act(async () => {
      await hook.result.current.retry()
    })

    expect(hook.result.current.isReady).toBe(true)
  })

  it('aborts an in-flight synchronization when unmounted', async () => {
    browserTimezone('America/Toronto')
    let signal: AbortSignal | undefined
    mockedUpdateSessionTimezone.mockImplementation((_timezone, _csrfToken, requestSignal) => {
      signal = requestSignal
      return new Promise((_resolve, reject) => {
        requestSignal?.addEventListener(
          'abort',
          () => reject(new DOMException('aborted', 'AbortError')),
          { once: true }
        )
      })
    })

    const { hook } = setup(signedInSession())
    await waitFor(() => expect(mockedUpdateSessionTimezone).toHaveBeenCalledTimes(1))

    hook.unmount()

    expect(signal?.aborted).toBe(true)
  })

  it('rechecks once when the app returns to the foreground after a device timezone change', async () => {
    const timezone = { current: 'America/Toronto' }
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockImplementation(() => ({
      ...nativeResolvedOptions,
      timeZone: timezone.current,
    }))
    const initial = { ...signedInSession(), timezone: 'America/Toronto' }
    const updated = { ...initial, timezone: 'America/Vancouver' }
    mockedUpdateSessionTimezone.mockResolvedValue(updated)
    const { hook } = setup(initial)
    await waitFor(() => expect(hook.result.current.isReady).toBe(true))

    timezone.current = 'America/Vancouver'
    act(() => {
      document.dispatchEvent(new Event('visibilitychange'))
    })

    await waitFor(() => expect(hook.result.current.isReady).toBe(true))
    expect(mockedUpdateSessionTimezone).toHaveBeenCalledTimes(1)
    expect(mockedUpdateSessionTimezone).toHaveBeenCalledWith(
      'America/Vancouver',
      'csrf-token',
      expect.any(AbortSignal)
    )
  })
})
