import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AppProviders } from '../providers'
import { AgentAccessSection } from '../components/settings/AgentAccessSection'
import { museSetupMessage } from '../lib/agentAccess'
import {
  ApiError,
  createAgentToken,
  getAgentAccess,
  getAgentActivity,
  getSessionStatus,
  revokeAgentToken,
  updateAgentAccess,
  type AgentAccess,
  type AgentToken,
} from '../lib/api'
import { signedInSession } from './session-fixtures'

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return {
    ...actual,
    createAgentToken: vi.fn(),
    getAgentAccess: vi.fn(),
    getAgentActivity: vi.fn(),
    getSessionStatus: vi.fn(),
    revokeAgentToken: vi.fn(),
    updateAgentAccess: vi.fn(),
  }
})

const mocked = {
  createAgentToken: vi.mocked(createAgentToken),
  getAgentAccess: vi.mocked(getAgentAccess),
  getAgentActivity: vi.mocked(getAgentActivity),
  getSessionStatus: vi.mocked(getSessionStatus),
  revokeAgentToken: vi.mocked(revokeAgentToken),
  updateAgentAccess: vi.mocked(updateAgentAccess),
}

const ENDPOINT = 'https://api.gustapp.ca/mcp'
const SECRET = `gust_mcp_${'A'.repeat(43)}`

function token(overrides: Partial<AgentToken> = {}): AgentToken {
  return {
    id: 'token-1',
    name: 'Muse',
    token_prefix: 'gust_mcp_AAAA',
    access_level: 'read',
    created_at: '2026-11-07T12:00:00Z',
    expires_at: '2027-02-05T12:00:00Z',
    last_used_at: null,
    ...overrides,
  }
}

function access(overrides: Partial<AgentAccess> = {}): AgentAccess {
  return {
    available: true,
    enabled: true,
    endpoint_url: ENDPOINT,
    max_active_tokens: 5,
    expiry_day_choices: [30, 90, 365],
    tokens: [],
    ...overrides,
  }
}

function renderSection() {
  return render(
    <AppProviders>
      <AgentAccessSection />
    </AppProviders>
  )
}

beforeEach(() => {
  mocked.getSessionStatus.mockResolvedValue(signedInSession())
  mocked.getAgentActivity.mockResolvedValue({ items: [] })
})

afterEach(() => {
  vi.clearAllMocks()
  vi.restoreAllMocks()
})

