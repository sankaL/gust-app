import { useId, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bot, Copy, KeyRound, Plus, Trash2 } from 'lucide-react'

import { Button } from '../Button'
import { useNotifications } from '../Notifications'
import { BottomSheet, SheetHeader } from '../ui/BottomSheet'
import { Chip, InlineNotice, SegmentedControl, Switch } from '../ui/controls'
import { SettingsCard } from './SettingsCard'
import { museSetupMessage } from '../../lib/agentAccess'
import {
  ApiError,
  createAgentToken,
  getAgentAccess,
  getAgentActivity,
  getSessionStatus,
  revokeAgentToken,
  updateAgentAccess,
  type AgentAccess,
  type AgentAccessLevel,
  type AgentActivityItem,
  type AgentToken,
  type CreatedAgentToken,
} from '../../lib/api'

const AGENT_ACCESS_KEY = ['agent-access'] as const
const AGENT_ACTIVITY_KEY = ['agent-access-activity'] as const
const DEFAULT_TOKEN_NAME = 'Muse'
const DEFAULT_EXPIRY_DAYS = '90'
const CARD_TITLE = 'Agent access (MCP)'

const ACCESS_LABELS: Record<AgentAccessLevel, string> = { read: 'Read only', read_write: 'Read & write' }
const ACCESS_HELP: Record<AgentAccessLevel, string> = {
  read: 'The agent can look at tasks and groups but cannot change anything.',
  read_write: 'The agent can create, edit, complete and delete tasks, subtasks and groups. Changes go straight in.',
}
const EXPIRY_LABELS: Record<number, string> = { 30: '30 days', 90: '90 days', 365: '1 year' }

const TOOL_LABELS: Record<string, string> = {
  create_task: 'Created task',
  create_tasks: 'Created tasks',
  update_task: 'Updated task',
  complete_task: 'Completed task',
  reopen_task: 'Reopened task',
  restore_task: 'Restored task',
  delete_task: 'Deleted task',
  add_subtask: 'Added subtask',
  update_subtask: 'Updated subtask',
  delete_subtask: 'Deleted subtask',
  create_group: 'Created group',
  update_group: 'Updated group',
  delete_group: 'Deleted group',
}

const dateFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
const dateTimeFormatter = new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })

function formatDate(value: string) {
  return dateFormatter.format(new Date(value))
}

function formatDateTime(value: string) {
  return dateTimeFormatter.format(new Date(value))
}

function errorMessage(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback
}

function useCsrfToken() {
  const sessionQuery = useQuery({ queryKey: ['session'], queryFn: getSessionStatus })
  return sessionQuery.data?.csrf_token ?? ''
}

function useAgentAccessMutations(csrfToken: string) {
  const queryClient = useQueryClient()
  const { notifyError, notifySuccess } = useNotifications()
  const setEnabled = useMutation({
    mutationFn: (enabled: boolean) => updateAgentAccess(enabled, csrfToken),
    onSuccess: (next) => {
      queryClient.setQueryData(AGENT_ACCESS_KEY, next)
      notifySuccess(next.enabled ? 'Agent access turned on.' : 'Agent access turned off. Every agent token was revoked.')
    },
    onError: (error) => notifyError(errorMessage(error, 'Could not change agent access.')),
  })
  const revoke = useMutation({
    mutationFn: (tokenId: string) => revokeAgentToken(tokenId, csrfToken),
    onSuccess: (_result, tokenId) => {
      queryClient.setQueryData<AgentAccess>(AGENT_ACCESS_KEY, (current) => current ? { ...current, tokens: current.tokens.filter((token) => token.id !== tokenId) } : current)
      notifySuccess('Token revoked. It stops working on its next request.')
    },
    onError: (error) => notifyError(errorMessage(error, 'Could not revoke that token.')),
  })
  const addToken = (created: CreatedAgentToken) => {
    queryClient.setQueryData<AgentAccess>(AGENT_ACCESS_KEY, (current) => current ? { ...current, tokens: [created.token, ...current.tokens] } : current)
  }
  return { setEnabled, revoke, addToken }
}

