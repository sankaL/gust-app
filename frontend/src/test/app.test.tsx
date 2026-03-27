import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, vi } from 'vitest'

import { AppProviders } from '../providers'
import { AppShell } from '../components/AppShell'
import { CaptureRoute } from '../routes/CaptureRoute'
import { CompletedTasksRoute } from '../routes/CompletedTasksRoute'
import { ManageGroupsRoute } from '../routes/ManageGroupsRoute'
import { TaskDetailRoute } from '../routes/TaskDetailRoute'
import { TasksRoute } from '../routes/TasksRoute'

const updateServiceWorkerMock = vi.fn()
let mockNeedRefresh = false
let mockOfflineReady = false

vi.mock('virtual:pwa-register/react', async () => {
  const React = await import('react')

  return {
    useRegisterSW: (options?: {
      onNeedRefresh?: () => void
      onOfflineReady?: () => void
    }) => {
      // Fire callbacks once on mount if mocks are set
      React.useEffect(() => {
        if (mockNeedRefresh) {
          options?.onNeedRefresh?.()
        }
        if (mockOfflineReady) {
          options?.onOfflineReady?.()
        }
      }, []) // eslint-disable-line react-hooks/exhaustive-deps

      return {
        needRefresh: [mockNeedRefresh, vi.fn()],
        offlineReady: [mockOfflineReady, vi.fn()],
        updateServiceWorker: updateServiceWorkerMock
      }
    }
  }
})

function renderWithRoute(initialEntries: string[]) {
  const router = createMemoryRouter(
    [
      {
        path: '/',
        element: <AppShell />,
        children: [
          {
            index: true,
            element: <CaptureRoute />
          },
          {
            path: 'tasks',
            element: <TasksRoute />
          },
          {
            path: 'tasks/completed',
            element: <CompletedTasksRoute />
          },
          {
            path: 'tasks/groups',
            element: <ManageGroupsRoute />
          },
          {
            path: 'tasks/:taskId',
            element: <TaskDetailRoute />
          }
        ]
      }
    ],
    { initialEntries }
  )

  return render(
    <AppProviders>
      <RouterProvider router={router} />
    </AppProviders>
  )
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

const defaultUserAgent = window.navigator.userAgent

function setUserAgent(value: string) {
  Object.defineProperty(window.navigator, 'userAgent', {
    value,
    configurable: true
  })
}

beforeEach(() => {
  mockNeedRefresh = false
  mockOfflineReady = false
  updateServiceWorkerMock.mockReset()
  setUserAgent(defaultUserAgent)
  Object.defineProperty(window.navigator, 'standalone', {
    value: false,
    configurable: true
  })
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === '(display-mode: standalone)' ? false : false,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  })

  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL) => {
      const url = requestUrl(input)

      if (url.includes('/auth/session')) {
        return jsonResponse({
          signed_in: true,
          user: { id: 'user-1', email: 'user@example.com', display_name: 'Gust User' },
          timezone: 'UTC',
          inbox_group_id: 'inbox-1',
          csrf_token: 'csrf-token'
        })
      }

      if (url.includes('/groups')) {
        return jsonResponse([
          {
            id: 'inbox-1',
            name: 'Inbox',
            description: null,
            is_system: true,
            system_key: 'inbox',
            open_task_count: 1
          }
        ])
      }

      if (url.includes('/tasks?')) {
        return jsonResponse([
          {
            id: 'task-1',
            title: 'Review extraction contract',
            status: 'open',
            needs_review: true,
            due_date: null,
            reminder_at: null,
            due_bucket: 'no_date',
            group: {
              id: 'inbox-1',
              name: 'Inbox',
              is_system: true
            },
            completed_at: null,
            deleted_at: null
          }
        ])
      }

      return jsonResponse({})
    })
  )
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('app shell', () => {
  it('renders the capture route by default', async () => {
    renderWithRoute(['/'])

    expect(await screen.findByText('Tap to record')).toBeInTheDocument()
  })

  it('renders the tasks route', () => {
    renderWithRoute(['/tasks'])

    expect(screen.getByRole('heading', { name: 'Tasks' })).toBeInTheDocument()
  })

  it('fails closed when the tasks route is signed out', async () => {
    vi.stubGlobal(
      'fetch',
      vi.fn(() =>
        jsonResponse({
          signed_in: false,
          user: null,
          timezone: null,
          inbox_group_id: null,
          csrf_token: null
        })
      )
    )

    renderWithRoute(['/tasks'])

    expect(await screen.findByText('Session Required')).toBeInTheDocument()
  })

  it('shows an install CTA when the browser exposes the install prompt', async () => {
    const user = userEvent.setup()
    const prompt = vi.fn().mockResolvedValue(undefined)
    const userChoice = Promise.resolve({ outcome: 'accepted' as const, platform: 'web' })

    renderWithRoute(['/'])

    const installEvent = new Event('beforeinstallprompt') as BeforeInstallPromptEvent
    Object.assign(installEvent, { prompt, userChoice })
    await act(async () => {
      window.dispatchEvent(installEvent)
    })

    const installButton = await screen.findByRole('button', { name: 'Install Gust app' })
    await user.click(installButton)

    expect(prompt).toHaveBeenCalledTimes(1)
  })

  it('hides the install CTA after the appinstalled event fires', async () => {
    renderWithRoute(['/'])

    const installEvent = new Event('beforeinstallprompt') as BeforeInstallPromptEvent
    Object.assign(installEvent, {
      prompt: vi.fn().mockResolvedValue(undefined),
      userChoice: Promise.resolve({ outcome: 'accepted' as const, platform: 'web' })
    })
    await act(async () => {
      window.dispatchEvent(installEvent)
    })

    expect(await screen.findByRole('button', { name: 'Install Gust app' })).toBeInTheDocument()

    await act(async () => {
      window.dispatchEvent(new Event('appinstalled'))
    })

    await waitFor(() => {
      expect(screen.queryByRole('button', { name: 'Install Gust app' })).not.toBeInTheDocument()
    })
  })

  it('shows iPhone install instructions when no browser prompt is available', async () => {
    const user = userEvent.setup()
    setUserAgent('Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)')

    renderWithRoute(['/'])

    const installButton = await screen.findByRole('button', { name: 'Show iPhone install instructions' })
    await user.click(installButton)

    expect(screen.getByText(/Add to Home Screen/i)).toBeInTheDocument()
  })

  it('shows an update banner and reloads when a new service worker is ready', async () => {
    const user = userEvent.setup()
    mockNeedRefresh = true

    renderWithRoute(['/'])

    expect(await screen.findByText('Update ready')).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Update' }))

    expect(updateServiceWorkerMock).toHaveBeenCalledWith(true)
  })
})
