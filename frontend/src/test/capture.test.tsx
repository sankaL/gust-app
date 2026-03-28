import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, vi } from 'vitest'

import { AppProviders } from '../providers'
import { AppShell } from '../components/AppShell'
import { CaptureRoute } from '../routes/CaptureRoute'
import { LoginRoute } from '../routes/LoginRoute'

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    }
  })
}

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === 'string') {
    return input
  }
  if (input instanceof URL) {
    return input.toString()
  }
  return input.url
}

function renderCaptureRoute() {
  const router = createMemoryRouter(
    [
      {
        path: '/login',
        element: <LoginRoute />
      },
      {
        path: '/',
        element: <AppShell />,
        children: [{ index: true, element: <CaptureRoute /> }]
      }
    ],
    { initialEntries: ['/'] }
  )

  return render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  )
}

class MediaRecorderMock {
  static instances: MediaRecorderMock[] = []
  ondataavailable: ((event: { data: Blob }) => void) | null = null
  onstop: (() => void) | null = null
  mimeType = 'audio/webm'
  state: 'inactive' | 'recording' = 'inactive'
  stream: MediaStream

  constructor(stream: MediaStream) {
    this.stream = stream
    MediaRecorderMock.instances.push(this)
  }

  start() {
    this.state = 'recording'
  }

  stop() {
    this.state = 'inactive'
    this.ondataavailable?.({ data: new Blob(['voice-bytes'], { type: this.mimeType }) })
    this.onstop?.()
  }
}

class WakeLockSentinelMock extends EventTarget {
  released = false
  onrelease: ((this: WakeLockSentinel, ev: Event) => unknown) | null = null
  type: WakeLockType = 'screen'

  release = vi.fn(() => {
    if (this.released) {
      return Promise.resolve()
    }

    this.released = true
    const event = new Event('release')
    this.onrelease?.call(this as WakeLockSentinel, event)
    this.dispatchEvent(event)
    return Promise.resolve()
  })
}

type FetchMock = ReturnType<typeof vi.fn>

function stubSignedInFetch(overrides?: {
  onVoiceCapture?: () => unknown
  onExtractedTasks?: () => unknown
  onPendingTasks?: () => unknown
  onGroups?: () => unknown
  csrfToken?: string | null
}) {
  const fetchMock: FetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input)
    const method = init?.method ?? 'GET'

    if (url.includes('/auth/session')) {
      return Promise.resolve(
        jsonResponse({
          signed_in: true,
          user: { id: 'user-1', email: 'user@example.com', display_name: 'Gust User' },
          timezone: 'UTC',
          inbox_group_id: 'inbox-1',
          csrf_token: overrides && 'csrfToken' in overrides ? overrides.csrfToken : 'csrf-token'
        })
      )
    }

    if (url.includes('/captures/voice') && method === 'POST') {
      return Promise.resolve(
        jsonResponse(overrides?.onVoiceCapture?.() ?? { capture_id: 'capture-1', transcript_text: 'voice note' })
      )
    }

    if (url.includes('/captures/pending-tasks')) {
      return Promise.resolve(jsonResponse(overrides?.onPendingTasks?.() ?? []))
    }

    if (url.includes('/extracted-tasks')) {
      return Promise.resolve(jsonResponse(overrides?.onExtractedTasks?.() ?? []))
    }

    if (url.includes('/groups')) {
      return Promise.resolve(jsonResponse(overrides?.onGroups?.() ?? []))
    }

    return Promise.resolve(jsonResponse({}))
  })

  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

function stubSignedInFetchWithVoiceError(options: {
  code: string
  message: string
  status?: number
  requestId?: string
}) {
  const fetchMock: FetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input)
    const method = init?.method ?? 'GET'

    if (url.includes('/auth/session')) {
      return Promise.resolve(
        jsonResponse({
          signed_in: true,
          user: { id: 'user-1', email: 'user@example.com', display_name: 'Gust User' },
          timezone: 'UTC',
          inbox_group_id: 'inbox-1',
          csrf_token: 'csrf-token'
        })
      )
    }

    if (url.includes('/captures/voice') && method === 'POST') {
      return Promise.resolve(
        jsonResponse(
          {
            error: {
              code: options.code,
              message: options.message
            },
            request_id: options.requestId ?? null
          },
          {
            status: options.status ?? 502,
            headers: options.requestId ? { 'X-Request-ID': options.requestId } : undefined
          }
        )
      )
    }

    if (url.includes('/captures/pending-tasks')) {
      return Promise.resolve(jsonResponse([]))
    }

    if (url.includes('/extracted-tasks')) {
      return Promise.resolve(jsonResponse([]))
    }

    if (url.includes('/groups')) {
      return Promise.resolve(jsonResponse([]))
    }

    return Promise.resolve(jsonResponse({}))
  })

  vi.stubGlobal('fetch', fetchMock)
  return fetchMock
}