export function AgentAccessSection() {
  const accessQuery = useQuery({ queryKey: AGENT_ACCESS_KEY, queryFn: getAgentAccess })
  const csrfToken = useCsrfToken()

  // A 404 means a backend without agent access (for example while a deploy rolls out): hide.
  if (accessQuery.error instanceof ApiError && accessQuery.error.status === 404) return null
  if (accessQuery.isError) {
    return (
      <SettingsCard icon={Bot} title={CARD_TITLE}>
        <InlineNotice tone="warning" role="alert" action={<Button variant="primary" size="sm" onClick={() => void accessQuery.refetch()} disabled={accessQuery.isFetching}>{accessQuery.isFetching ? 'Retrying…' : 'Try again'}</Button>}>
          Could not load agent access settings.
        </InlineNotice>
      </SettingsCard>
    )
  }
  // Hidden until the server says agent access exists. Fails closed while loading.
  if (!accessQuery.data?.available) return null
  return <AgentAccessCard access={accessQuery.data} csrfToken={csrfToken} />
}

function AgentAccessCard({ access, csrfToken }: { access: AgentAccess; csrfToken: string }) {
  const [sheetOpen, setSheetOpen] = useState(false)
  const { setEnabled, revoke, addToken } = useAgentAccessMutations(csrfToken)

  const onToggle = (enabled: boolean) => {
    if (!enabled && access.tokens.length > 0 && !window.confirm('Turn off agent access? This revokes every agent token.')) return
    setEnabled.mutate(enabled)
  }

  return (
    <SettingsCard icon={Bot} title={CARD_TITLE}>
      <p className="font-body text-sm leading-6 text-on-surface-variant">
        Let an AI agent you use, such as Meta Muse, read and change your tasks, subtasks and groups. A token works only for your account. Task details you share pass through that agent's provider.
      </p>
      <Switch label="Allow agent access" checked={access.enabled} disabled={setEnabled.isPending || !csrfToken} onChange={onToggle} />
      {access.enabled ? (
        <>
          {access.endpoint_url ? <CopyField label="MCP server URL" value={access.endpoint_url} /> : null}
          <AgentTokenList
            access={access}
            canCreate={Boolean(csrfToken)}
            revoking={revoke.isPending}
            onGenerate={() => setSheetOpen(true)}
            onRevoke={(token) => revoke.mutate(token.id)}
          />
          <AgentActivityList />
        </>
      ) : null}
      <GenerateTokenSheet open={sheetOpen} onClose={() => setSheetOpen(false)} access={access} csrfToken={csrfToken} onCreated={addToken} />
    </SettingsCard>
  )
}

function AgentTokenList({ access, canCreate, revoking, onGenerate, onRevoke }: {
  access: AgentAccess
  canCreate: boolean
  revoking: boolean
  onGenerate: () => void
  onRevoke: (token: AgentToken) => void
}) {
  const atLimit = access.tokens.length >= access.max_active_tokens
  const confirmRevoke = (token: AgentToken) => {
    if (window.confirm(`Revoke “${token.name}”? Any agent using it loses access.`)) onRevoke(token)
  }
  return (
    <div className="space-y-2">
      <div className="flex items-center justify-between gap-2">
        <h3 className="font-body text-sm font-semibold text-on-surface">Tokens</h3>
        <Button variant="soft" size="sm" onClick={onGenerate} disabled={atLimit || !canCreate}><Plus className="h-4 w-4" />Generate token</Button>
      </div>
      {atLimit ? <p className="font-body text-xs text-on-surface-variant">You have {access.max_active_tokens} active tokens. Revoke one to make another.</p> : null}
      {access.tokens.length === 0 ? (
        <p className="font-body text-sm text-on-surface-variant">No active tokens.</p>
      ) : (
        <ul className="space-y-2" aria-label="Agent tokens">
          {access.tokens.map((token) => <AgentTokenRow key={token.id} token={token} revoking={revoking} onRevoke={confirmRevoke} />)}
        </ul>
      )}
    </div>
  )
}

