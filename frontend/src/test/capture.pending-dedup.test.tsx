import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, describe, expect, it, vi } from 'vitest'

import { AppProviders } from '../providers'
import { AppShell } from '../components/AppShell'
import { CaptureRoute } from '../routes/CaptureRoute'

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
    top_confidence: 0.92,
    needs_review: false,
    status: 'pending' as 'pending' | 'approved' | 'discarded',
    created_at: '2026-03-24T10:00:00Z',
    updated_at: '2026-03-24T10:00:00Z'
  }
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

afterEach(() => {
  vi.restoreAllMocks()
  vi.unstubAllGlobals()
})

describe('capture pending list dedupe', () => {
  it('hides active-capture pending tasks during review and restores them after Done', async () => {
    const { fetchMock } = createFetchMock()
    vi.stubGlobal('fetch', fetchMock)

    renderCaptureRoute()
    const user = userEvent.setup()

    await user.click(await screen.findByText('Write it'))
    await user.type(screen.getByPlaceholderText('Type or paste here...'), 'Review active capture')
    await user.click(screen.getByRole('button', { name: 'Review Text Capture' }))

    const newlyCapturedHeading = await screen.findByRole('heading', { name: /Newly extracted tasks/i })
    const olderPendingHeading = await screen.findByRole('heading', { name: /Old pending tasks/i })
    expect(
      newlyCapturedHeading.compareDocumentPosition(olderPendingHeading) &
        Node.DOCUMENT_POSITION_FOLLOWING
    ).toBeTruthy()
    expect(screen.getByText('Other capture task')).toBeInTheDocument()
    expect(screen.getAllByText('Active capture task')).toHaveLength(1)

    await user.click(screen.getByRole('button', { name: 'Done' }))

    expect(await screen.findByRole('heading', { name: /Old pending tasks/i })).toBeInTheDocument()
    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Done' })).not.toBeInTheDocument()
    })
    expect(screen.queryByRole('heading', { name: /Newly extracted tasks/i })).not.toBeInTheDocument()
    expect(screen.getByText('Active capture task')).toBeInTheDocument()
    expect(screen.getByText('Other capture task')).toBeInTheDocument()
  })

  it('runs pending Approve All only for visible pending captures during active review', async () => {
    const { fetchMock, state } = createFetchMock()
    vi.stubGlobal('fetch', fetchMock)

    renderCaptureRoute()
    const user = userEvent.setup()

    await user.click(await screen.findByText('Write it'))
    await user.type(screen.getByPlaceholderText('Type or paste here...'), 'Review active capture')
    await user.click(screen.getByRole('button', { name: 'Review Text Capture' }))

    const pendingHeading = await screen.findByRole('heading', { name: /Old pending tasks/i })
    const pendingSection = pendingHeading.parentElement?.parentElement?.parentElement
    if (!pendingSection) {
      throw new Error('Could not resolve pending section container')
    }

    await user.click(within(pendingSection).getByRole('button', { name: 'Approve All' }))

    await waitFor(() => {
      expect(state.approveAllCalls).toEqual(['capture-2'])
    })
  })
})
