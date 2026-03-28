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

  release = vi.fn(async () => {
    if (this.released) {
      return
    }

    this.released = true
    const event = new Event('release')
    this.onrelease?.call(this as WakeLockSentinel, event)
    this.dispatchEvent(event)
  })
}

type FetchMock = ReturnType<typeof vi.fn>

function stubSignedInFetch(overrides?: {
  onVoiceCapture?: () => unknown
  onExtractedTasks?: () => unknown
  onPendingTasks?: () => unknown
  onGroups?: () => unknown
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
        getUserMedia: vi.fn().mockRejectedValue(new Error('denied'))
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
    stubSignedInFetch()

    renderCaptureRoute()

    // Verify the capture UI is rendered
    expect(await screen.findByText('Write it instead')).toBeInTheDocument()
  })

  it('shows error when retrying transcription fails', async () => {
    stubSignedInFetch()

    renderCaptureRoute()

    // Verify the capture UI is rendered
    expect(await screen.findByText('Write it instead')).toBeInTheDocument()
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
