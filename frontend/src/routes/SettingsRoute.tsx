import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, Check, KeyRound, Mail, Send, Unplug } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'

import { useNotifications } from '../components/Notifications'
import {
  connectPushover,
  disconnectPushover,
  getNotificationSettings,
  getSessionStatus,
  savePushoverKey,
  testPushover,
  updateNotificationSettings,
  type NotificationSettings,
} from '../lib/api'

function Toggle({ label, checked, disabled, onChange }: { label: string; checked: boolean; disabled?: boolean; onChange: (checked: boolean) => void }) {
  return <label className="flex min-h-12 cursor-pointer items-center justify-between gap-4 rounded-card bg-surface-container-highest/70 px-4 py-2 font-body text-sm font-medium text-on-surface transition-colors duration-150 hover:bg-surface-bright focus-within:ring-2 focus-within:ring-primary/70 has-[:disabled]:cursor-not-allowed has-[:disabled]:opacity-60"><span>{label}</span><span className="relative inline-flex h-7 w-12 shrink-0"><input aria-label={label} role="switch" type="checkbox" className="peer sr-only" checked={checked} disabled={disabled} onChange={(event) => onChange(event.target.checked)} /><span aria-hidden="true" className="absolute inset-0 rounded-full border border-outline bg-surface-dim transition-colors duration-150 peer-checked:border-primary peer-checked:bg-primary-dim peer-disabled:bg-surface-container" /><span aria-hidden="true" className="absolute left-1 top-1 h-5 w-5 rounded-full bg-on-surface shadow-sm transition-transform duration-150 peer-checked:translate-x-5" /></span></label>
}