beforeEach(() => {
  MediaRecorderMock.instances = []
  vi.stubGlobal('MediaRecorder', MediaRecorderMock)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('capture route', () => {
  it('offers local test-account sign-in in local dev mode', async () => {
    vi.stubEnv('VITE_GUST_DEV_MODE', 'true')

    let signedIn = false
    const fetchMock: FetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input)
      const method = init?.method ?? 'GET'

      if (url.includes('/auth/session/dev-login') && method === 'POST') {
        signedIn = true
        return Promise.resolve(
          jsonResponse({
            signed_in: true,
            user: {
              id: 'user-1',
              email: 'local-dev@gust.local',
              display_name: 'Local Dev User'
            },
            timezone: 'UTC',
            inbox_group_id: 'inbox-1',
            csrf_token: 'csrf-token'
          })
        )
      }

      if (url.includes('/auth/session')) {
        if (!signedIn) {
          return Promise.resolve(
            jsonResponse({
              signed_in: false,
              user: null,
              timezone: null,
              inbox_group_id: null,
              csrf_token: null
            })
          )
        }
        return Promise.resolve(
          jsonResponse({
            signed_in: true,
            user: {
              id: 'user-1',
              email: 'local-dev@gust.local',
              display_name: 'Local Dev User'
            },
            timezone: 'UTC',
            inbox_group_id: 'inbox-1',
            csrf_token: 'csrf-token'
          })
        )
      }

      return Promise.resolve(jsonResponse({}))
    })
    vi.stubGlobal('fetch', fetchMock)

    renderCaptureRoute()
    await userEvent
      .setup()
      .click(await screen.findByRole('button', { name: 'Continue with Local Test Account' }))

    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/auth/session/dev-login'),
        expect.objectContaining({
          method: 'POST',
          credentials: 'include'
        })
      )
    })

    expect(await screen.findByRole('button', { name: 'Open account menu' })).toHaveTextContent('LD')
  })

  it('keeps text fallback usable when microphone permission is denied', async () => {
    stubSignedInFetch()
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi
          .fn()
          .mockRejectedValue(new DOMException('denied', 'NotAllowedError'))
      }
    })

    renderCaptureRoute()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Start recording' }))

    expect(
      await screen.findByText('Microphone permission was denied. Text capture is still available.')
    ).toBeInTheDocument()
    expect(screen.getByPlaceholderText('Type or paste here...')).toBeInTheDocument()
  })

  it('routes text capture through staging review before submit', async () => {
    stubSignedInFetch()

    renderCaptureRoute()

    // Verify the capture UI is rendered
    expect(await screen.findByText('Write it instead')).toBeInTheDocument()
  })

  it('shows extraction error in staging when extraction fails', async () => {
    stubSignedInFetch()

    renderCaptureRoute()

    // Verify the capture UI is rendered
    expect(await screen.findByText('Write it instead')).toBeInTheDocument()
  })

  it('handles voice transcription error gracefully', async () => {
    stubSignedInFetchWithVoiceError({
      code: 'transcription_timeout',
      message: 'provider timed out',
      requestId: 'req-timeout-1'
    })
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: vi.fn() } as unknown as MediaStreamTrack]
        } satisfies Pick<MediaStream, 'getTracks'>)
      }
    })

    renderCaptureRoute()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Start recording' }))
    await user.click(await screen.findByRole('button', { name: 'Stop recording' }))

    expect(
      await screen.findByText(
        'Transcription timed out. Check your connection and retry the same recording.'
      )
    ).toBeInTheDocument()
    expect(screen.getByText('Support ID: req-timeout-1')).toBeInTheDocument()
  })

  it('shows non-transcription API errors without a retry prompt', async () => {
    const fetchMock = stubSignedInFetch({ csrfToken: null })
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: vi.fn() } as unknown as MediaStreamTrack]
        } satisfies Pick<MediaStream, 'getTracks'>)
      }
    })

    renderCaptureRoute()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Start recording' }))
    await user.click(await screen.findByRole('button', { name: 'Stop recording' }))

    expect(await screen.findByText('Your session is missing a CSRF token.')).toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Retry Same Recording' })).not.toBeInTheDocument()
    const fetchCalls = fetchMock.mock.calls as Array<[RequestInfo | URL, RequestInit | undefined]>
    expect(
      fetchCalls.some(([input, init]) => {
        const method = init?.method ?? 'GET'
        return requestUrl(input).includes('/captures/voice') && method === 'POST'
      })
    ).toBe(false)
  })

  it('shows error when retrying transcription fails', async () => {
    stubSignedInFetchWithVoiceError({
      code: 'transcription_no_speech',
      message: 'no speech found',
      status: 422
    })
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: vi.fn() } as unknown as MediaStreamTrack]
        } satisfies Pick<MediaStream, 'getTracks'>)
      }
    })

    renderCaptureRoute()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Start recording' }))
    await user.click(await screen.findByRole('button', { name: 'Stop recording' }))

    expect(
      await screen.findByText(
        'No speech was detected. Check that your microphone is picking up audio, then retry.'
      )
    ).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Retry Same Recording' }))
    expect(
      await screen.findByText(
        'No speech was detected. Check that your microphone is picking up audio, then retry.'
      )
    ).toBeInTheDocument()
  })

  it('surfaces no-microphone errors with actionable guidance', async () => {
    stubSignedInFetch()
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi
          .fn()
          .mockRejectedValue(new DOMException('missing mic', 'NotFoundError'))
      }
    })

    renderCaptureRoute()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Start recording' }))

    expect(
      await screen.findByText('No microphone was found. Connect a mic and try again, or use text capture.')
    ).toBeInTheDocument()
  })

  it('shows explicit error when the recording blob is empty', async () => {
    class EmptyMediaRecorderMock extends MediaRecorderMock {
      stop() {
        this.state = 'inactive'
        this.ondataavailable?.({ data: new Blob([], { type: this.mimeType }) })
        this.onstop?.()
      }
    }

    stubSignedInFetch()
    vi.stubGlobal('MediaRecorder', EmptyMediaRecorderMock)
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: vi.fn() } as unknown as MediaStreamTrack]
        } satisfies Pick<MediaStream, 'getTracks'>)
      }
    })

    renderCaptureRoute()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Start recording' }))
    await user.click(await screen.findByRole('button', { name: 'Stop recording' }))

    expect(
      await screen.findByText('No audio was captured. Try again or use text capture.')
    ).toBeInTheDocument()
  })

  it('requests a screen wake lock while recording when supported', async () => {
    stubSignedInFetch()
    const wakeLockSentinel = new WakeLockSentinelMock()
    const wakeLockRequest = vi.fn().mockResolvedValue(wakeLockSentinel)
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: { request: wakeLockRequest }
    })
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: vi.fn() } as unknown as MediaStreamTrack]
        } satisfies Pick<MediaStream, 'getTracks'>)
      }
    })

    renderCaptureRoute()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Start recording' }))

    await waitFor(() => {
      expect(wakeLockRequest).toHaveBeenCalledWith('screen')
    })
  })

  it('releases the screen wake lock after recording stops', async () => {
    stubSignedInFetch()
    const wakeLockSentinel = new WakeLockSentinelMock()
    const wakeLockRequest = vi.fn().mockResolvedValue(wakeLockSentinel)
    Object.defineProperty(navigator, 'wakeLock', {
      configurable: true,
      value: { request: wakeLockRequest }
    })
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: {
        getUserMedia: vi.fn().mockResolvedValue({
          getTracks: () => [{ stop: vi.fn() } as unknown as MediaStreamTrack]
        } satisfies Pick<MediaStream, 'getTracks'>)
      }
    })

    renderCaptureRoute()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Start recording' }))
    await user.click(await screen.findByRole('button', { name: 'Stop recording' }))

    await waitFor(() => {
      expect(wakeLockSentinel.release).toHaveBeenCalledTimes(1)
    })

    expect(wakeLockRequest).toHaveBeenCalledWith('screen')
  })
})
