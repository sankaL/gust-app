import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AppProviders } from '../providers'
import { AppShell } from '../components/AppShell'
import { CaptureRoute } from '../routes/CaptureRoute'
import { DEVICE_REDIRECT_OVERRIDE_KEY } from '../hooks/useDeviceRedirect'

type ExtractedTaskFixture = {
  id: string
  capture_id: string
  title: string
  group_id?: string
  group_name?: string | null
}

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

function buildSessionResponse() {
  return {
    signed_in: true,
    user: { id: 'user-1', email: 'user@example.com', display_name: 'Gust User' },
    timezone: 'UTC',
    inbox_group_id: 'inbox-1',
    csrf_token: 'csrf-token'
  }
}

function buildExtractedTask({
  id,
  capture_id,
  title,
  group_id = 'inbox-1',
  group_name = 'Inbox'
}: ExtractedTaskFixture) {
  return {
    id,
    capture_id,
    title,
    group_id,
    group_name,
    due_date: null,
    reminder_at: null,
    recurrence_frequency: null,
    recurrence_weekday: null,
    recurrence_day_of_month: null,
    recurrence_month: null,
    top_confidence: 0.92,
    needs_review: false,
    status: 'pending' as 'pending' | 'approved' | 'discarded',
    subtask_titles: [],
    created_at: '2026-03-24T10:00:00Z',
    updated_at: '2026-03-24T10:00:00Z'
  }
}

function renderCaptureRoute() {
  sessionStorage.clear()
  sessionStorage.setItem(DEVICE_REDIRECT_OVERRIDE_KEY, 'true')

  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <AppShell />,
        children: [{ path: 'capture', element: <CaptureRoute /> }, { path: 'tasks', element: <div data-testid="tasks-route" /> }]
      }
    ],
    { initialEntries: ['/capture'] }
  )

  return render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  )
}

function createFetchMock() {
  const activeTask = buildExtractedTask({
    id: 'task-capture-1',
    capture_id: 'capture-1',
    title: 'Active capture task'
  })
  const otherTask = buildExtractedTask({
    id: 'task-capture-2',
    capture_id: 'capture-2',
    title: 'Other capture task'
  })

  const state = {
    pendingTasks: [activeTask, otherTask],
    extractedByCapture: {
      'capture-1': [activeTask],
      'capture-2': [otherTask]
    } as Record<string, ReturnType<typeof buildExtractedTask>[]>,
    approveAllCalls: [] as string[]
  }

  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input)
    const method = init?.method ?? 'GET'

    if (url.includes('/auth/session')) {
      return Promise.resolve(jsonResponse(buildSessionResponse()))
    }

    if (url.endsWith('/groups')) {
      return Promise.resolve(jsonResponse([]))
    }

    if (url.endsWith('/captures/pending-tasks')) {
      return Promise.resolve(jsonResponse(state.pendingTasks))
    }

    if (url.endsWith('/captures/text') && method === 'POST') {
      return Promise.resolve(
        jsonResponse(
          {
            capture_id: 'capture-1',
            status: 'ready_for_review',
            transcript_text: 'Active capture note'
          },
          { status: 201 }
        )
      )
    }

    const extractedTasksMatch = url.match(/\/captures\/([^/]+)\/extracted-tasks$/)
    if (extractedTasksMatch && method === 'GET') {
      const captureId = extractedTasksMatch[1]
      return Promise.resolve(jsonResponse(state.extractedByCapture[captureId] ?? []))
    }

    const approveAllMatch = url.match(/\/captures\/([^/]+)\/extracted-tasks\/approve-all$/)
    if (approveAllMatch && method === 'POST') {
      const captureId = approveAllMatch[1]
      state.approveAllCalls.push(captureId)
      state.pendingTasks = state.pendingTasks.filter(
        (task) => !(task.capture_id === captureId && task.status === 'pending')
      )
      state.extractedByCapture[captureId] = (state.extractedByCapture[captureId] ?? []).map((task) => ({
        ...task,
        status: 'approved'
      }))
      return Promise.resolve(jsonResponse([{ id: `approved-${captureId}` }]))
    }

    const completeMatch = url.match(/\/captures\/([^/]+)\/complete$/)
    if (completeMatch && method === 'POST') {
      return Promise.resolve(jsonResponse({ status: 'completed' }))
    }

    return Promise.resolve(jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, { status: 404 }))
  })

  return { fetchMock, state }
}

