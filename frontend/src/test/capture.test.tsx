import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, vi } from 'vitest'

import { AppProviders } from '../providers'
import { AppShell } from '../components/AppShell'
import { CaptureRoute } from '../routes/CaptureRoute'

function jsonResponse(body: unknown, init?: ResponseInit) {
  return new Response(JSON.stringify(body), {
    status: init?.status ?? 200,
    headers: {
      'Content-Type': 'application/json',
      ...(init?.headers ?? {})
    }
  })
}

function renderCaptureRoute() {
  const router = createMemoryRouter(
    [
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

type FetchMock = ReturnType<typeof vi.fn>

beforeEach(() => {
  MediaRecorderMock.instances = []
  vi.stubGlobal('MediaRecorder', MediaRecorderMock)
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('capture route', () => {
  it('offers local test-account sign-in in local dev mode', async () => {
    vi.stubEnv('VITE_GUST_DEV_MODE', 'true')

    const fetchMock: FetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          signed_in: false,
          user: null,
          timezone: null,
          inbox_group_id: null,
          csrf_token: null
        })
      )
      .mockResolvedValueOnce(
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
      .mockResolvedValueOnce(
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

    expect(await screen.findByText('Local Dev User')).toBeInTheDocument()
  })

  it('keeps text fallback usable when microphone permission is denied', async () => {
    const fetchMock: FetchMock = vi.fn(() =>
      jsonResponse({
        signed_in: true,
        user: { id: 'user-1', email: 'user@example.com', display_name: 'Gust User' },
        timezone: 'UTC',
        inbox_group_id: 'inbox-1',
        csrf_token: 'csrf-token'
      })
    )
    vi.stubGlobal('fetch', fetchMock)
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
    expect(screen.getByPlaceholderText('Type or paste a messy brain dump here...')).toBeInTheDocument()
  })

  it('routes text capture through a separate review step before submit', async () => {
    const fetchMock: FetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          signed_in: true,
          user: { id: 'user-1', email: 'user@example.com', display_name: 'Gust User' },
          timezone: 'UTC',
          inbox_group_id: 'inbox-1',
          csrf_token: 'csrf-token'
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          capture_id: 'capture-1',
          status: 'ready_for_review',
          transcript_text: 'Draft follow-up email'
        }, { status: 201 })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          capture_id: 'capture-1',
          status: 'completed',
          tasks_created_count: 2,
          tasks_flagged_for_review_count: 1,
          tasks_skipped_count: 1,
          zero_actionable: false,
          skipped_items: [{ code: 'invalid_title', message: 'Task title cannot be blank.', title: 'Untitled' }]
        })
      )
    vi.stubGlobal('fetch', fetchMock)

    renderCaptureRoute()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Expand' }))
    await user.type(
      screen.getByPlaceholderText('Type or paste a messy brain dump here...'),
      'Draft follow-up email'
    )
    await user.click(screen.getByRole('button', { name: 'Review Text Capture' }))

    expect(await screen.findByRole('heading', { name: 'Text draft review' })).toBeInTheDocument()
    const transcript = screen.getByLabelText('Transcript')
    expect(transcript).toHaveValue('Draft follow-up email')

    await user.clear(transcript)
    await user.type(transcript, 'Draft follow-up email tomorrow morning')
    await user.click(screen.getByRole('button', { name: 'Submit Transcript' }))

    expect(await screen.findByRole('heading', { name: 'Capture completed' })).toBeInTheDocument()
    expect(screen.getByText('Created')).toBeInTheDocument()
    expect(screen.getByText('Untitled: Task title cannot be blank.')).toBeInTheDocument()

    await waitFor(() => {
      expect(fetchMock).toHaveBeenNthCalledWith(
        3,
        expect.stringContaining('/captures/capture-1/submit'),
        expect.objectContaining({
          method: 'POST',
          credentials: 'include'
        })
      )
    })
  })

  it('preserves edited transcript text when extraction fails', async () => {
    const fetchMock: FetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          signed_in: true,
          user: { id: 'user-1', email: 'user@example.com', display_name: 'Gust User' },
          timezone: 'UTC',
          inbox_group_id: 'inbox-1',
          csrf_token: 'csrf-token'
        })
      )
      .mockResolvedValueOnce(
        jsonResponse({
          capture_id: 'capture-2',
          status: 'ready_for_review',
          transcript_text: 'Call Sam'
        }, { status: 201 })
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: 'extraction_failed',
              message: 'Extraction failed. Please edit the transcript or retry.'
            }
          },
          { status: 502 }
        )
      )
    vi.stubGlobal('fetch', fetchMock)

    renderCaptureRoute()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Expand' }))
    await user.type(screen.getByPlaceholderText('Type or paste a messy brain dump here...'), 'Call Sam')
    await user.click(screen.getByRole('button', { name: 'Review Text Capture' }))

    const transcript = await screen.findByLabelText('Transcript')
    await user.type(transcript, ' at 9am')
    await user.click(screen.getByRole('button', { name: 'Submit Transcript' }))

    expect(
      await screen.findByText('Extraction failed. Please edit the transcript or retry.')
    ).toBeInTheDocument()
    expect(screen.getByLabelText('Transcript')).toHaveValue('Call Sam at 9am')
  })

  it('retries voice transcription with the same recording blob', async () => {
    const fetchMock: FetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          signed_in: true,
          user: { id: 'user-1', email: 'user@example.com', display_name: 'Gust User' },
          timezone: 'UTC',
          inbox_group_id: 'inbox-1',
          csrf_token: 'csrf-token'
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: 'transcription_failed',
              message: 'Transcription failed. Please retry.'
            }
          },
          { status: 502 }
        )
      )
      .mockResolvedValueOnce(
        jsonResponse({
          capture_id: 'capture-3',
          status: 'ready_for_review',
          transcript_text: 'Buy coffee beans'
        }, { status: 201 })
      )
    vi.stubGlobal('fetch', fetchMock)

    const stopTrack = vi.fn()
    const getUserMedia = vi.fn().mockResolvedValue({
      getTracks: () => [{ stop: stopTrack }]
    })
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia }
    })

    renderCaptureRoute()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Start recording' }))
    await user.click(screen.getByRole('button', { name: 'Stop recording' }))

    expect(
      await screen.findByText('Transcription failed. Please retry.')
    ).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Retry Same Recording' }))

    expect(await screen.findByRole('heading', { name: 'Voice transcript' })).toBeInTheDocument()
    expect(screen.getByLabelText('Transcript')).toHaveValue('Buy coffee beans')
    expect(getUserMedia).toHaveBeenCalledTimes(1)
    expect(fetchMock).toHaveBeenCalledTimes(3)
    expect(stopTrack).toHaveBeenCalled()
  })

  it('clears a stale review before starting a new recording', async () => {
    const fetchMock: FetchMock = vi
      .fn()
      .mockResolvedValueOnce(
        jsonResponse({
          signed_in: true,
          user: { id: 'user-1', email: 'user@example.com', display_name: 'Gust User' },
          timezone: 'UTC',
          inbox_group_id: 'inbox-1',
          csrf_token: 'csrf-token'
        })
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            capture_id: 'capture-1',
            status: 'ready_for_review',
            transcript_text: 'Draft follow-up email'
          },
          { status: 201 }
        )
      )
      .mockResolvedValueOnce(
        jsonResponse(
          {
            error: {
              code: 'transcription_failed',
              message: 'Transcription failed. Please retry.'
            }
          },
          { status: 502 }
        )
      )
    vi.stubGlobal('fetch', fetchMock)

    const stopTrack = vi.fn()
    const getUserMedia = vi.fn().mockResolvedValue({
      getTracks: () => [{ stop: stopTrack }]
    })
    Object.defineProperty(navigator, 'mediaDevices', {
      configurable: true,
      value: { getUserMedia }
    })

    renderCaptureRoute()
    const user = userEvent.setup()

    await user.click(await screen.findByRole('button', { name: 'Expand' }))
    await user.type(
      screen.getByPlaceholderText('Type or paste a messy brain dump here...'),
      'Draft follow-up email'
    )
    await user.click(screen.getByRole('button', { name: 'Review Text Capture' }))
    expect(await screen.findByRole('heading', { name: 'Text draft review' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Start recording' }))
    await user.click(screen.getByRole('button', { name: 'Stop recording' }))

    expect(
      await screen.findByText('Transcription failed. Please retry.')
    ).toBeInTheDocument()
    expect(screen.queryByRole('heading', { name: 'Text draft review' })).not.toBeInTheDocument()
    expect(screen.queryByLabelText('Transcript')).not.toBeInTheDocument()
    expect(screen.queryByRole('button', { name: 'Submit Transcript' })).not.toBeInTheDocument()
    expect(stopTrack).toHaveBeenCalled()
  })
})