function AgentTokenRow({ token, revoking, onRevoke }: { token: AgentToken; revoking: boolean; onRevoke: (token: AgentToken) => void }) {
  const usage = token.last_used_at ? `Last used ${formatDateTime(token.last_used_at)}` : 'Never used'
  return (
    <li className="flex items-start justify-between gap-3 rounded-card bg-surface-container-high px-4 py-3 ring-1 ring-inset ring-outline/50">
      <div className="min-w-0 space-y-1">
        <div className="flex flex-wrap items-center gap-2">
          <span className="font-body text-sm font-semibold text-on-surface">{token.name}</span>
          <Chip tone={token.access_level === 'read_write' ? 'amber' : 'neutral'}>{ACCESS_LABELS[token.access_level]}</Chip>
        </div>
        <p className="font-mono text-xs text-on-surface-variant">{token.token_prefix}…</p>
        <p className="font-body text-xs text-on-surface-variant">{usage} · Expires {formatDate(token.expires_at)}</p>
      </div>
      <Button variant="ghost" size="sm" className="!text-tertiary" onClick={() => onRevoke(token)} disabled={revoking} aria-label={`Revoke ${token.name}`}><Trash2 className="h-4 w-4" />Revoke</Button>
    </li>
  )
}

function CopyField({ label, value, mono = true }: { label: string; value: string; mono?: boolean }) {
  const { notifyError, notifySuccess } = useNotifications()
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(value)
      notifySuccess(`${label} copied.`)
    } catch {
      notifyError('Could not copy. Select the text and copy it manually.')
    }
  }
  return (
    <div className="space-y-1.5">
      <p className="font-body text-xs font-semibold uppercase tracking-[0.12em] text-on-surface-variant">{label}</p>
      <div className="flex items-start gap-2 rounded-card bg-surface-dim px-3 py-2.5 ring-1 ring-inset ring-outline/50">
        <p className={`min-w-0 flex-1 select-all break-all text-sm text-on-surface ${mono ? 'font-mono' : 'font-body leading-6'}`}>{value}</p>
        <Button variant="ghost" size="sm" onClick={() => void copy()} aria-label={`Copy ${label}`}><Copy className="h-4 w-4" /></Button>
      </div>
    </div>
  )
}

function GenerateTokenSheet({ open, onClose, access, csrfToken, onCreated }: {
  open: boolean
  onClose: () => void
  access: AgentAccess
  csrfToken: string
  onCreated: (created: CreatedAgentToken) => void
}) {
  const titleId = useId()
  // The plaintext token lives only here, in memory, until the sheet closes.
  const [created, setCreated] = useState<CreatedAgentToken | null>(null)
  const [pending, setPending] = useState(false)
  const close = () => {
    setCreated(null)
    onClose()
  }
  return (
    <BottomSheet
      open={open}
      onClose={close}
      labelledBy={titleId}
      size="auto"
      dismissible={!pending}
      header={<SheetHeader eyebrow="Agent access" title={created ? 'Copy your token' : 'Generate token'} titleId={titleId} onClose={close} />}
    >
      {created ? (
        <TokenReveal created={created} endpointUrl={access.endpoint_url} onDone={close} />
      ) : (
        <TokenForm
          expiryChoices={access.expiry_day_choices}
          csrfToken={csrfToken}
          onPendingChange={setPending}
          onCreated={(result) => {
            setCreated(result)
            onCreated(result)
          }}
        />
      )}
    </BottomSheet>
  )
}