function createSequentialCaptureFetchMock() {
  const state = {
    pendingTasks: [] as ReturnType<typeof buildExtractedTask>[],
    nextCaptureNumber: 1
  }

  return vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input)
    const method = init?.method ?? 'GET'

    if (url.includes('/auth/session')) {
      return Promise.resolve(jsonResponse(buildSessionResponse()))
    }

    if (url.endsWith('/groups')) {
      return Promise.resolve(jsonResponse([]))
    }

    if (url.endsWith('/captures/pending-tasks')) {
      return Promise.resolve(jsonResponse(state.pendingTasks))
    }

    if (url.endsWith('/captures/text') && method === 'POST') {
      const captureNumber = state.nextCaptureNumber++
      const captureId = `capture-${captureNumber}`
      state.pendingTasks.push(buildExtractedTask({
        id: `task-${captureNumber}`,
        capture_id: captureId,
        title: `Captured task ${captureNumber}`
      }))
      return Promise.resolve(jsonResponse({
        capture_id: captureId,
        status: 'ready_for_review',
        transcript_text: `Capture ${captureNumber}`
      }, { status: 201 }))
    }

    const extractedTasksMatch = url.match(/\/captures\/([^/]+)\/extracted-tasks$/)
    if (extractedTasksMatch && method === 'GET') {
      return Promise.resolve(jsonResponse(
        state.pendingTasks.filter((task) => task.capture_id === extractedTasksMatch[1])
      ))
    }

    return Promise.resolve(jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, { status: 404 }))
  })
}

function createStalledPendingRefreshFetchMock() {
  const state = { pendingRequestCount: 0 }
  const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
    const url = requestUrl(input)
    const method = init?.method ?? 'GET'

    if (url.includes('/auth/session')) {
      return Promise.resolve(jsonResponse(buildSessionResponse()))
    }

    if (url.endsWith('/groups')) {
      return Promise.resolve(jsonResponse([]))
    }

    if (url.endsWith('/captures/pending-tasks')) {
      state.pendingRequestCount += 1
      return new Promise<Response>(() => {})
    }

    if (url.endsWith('/captures/text') && method === 'POST') {
      return Promise.resolve(jsonResponse({
        capture_id: 'capture-stalled-pending-refresh',
        status: 'ready_for_review',
        transcript_text: 'Capture ready despite pending refresh'
      }, { status: 201 }))
    }

    const extractedTasksMatch = url.match(/\/captures\/([^/]+)\/extracted-tasks$/)
    if (extractedTasksMatch && method === 'GET') {
      return Promise.resolve(jsonResponse([buildExtractedTask({
        id: 'task-stalled-pending-refresh',
        capture_id: extractedTasksMatch[1],
        title: 'Capture ready despite pending refresh'
      })]))
    }

    return Promise.resolve(jsonResponse({ error: { code: 'not_found', message: 'Not found' } }, { status: 404 }))
  })

  return { fetchMock, state }
}

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

async function submitTextCapture(user: ReturnType<typeof userEvent.setup>, text: string) {
  await user.click(await screen.findByRole('radio', { name: 'Type' }))
  await user.type(screen.getByLabelText('Write it instead'), text)
  await user.click(screen.getByRole('button', { name: 'Review Text Capture' }))
}