export function SettingsRoute() {
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { notifyError, notifySuccess } = useNotifications()
  const [manualKey, setManualKey] = useState('')
  const hasHandledPushoverCallback = useRef(false)
  const { data: settings, refetch: refetchSettings } = useQuery({
    queryKey: ['notification-settings'],
    queryFn: getNotificationSettings,
  })
  const sessionQuery = useQuery({ queryKey: ['session'], queryFn: getSessionStatus })
  const csrfToken = sessionQuery.data?.csrf_token

  useEffect(() => {
    if (new URLSearchParams(location.search).get('pushover') !== 'connected') {
      hasHandledPushoverCallback.current = false
      return
    }
    if (hasHandledPushoverCallback.current) return

    hasHandledPushoverCallback.current = true
    void refetchSettings()
    notifySuccess('Pushover connected.')
    const searchParams = new URLSearchParams(location.search)
    searchParams.delete('pushover')
    void navigate(
      {
        pathname: location.pathname,
        search: searchParams.size > 0 ? `?${searchParams.toString()}` : '',
      },
      { replace: true }
    )
  }, [location.pathname, location.search, navigate, notifySuccess, refetchSettings])
  const save = useMutation({
    mutationFn: (payload: Partial<NotificationSettings>) => updateNotificationSettings(payload, csrfToken ?? ''),
    onSuccess: (next) => { queryClient.setQueryData(['notification-settings'], next); notifySuccess('Notification settings saved.') },
    onError: () => notifyError('Could not save notification settings.'),
  })
  const keySave = useMutation({
    mutationFn: () => savePushoverKey(manualKey, csrfToken ?? ''),
    onSuccess: (next) => { queryClient.setQueryData(['notification-settings'], next); setManualKey(''); notifySuccess('Pushover connected.') },
    onError: () => notifyError('Pushover could not verify that user key.'),
  })
  const disconnect = useMutation({
    mutationFn: () => disconnectPushover(csrfToken ?? ''),
    onSuccess: (next) => { queryClient.setQueryData(['notification-settings'], next); notifySuccess('Pushover disconnected.') },
    onError: () => notifyError('Could not disconnect Pushover.'),
  })
  const sendTest = useMutation({ mutationFn: () => testPushover(csrfToken ?? ''), onSuccess: () => notifySuccess('Test notification sent.'), onError: () => notifyError('Could not send a test notification.') })

  const update = (payload: Partial<NotificationSettings>) => save.mutate(payload)
  const connect = async () => {
    try {
      const returnPath = location.pathname.startsWith('/desktop') ? '/desktop/settings' : '/settings'
      const result = await connectPushover(csrfToken ?? '', returnPath)
      window.location.assign(result.subscription_url)
    } catch { notifyError('Could not start Pushover connection.') }
  }

  if (!settings) return <section className="py-8" aria-busy="true"><p className="font-body text-sm text-on-surface-variant">Loading settings…</p></section>
  const connectedAndEnabled = settings.pushover_connected && settings.pushover_enabled
  return <section className="mx-auto max-w-2xl space-y-6 pb-8"><header><p className="font-body text-xs font-semibold uppercase tracking-[0.16em] text-primary">Account</p><h1 className="font-display text-3xl text-on-surface">Notification settings</h1><p className="mt-2 font-body text-sm leading-6 text-on-surface-variant">Digest schedules use Eastern time. Your date-only reminders use {settings.timezone}.</p></header>
    <section className="space-y-3 rounded-card bg-surface-container p-4 shadow-ambient"><div className="flex items-center gap-2"><Mail className="h-4 w-4 text-primary" /><h2 className="font-display text-xl">Email</h2></div><Toggle label="Daily brief email" checked={settings.email_daily_enabled} onChange={(email_daily_enabled) => update({ email_daily_enabled })} /><Toggle label="Weekly summary email" checked={settings.email_weekly_enabled} onChange={(email_weekly_enabled) => update({ email_weekly_enabled })} /></section>
    <section className="space-y-3 rounded-card bg-surface-container p-4 shadow-ambient"><div className="flex items-center gap-2"><Bell className="h-4 w-4 text-primary" /><h2 className="font-display text-xl">Pushover</h2></div>{!settings.pushover_available ? <p className="font-body text-sm text-on-surface-variant">Pushover is not available in this environment.</p> : !settings.pushover_connected ? <><p className="font-body text-sm leading-6 text-on-surface-variant">Pushover has its own trial and license terms. Connect your personal account to choose where Gust sends notifications.</p><button type="button" onClick={() => void connect()} className="inline-flex min-h-11 items-center gap-2 rounded-pill bg-primary px-4 font-body text-sm font-semibold text-surface"><Bell className="h-4 w-4" />Connect Pushover</button><details className="rounded-soft bg-surface-container-high p-3"><summary className="cursor-pointer font-body text-sm text-on-surface">Enter user key manually</summary><div className="mt-3 flex gap-2"><input aria-label="Pushover user key" value={manualKey} onChange={(event) => setManualKey(event.target.value)} className="min-w-0 flex-1 rounded-soft border border-outline bg-surface px-3 text-sm text-on-surface" /><button type="button" disabled={keySave.isPending} onClick={() => keySave.mutate()} className="min-h-11 rounded-pill bg-surface-container-highest px-4 text-sm text-on-surface"><KeyRound className="inline h-4 w-4" /> Save</button></div></details></> : <><p className="font-body text-sm text-on-surface-variant">Connected as {settings.pushover_user_key_hint}</p><Toggle label="Pushover notifications" checked={settings.pushover_enabled} onChange={(pushover_enabled) => update({ pushover_enabled })} /><Toggle label="Task reminders" checked={settings.pushover_task_reminders_enabled} disabled={!connectedAndEnabled} onChange={(pushover_task_reminders_enabled) => update({ pushover_task_reminders_enabled })} /><Toggle label="Daily brief" checked={settings.pushover_daily_digest_enabled} disabled={!connectedAndEnabled} onChange={(pushover_daily_digest_enabled) => update({ pushover_daily_digest_enabled })} /><Toggle label="Weekly summary" checked={settings.pushover_weekly_digest_enabled} disabled={!connectedAndEnabled} onChange={(pushover_weekly_digest_enabled) => update({ pushover_weekly_digest_enabled })} />{connectedAndEnabled && settings.pushover_task_reminders_enabled ? <label className="flex items-center justify-between rounded-soft bg-surface-container px-4 py-3 text-sm"><span>Date-only reminder time</span><input aria-label="Date-only reminder time" type="time" value={settings.date_only_reminder_time.slice(0, 5)} onChange={(event) => update({ date_only_reminder_time: event.target.value })} className="rounded bg-surface px-2 py-1 text-on-surface" /></label> : null}<div className="flex flex-wrap gap-2"><button type="button" onClick={() => sendTest.mutate()} disabled={!connectedAndEnabled || sendTest.isPending} className="inline-flex min-h-11 items-center gap-2 rounded-pill bg-surface-container-highest px-4 text-sm text-on-surface"><Send className="h-4 w-4" />Send test notification</button><button type="button" onClick={() => { if (window.confirm('Disconnect Pushover and cancel pending pushes?')) disconnect.mutate() }} className="inline-flex min-h-11 items-center gap-2 rounded-pill px-4 text-sm text-error"><Unplug className="h-4 w-4" />Disconnect</button></div></>}</section><p className="flex items-center justify-center gap-2 text-center font-body text-xs text-on-surface-variant"><Check className="h-3.5 w-3.5 text-primary" />Changes save automatically.</p></section>
}