function TokenForm({ expiryChoices, csrfToken, onPendingChange, onCreated }: {
  expiryChoices: number[]
  csrfToken: string
  onPendingChange: (pending: boolean) => void
  onCreated: (created: CreatedAgentToken) => void
}) {
  const { notifyError } = useNotifications()
  const [name, setName] = useState(DEFAULT_TOKEN_NAME)
  const [accessLevel, setAccessLevel] = useState<AgentAccessLevel>('read')
  const [expiry, setExpiry] = useState(DEFAULT_EXPIRY_DAYS)
  const create = useMutation({
    mutationFn: () => createAgentToken({ name: name.trim(), access_level: accessLevel, expires_in_days: Number(expiry) }, csrfToken),
    onMutate: () => onPendingChange(true),
    onSettled: () => onPendingChange(false),
    onSuccess: onCreated,
    onError: (error) => notifyError(errorMessage(error, 'Could not create a token.')),
  })
  const expiryOptions = expiryChoices.map((days) => ({ value: String(days), label: EXPIRY_LABELS[days] ?? `${days} days` }))
  const canSubmit = !create.isPending && name.trim().length > 0

  return (
    <form
      className="space-y-4 px-5 pb-6"
      onSubmit={(event) => {
        event.preventDefault()
        if (canSubmit) create.mutate()
      }}
    >
      <label className="block space-y-1.5">
        <span className="font-body text-sm font-semibold text-on-surface">Name</span>
        <input
          value={name}
          maxLength={60}
          onChange={(event) => setName(event.target.value)}
          className="h-11 w-full rounded-pill bg-surface-dim px-4 text-sm text-on-surface outline-none ring-1 ring-inset ring-outline/50 focus:ring-2 focus:ring-primary/60"
        />
      </label>
      <SegmentedControl
        label="Access"
        value={accessLevel}
        onChange={setAccessLevel}
        options={[{ value: 'read', label: ACCESS_LABELS.read }, { value: 'read_write', label: ACCESS_LABELS.read_write }]}
      />
      <p className="font-body text-xs leading-5 text-on-surface-variant">{ACCESS_HELP[accessLevel]}</p>
      <SegmentedControl label="Expires after" value={expiry} onChange={setExpiry} options={expiryOptions} />
      <Button type="submit" variant="primary" fullWidth disabled={!canSubmit}>
        <KeyRound className="h-4 w-4" />{create.isPending ? 'Generating…' : 'Generate token'}
      </Button>
    </form>
  )
}

function TokenReveal({ created, endpointUrl, onDone }: { created: CreatedAgentToken; endpointUrl: string | null; onDone: () => void }) {
  return (
    <div className="space-y-4 px-5 pb-6">
      <InlineNotice tone="warning" role="status">
        Gust shows this token once. Store it in your agent's secure credential prompt. Do not paste it into a chat.
      </InlineNotice>
      <CopyField label="Token" value={created.secret} />
      {endpointUrl ? <CopyField label="MCP server URL" value={endpointUrl} /> : null}
      {endpointUrl ? <CopyField label="Message for Muse" value={museSetupMessage(endpointUrl)} mono={false} /> : null}
      <Button variant="primary" fullWidth onClick={onDone}>Done</Button>
    </div>
  )
}

function AgentActivityList() {
  const activityQuery = useQuery({ queryKey: AGENT_ACTIVITY_KEY, queryFn: getAgentActivity })
  if (activityQuery.isError) return <p className="font-body text-xs text-on-surface-variant">Could not load recent agent activity.</p>
  const items = activityQuery.data?.items ?? []
  if (items.length === 0) return null
  return (
    <div className="space-y-2">
      <h3 className="font-body text-sm font-semibold text-on-surface">Recent agent activity</h3>
      <ul className="space-y-1.5" aria-label="Recent agent activity">
        {items.map((item) => <AgentActivityRow key={item.id} item={item} />)}
      </ul>
    </div>
  )
}

function AgentActivityRow({ item }: { item: AgentActivityItem }) {
  return (
    <li className="flex items-start justify-between gap-3 font-body text-sm">
      <span className="min-w-0 text-on-surface">
        {activityLabel(item)}
        {item.outcome === 'ok' ? null : <Chip tone={item.outcome === 'denied' ? 'amber' : 'rose'} className="ml-2">{item.outcome === 'denied' ? 'Blocked' : 'Failed'}</Chip>}
      </span>
      <span className="shrink-0 text-xs text-on-surface-variant">{formatDateTime(item.created_at)}</span>
    </li>
  )
}

function activityLabel(item: AgentActivityItem) {
  const action = TOOL_LABELS[item.tool_name] ?? item.tool_name
  if (item.tool_name === 'create_tasks' && item.target_count > 0) return `${action} (${item.target_count})`
  return item.target_label ? `${action}: ${item.target_label}` : action
}