describe('capture pending list dedupe', () => {
  it('opens review when the pending-task refresh is stalled', async () => {
    const { fetchMock, state } = createStalledPendingRefreshFetchMock()
    vi.stubGlobal('fetch', fetchMock)
    renderCaptureRoute()
    const user = userEvent.setup()

    await waitFor(() => expect(state.pendingRequestCount).toBeGreaterThan(0))
    await submitTextCapture(user, 'Capture despite refresh issue')

    expect(await screen.findByText('Capture ready despite pending refresh')).toBeInTheDocument()
    expect(screen.queryByText('Preparing...')).not.toBeInTheDocument()
  })

  it('keeps unresolved tasks from earlier captures one tap away across consecutive captures', async () => {
    vi.stubGlobal('fetch', createSequentialCaptureFetchMock())
    renderCaptureRoute()
    const user = userEvent.setup()

    await submitTextCapture(user, 'Capture several tasks')
    expect(await screen.findByText('Captured task 1')).toBeInTheDocument()
    expect(screen.queryByText(/from earlier captures/)).not.toBeInTheDocument()

    // The + button starts a fresh capture; without a microphone it falls back to typing.
    await user.click(screen.getByRole('button', { name: 'Add a new task' }))
    await user.type(await screen.findByLabelText('Write it instead'), 'Capture another task')
    await user.click(screen.getByRole('button', { name: 'Review Text Capture' }))

    expect(await screen.findByText('Captured task 2')).toBeInTheDocument()
    expect(screen.queryByText('Captured task 1')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: /1 more task from earlier captures/ }))

    const reviewSheet = await screen.findByRole('dialog', { name: '2 pending tasks' })
    expect(within(reviewSheet).getAllByText('Captured task 1')).toHaveLength(1)
    expect(within(reviewSheet).getAllByText('Captured task 2')).toHaveLength(1)
  })

  it('reviews only the active capture in the capture sheet and closes after Done', async () => {
    const { fetchMock } = createFetchMock()
    vi.stubGlobal('fetch', fetchMock)
    renderCaptureRoute()
    const user = userEvent.setup()

    await submitTextCapture(user, 'Review active capture')

    const captureSheet = await screen.findByRole('dialog', { name: '1 new task' })
    expect(within(captureSheet).getAllByText('Active capture task')).toHaveLength(1)
    expect(within(captureSheet).queryByText('Other capture task')).not.toBeInTheDocument()
    expect(within(captureSheet).getByRole('button', { name: /1 more task from earlier captures/ })).toBeInTheDocument()

    await user.click(within(captureSheet).getByRole('button', { name: 'Done' }))
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: '1 new task' })).not.toBeInTheDocument()
    })
    expect(fetchMock.mock.calls.some(([input, init]) => requestUrl(input as RequestInfo).endsWith('/captures/capture-1/complete') && (init)?.method === 'POST')).toBe(true)
  })

  it('scopes Approve All to the active capture in the capture sheet and to every capture in Review', async () => {
    const { fetchMock, state } = createFetchMock()
    vi.stubGlobal('fetch', fetchMock)
    renderCaptureRoute()
    const user = userEvent.setup()

    await submitTextCapture(user, 'Review active capture')
    const captureSheet = await screen.findByRole('dialog', { name: '1 new task' })
    await user.click(within(captureSheet).getByRole('button', { name: 'Approve All' }))
    await waitFor(() => expect(state.approveAllCalls).toEqual(['capture-1']))

    await user.click(await screen.findByRole('button', { name: /1 more task from earlier captures/ }))
    const reviewSheet = await screen.findByRole('dialog', { name: '1 pending task' })
    expect(within(reviewSheet).getByText('Other capture task')).toBeInTheDocument()
    await user.click(within(reviewSheet).getByRole('button', { name: 'Approve All' }))

    await waitFor(() => expect(state.approveAllCalls).toEqual(['capture-1', 'capture-2']))
    expect(await within(reviewSheet).findByText('All caught up')).toBeInTheDocument()
  })
})