describe('AgentAccessSection', () => {
  it('stays hidden when the server does not offer agent access', async () => {
    mocked.getAgentAccess.mockResolvedValue(access({ available: false, enabled: false, endpoint_url: null }))
    renderSection()
    await waitFor(() => expect(mocked.getAgentAccess).toHaveBeenCalled())
    expect(screen.queryByText('Agent access (MCP)')).not.toBeInTheDocument()
  })

  it('stays hidden when an older backend has no agent access route', async () => {
    mocked.getAgentAccess.mockRejectedValue(new ApiError('Not Found', 'request_failed', 404))
    renderSection()
    await waitFor(() => expect(mocked.getAgentAccess).toHaveBeenCalled())
    expect(screen.queryByText('Agent access (MCP)')).not.toBeInTheDocument()
    expect(screen.queryByText('Could not load agent access settings.')).not.toBeInTheDocument()
  })

  it('turns agent access on with the CSRF token', async () => {
    const user = userEvent.setup()
    mocked.getAgentAccess.mockResolvedValue(access({ enabled: false }))
    mocked.updateAgentAccess.mockResolvedValue(access({ enabled: true }))
    renderSection()

    await user.click(await screen.findByRole('switch', { name: 'Allow agent access' }))

    await waitFor(() => expect(mocked.updateAgentAccess).toHaveBeenCalledWith(true, 'csrf-token'))
    expect(await screen.findByText('No active tokens.')).toBeInTheDocument()
    expect(screen.getByText(ENDPOINT)).toBeInTheDocument()
  })

  it('asks before turning access off when tokens exist', async () => {
    const user = userEvent.setup()
    mocked.getAgentAccess.mockResolvedValue(access({ tokens: [token()] }))
    const confirm = vi.spyOn(window, 'confirm').mockReturnValue(false)
    renderSection()

    await user.click(await screen.findByRole('switch', { name: 'Allow agent access' }))

    expect(confirm).toHaveBeenCalledWith('Turn off agent access? This revokes every agent token.')
    expect(mocked.updateAgentAccess).not.toHaveBeenCalled()
  })

  it('generates a token and shows it once with the Muse setup message', async () => {
    const user = userEvent.setup()
    mocked.getAgentAccess.mockResolvedValue(access())
    mocked.createAgentToken.mockResolvedValue({ token: token({ access_level: 'read_write' }), secret: SECRET })
    renderSection()

    await user.click(await screen.findByRole('button', { name: /Generate token/ }))
    const dialog = await screen.findByRole('dialog')
    await user.click(within(dialog).getByRole('radio', { name: 'Read & write' }))
    await user.click(within(dialog).getByRole('button', { name: /Generate token/ }))

    await waitFor(() =>
      expect(mocked.createAgentToken).toHaveBeenCalledWith(
        { name: 'Muse', access_level: 'read_write', expires_in_days: 90 },
        'csrf-token'
      )
    )
    expect(await within(dialog).findByText(SECRET)).toBeInTheDocument()
    expect(within(dialog).getByText(museSetupMessage(ENDPOINT))).toBeInTheDocument()
    expect(within(dialog).getByText(/Gust shows this token once/)).toBeInTheDocument()

    await user.click(within(dialog).getByRole('button', { name: 'Done' }))
    await waitFor(() => expect(screen.queryByText(SECRET)).not.toBeInTheDocument())
    // The new token is listed by name and prefix only.
    expect(screen.getByText('gust_mcp_AAAA…')).toBeInTheDocument()
    expect(screen.getByText('Read & write')).toBeInTheDocument()
  })

  it('revokes a token after confirming', async () => {
    const user = userEvent.setup()
    mocked.getAgentAccess.mockResolvedValue(access({ tokens: [token({ last_used_at: '2026-11-07T13:00:00Z' })] }))
    mocked.revokeAgentToken.mockResolvedValue(undefined)
    vi.spyOn(window, 'confirm').mockReturnValue(true)
    renderSection()

    expect(await screen.findByText(/Last used/)).toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Revoke Muse' }))

    await waitFor(() => expect(mocked.revokeAgentToken).toHaveBeenCalledWith('token-1', 'csrf-token'))
    expect(await screen.findByText('No active tokens.')).toBeInTheDocument()
  })

  it('disables generating past the active token limit', async () => {
    const tokens = Array.from({ length: 5 }, (_, index) => token({ id: `token-${index}`, name: `Muse ${index}` }))
    mocked.getAgentAccess.mockResolvedValue(access({ tokens }))
    renderSection()

    expect(await screen.findByRole('button', { name: /Generate token/ })).toBeDisabled()
    expect(screen.getByText('You have 5 active tokens. Revoke one to make another.')).toBeInTheDocument()
  })

  it('lists recent agent activity', async () => {
    mocked.getAgentAccess.mockResolvedValue(access({ tokens: [token()] }))
    mocked.getAgentActivity.mockResolvedValue({
      items: [
        { id: 'a1', tool_name: 'create_task', outcome: 'ok', error_code: null, target_type: 'task', target_id: 't1', target_label: 'Buy milk', target_count: 1, token_name: 'Muse', created_at: '2026-11-07T14:00:00Z' },
        { id: 'a2', tool_name: 'create_tasks', outcome: 'ok', error_code: null, target_type: 'task', target_id: null, target_label: null, target_count: 3, token_name: 'Muse', created_at: '2026-11-07T13:00:00Z' },
        { id: 'a3', tool_name: 'delete_group', outcome: 'denied', error_code: 'read_only_token', target_type: null, target_id: null, target_label: null, target_count: 0, token_name: 'Muse', created_at: '2026-11-07T12:00:00Z' },
      ],
    })
    renderSection()

    const list = await screen.findByRole('list', { name: 'Recent agent activity' })
    expect(within(list).getByText('Created task: Buy milk')).toBeInTheDocument()
    expect(within(list).getByText('Created tasks (3)')).toBeInTheDocument()
    expect(within(list).getByText('Blocked')).toBeInTheDocument()
  })
})
