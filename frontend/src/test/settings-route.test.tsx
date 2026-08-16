import { render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppProviders } from '../providers'
import { SettingsRoute } from '../routes/SettingsRoute'
import {
  getNotificationSettings,
  getSessionStatus,
  type NotificationSettings,
} from '../lib/api'
import { signedInSession } from './session-fixtures'

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return {
    ...actual,
    getNotificationSettings: vi.fn(),
    getSessionStatus: vi.fn(),
  }
})

const mockedGetNotificationSettings = vi.mocked(getNotificationSettings)
const mockedGetSessionStatus = vi.mocked(getSessionStatus)

const settings: NotificationSettings = {
  email_daily_enabled: true,
  email_weekly_enabled: true,
  pushover_enabled: false,
  pushover_task_reminders_enabled: false,
  pushover_daily_digest_enabled: false,
  pushover_weekly_digest_enabled: false,
  date_only_reminder_time: '08:00:00',
  timezone: 'America/Toronto',
  pushover_connected: true,
  pushover_user_key_hint: '••••abcd',
  pushover_connection_error_code: null,
  pushover_available: true,
}

beforeEach(() => {
  mockedGetNotificationSettings.mockReset()
  mockedGetSessionStatus.mockReset()
  mockedGetNotificationSettings.mockResolvedValue(settings)
  mockedGetSessionStatus.mockResolvedValue(signedInSession())
})

afterEach(() => {
  vi.clearAllMocks()
})

describe('SettingsRoute', () => {
  it('confirms and consumes a successful Pushover callback result', async () => {
    const router = createMemoryRouter(
      [{ path: '/settings', element: <SettingsRoute /> }],
      { initialEntries: ['/settings?pushover=connected'] }
    )

    render(
      <AppProviders>
        <RouterProvider router={router} />
      </AppProviders>
    )

    expect(await screen.findByText('Pushover connected.')).toBeInTheDocument()
    await waitFor(() => expect(router.state.location.search).toBe(''))
    expect(mockedGetNotificationSettings).toHaveBeenCalled()
    expect(screen.getByText('Connected as ••••abcd')).toBeInTheDocument()
  })
})
