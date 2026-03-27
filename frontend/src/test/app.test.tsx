import { act, render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, vi } from 'vitest'

import { AppShell } from '../components/AppShell'
import { AppProviders } from '../providers'
import { CaptureRoute } from '../routes/CaptureRoute'
import { CompletedTasksRoute } from '../routes/CompletedTasksRoute'
import { DesktopModeRoute } from '../routes/DesktopModeRoute'
import { LoginRoute } from '../routes/LoginRoute'
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
        path: '/login',
        element: <LoginRoute />
      },
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
          },
          {
            path: 'desktop',
            element: <DesktopModeRoute />
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

  let isSignedIn = true
  vi.stubGlobal(
    'fetch',
    vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input)
      const method = init?.method ?? 'GET'

      if (url.includes('/auth/session/logout') && method === 'POST') {
        isSignedIn = false
        return jsonResponse({ signed_out: true })
      }

      if (url.includes('/auth/session')) {
        if (!isSignedIn) {
          return jsonResponse({
            signed_in: false,
            user: null,
            timezone: null,
            inbox_group_id: null,
            csrf_token: null
          })
        }
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

      if (url.includes('/tasks?status=completed')) {
        return jsonResponse({
          items: [
            {
              id: 'completed-1',
              title: 'Finished task',
              status: 'completed',
              needs_review: false,
              due_date: null,
              reminder_at: null,
              due_bucket: 'no_date',
              group: {
                id: 'inbox-1',
                name: 'Inbox',
                is_system: true
              },
              completed_at: '2026-03-26T15:00:00Z',
              deleted_at: null,
              recurrence_frequency: null
            }
          ],
          has_more: false,
          next_cursor: null
        })
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
  vi.unstubAllEnvs()
  vi.restoreAllMocks()
})

describe('app shell', () => {
  it('renders the capture route by default', async () => {
    renderWithRoute(['/'])

    expect(await screen.findByText('Tap to record')).toBeInTheDocument()
  })

  it('redirects signed-out protected routes to /login', async () => {
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

    expect(await screen.findByRole('link', { name: 'Sign in with Google' })).toBeInTheDocument()
  })

  it('shows Google sign-in and local fallback on /login in dev mode', async () => {
    vi.stubEnv('VITE_GUST_DEV_MODE', 'true')
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

    renderWithRoute(['/login'])

    expect(await screen.findByRole('link', { name: 'Sign in with Google' })).toBeInTheDocument()
    expect(
      screen.getByRole('button', { name: 'Continue with Local Test Account' })
    ).toBeInTheDocument()
  })

  it('shows Google-only sign-in on /login outside dev mode', async () => {
    vi.stubEnv('VITE_GUST_DEV_MODE', 'false')
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

    renderWithRoute(['/login'])

    expect(await screen.findByRole('link', { name: 'Sign in with Google' })).toBeInTheDocument()
    expect(
      screen.queryByRole('button', { name: 'Continue with Local Test Account' })
    ).not.toBeInTheDocument()
  })

  it('opens the account menu and navigates to desktop mode placeholder', async () => {
    renderWithRoute(['/'])

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Open account menu' }))
    await user.click(screen.getByRole('menuitem', { name: 'Desktop Mode' }))

    expect(await screen.findByRole('heading', { name: 'Desktop Mode' })).toBeInTheDocument()
  })

  it('navigates to all-group completed tasks from account menu', async () => {
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input)
      const method = init?.method ?? 'GET'
      if (url.includes('/auth/session/logout') && method === 'POST') {
        return jsonResponse({ signed_out: true })
      }
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
      if (url.includes('/tasks?status=completed')) {
        return jsonResponse({
          items: [],
          has_more: false,
          next_cursor: null
        })
      }
      if (url.includes('/tasks?')) {
        return jsonResponse([])
      }
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWithRoute(['/'])

    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Open account menu' }))
    await user.click(screen.getByRole('menuitem', { name: 'Completed Tasks' }))

    expect(await screen.findByText('No completed tasks here')).toBeInTheDocument()
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/tasks?status=completed'),
        expect.objectContaining({ credentials: 'include' })
      )
    })
  })

  it('logs out from the account menu and returns to login screen', async () => {
    let isSignedIn = true
    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input)
      const method = init?.method ?? 'GET'

      if (url.includes('/auth/session/logout') && method === 'POST') {
        isSignedIn = false
        return jsonResponse({ signed_out: true })
      }
      if (url.includes('/auth/session')) {
        if (!isSignedIn) {
          return jsonResponse({
            signed_in: false,
            user: null,
            timezone: null,
            inbox_group_id: null,
            csrf_token: null
          })
        }
        return jsonResponse({
          signed_in: true,
          user: { id: 'user-1', email: 'user@example.com', display_name: 'Gust User' },
          timezone: 'UTC',
          inbox_group_id: 'inbox-1',
          csrf_token: 'csrf-token'
        })
      }
      if (url.includes('/groups')) {
        return jsonResponse([])
      }
      if (url.includes('/tasks?')) {
        return jsonResponse([])
      }
      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWithRoute(['/'])
    const user = userEvent.setup()
    await user.click(await screen.findByRole('button', { name: 'Open account menu' }))
    await user.click(screen.getByRole('menuitem', { name: 'Logout' }))

    expect(await screen.findByRole('link', { name: 'Sign in with Google' })).toBeInTheDocument()
    await waitFor(() => {
      expect(fetchMock).toHaveBeenCalledWith(
        expect.stringContaining('/auth/session/logout'),
        expect.objectContaining({
          method: 'POST',
          credentials: 'include'
        })
      )
    })
  })

  it('clears cached app data on logout so the next user sees their own tasks', async () => {
    vi.stubEnv('VITE_GUST_DEV_MODE', 'true')
    let userKey: 'a' | 'b' = 'a'
    let signedIn = true

    const fetchMock = vi.fn((input: RequestInfo | URL, init?: RequestInit) => {
      const url = requestUrl(input)
      const method = init?.method ?? 'GET'

      if (url.includes('/auth/session/logout') && method === 'POST') {
        signedIn = false
        return jsonResponse({ signed_out: true })
      }

      if (url.includes('/auth/session/dev-login') && method === 'POST') {
        userKey = 'b'
        signedIn = true
        return jsonResponse({
          signed_in: true,
          user: {
            id: 'user-b',
            email: 'user-b@example.com',
            display_name: 'User B'
          },
          timezone: 'UTC',
          inbox_group_id: 'inbox-b',
          csrf_token: 'csrf-token-b'
        })
      }

      if (url.includes('/auth/session')) {
        if (!signedIn) {
          return jsonResponse({
            signed_in: false,
            user: null,
            timezone: null,
            inbox_group_id: null,
            csrf_token: null
          })
        }
        if (userKey === 'a') {
          return jsonResponse({
            signed_in: true,
            user: {
              id: 'user-a',
              email: 'user-a@example.com',
              display_name: 'User A'
            },
            timezone: 'UTC',
            inbox_group_id: 'inbox-a',
            csrf_token: 'csrf-token-a'
          })
        }
        return jsonResponse({
          signed_in: true,
          user: {
            id: 'user-b',
            email: 'user-b@example.com',
            display_name: 'User B'
          },
          timezone: 'UTC',
          inbox_group_id: 'inbox-b',
          csrf_token: 'csrf-token-b'
        })
      }

      if (url.includes('/groups')) {
        if (userKey === 'a') {
          return jsonResponse([
            {
              id: 'inbox-a',
              name: 'Inbox',
              description: null,
              is_system: true,
              system_key: 'inbox',
              open_task_count: 1
            }
          ])
        }
        return jsonResponse([
          {
            id: 'inbox-b',
            name: 'Inbox',
            description: null,
            is_system: true,
            system_key: 'inbox',
            open_task_count: 1
          }
        ])
      }

      if (url.includes('/tasks?status=open') && userKey === 'a') {
        return jsonResponse({
          items: [
            {
              id: 'task-a',
              title: 'Task for user A',
              status: 'open',
              needs_review: false,
              due_date: null,
              reminder_at: null,
              due_bucket: 'no_date',
              group: {
                id: 'inbox-a',
                name: 'Inbox',
                is_system: true
              },
              completed_at: null,
              deleted_at: null,
              subtask_count: 0
            }
          ],
          has_more: false,
          next_cursor: null
        })
      }

      if (url.includes('/tasks?status=open') && userKey === 'b') {
        return jsonResponse({
          items: [
            {
              id: 'task-b',
              title: 'Task for user B',
              status: 'open',
              needs_review: false,
              due_date: null,
              reminder_at: null,
              due_bucket: 'no_date',
              group: {
                id: 'inbox-b',
                name: 'Inbox',
                is_system: true
              },
              completed_at: null,
              deleted_at: null,
              subtask_count: 0
            }
          ],
          has_more: false,
          next_cursor: null
        })
      }

      if (url.includes('/tasks?')) {
        return jsonResponse([])
      }

      return jsonResponse({})
    })
    vi.stubGlobal('fetch', fetchMock)

    renderWithRoute(['/tasks'])

    expect(await screen.findByText('Task for user A')).toBeInTheDocument()

    const user = userEvent.setup()
    await user.click(screen.getByRole('button', { name: 'Open account menu' }))
    await user.click(screen.getByRole('menuitem', { name: 'Logout' }))
    expect(await screen.findByRole('link', { name: 'Sign in with Google' })).toBeInTheDocument()

    await user.click(screen.getByRole('button', { name: 'Continue with Local Test Account' }))

    await user.click(await screen.findByRole('link', { name: 'Tasks' }))
    expect(await screen.findByText('Task for user B')).toBeInTheDocument()
    expect(screen.queryByText('Task for user A')).not.toBeInTheDocument()
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

    const installButton = await screen.findByRole('button', {
      name: 'Show iPhone install instructions'
    })
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
