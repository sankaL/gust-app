import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Bell, Check, KeyRound, Mail, Palette, Send, Unplug } from 'lucide-react'
import { useLocation, useNavigate } from 'react-router-dom'

import { ScreenHeader } from '../components/AppShellView'
import { Button } from '../components/Button'
import { useNotifications } from '../components/Notifications'
import { ThemeSelector } from '../components/shell/AccountSheet'
import { InlineNotice, Switch } from '../components/ui/controls'
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
  return <Switch label={label} checked={checked} disabled={disabled} onChange={onChange} />
}

function SettingsCard({ icon: Icon, title, children }: { icon: typeof Bell; title: string; children: React.ReactNode }) {
  return (
    <section className="animate-rise-in space-y-3 rounded-[1.4rem] bg-surface-container p-4 shadow-card ring-1 ring-inset ring-outline/40">
      <div className="flex items-center gap-2.5">
        <span className="flex h-9 w-9 items-center justify-center rounded-xl bg-primary/[0.12] text-primary"><Icon className="h-[1.1rem] w-[1.1rem]" strokeWidth={2.1} /></span>
        <h2 className="font-display text-lg font-bold text-on-surface">{title}</h2>
      </div>
      {children}
    </section>
  )
}

export function SettingsRoute() {
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { notifyError, notifySuccess } = useNotifications()
  const [manualKey, setManualKey] = useState('')
  const hasHandledPushoverCallback = useRef(false)
  const settingsQuery = useQuery({
    queryKey: ['notification-settings'],
    queryFn: getNotificationSettings,
  })
  const { data: settings, refetch: refetchSettings } = settingsQuery
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
      .then((result) => {
        if (result.isError) {
          notifyError('Pushover connected, but Gust could not refresh your settings. Try again.')
          return
        }
        notifySuccess('Pushover connected.')
      })
      .catch(() => {
        notifyError('Pushover connected, but Gust could not refresh your settings. Try again.')
      })
    const searchParams = new URLSearchParams(location.search)
    searchParams.delete('pushover')
    void navigate(
      {
        pathname: location.pathname,
        search: searchParams.size > 0 ? `?${searchParams.toString()}` : '',
      },
      { replace: true }
    )
  }, [location.pathname, location.search, navigate, notifyError, notifySuccess, refetchSettings])
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

  if (!settings) {
    if (settingsQuery.isError) {
      return <section className="py-8"><InlineNotice tone="warning" role="alert" action={<Button variant="primary" size="sm" onClick={() => void refetchSettings()} disabled={settingsQuery.isFetching}>{settingsQuery.isFetching ? 'Retrying…' : 'Try again'}</Button>}>Could not refresh notification settings. Your Pushover connection may be saved, but Gust cannot confirm its current state.</InlineNotice></section>
    }
    return <section className="space-y-4 py-8" aria-busy="true"><p className="sr-only">Loading settings…</p><div className="skeleton-shimmer h-10 w-40 rounded-pill" /><div className="skeleton-shimmer h-36 rounded-[1.4rem]" /><div className="skeleton-shimmer h-48 rounded-[1.4rem]" /></section>
  }
  const connectedAndEnabled = settings.pushover_connected && settings.pushover_enabled
  return (
    <section className="mx-auto max-w-2xl space-y-4 pb-8">
      {settingsQuery.isError ? <InlineNotice tone="warning" role="alert" action={<Button variant="primary" size="sm" onClick={() => void refetchSettings()} disabled={settingsQuery.isFetching}>{settingsQuery.isFetching ? 'Retrying…' : 'Try again'}</Button>}>Could not refresh notification settings. Some information may be out of date.</InlineNotice> : null}
      <ScreenHeader eyebrow="Account" title="Settings" showBell={false} />
      <h1 className="sr-only">Notification settings</h1>
      <p className="font-body text-sm leading-6 text-on-surface-variant">Digest schedules use Eastern time. Your date-only reminders use {settings.timezone}.</p>
      <SettingsCard icon={Palette} title="Appearance">
        <ThemeSelector />
      </SettingsCard>
      <SettingsCard icon={Mail} title="Email">
        <Toggle label="Daily brief email" checked={settings.email_daily_enabled} onChange={(email_daily_enabled) => update({ email_daily_enabled })} />
        <Toggle label="Weekly summary email" checked={settings.email_weekly_enabled} onChange={(email_weekly_enabled) => update({ email_weekly_enabled })} />
      </SettingsCard>
      <SettingsCard icon={Bell} title="Pushover">
        {!settings.pushover_available ? <p className="font-body text-sm text-on-surface-variant">Pushover is not available in this environment.</p> : !settings.pushover_connected ? <>
          <p className="font-body text-sm leading-6 text-on-surface-variant">Pushover has its own trial and license terms. Connect your personal account to choose where Gust sends notifications.</p>
          <Button variant="primary" onClick={() => void connect()}><Bell className="h-4 w-4" />Connect Pushover</Button>
          <details className="group rounded-card bg-surface-container-high p-3 ring-1 ring-inset ring-outline/50">
            <summary className="cursor-pointer font-body text-sm font-semibold text-on-surface">Enter user key manually</summary>
            <div className="mt-3 flex gap-2">
              <input aria-label="Pushover user key" value={manualKey} onChange={(event) => setManualKey(event.target.value)} className="min-w-0 flex-1 rounded-pill bg-surface-dim px-4 text-sm text-on-surface outline-none ring-1 ring-inset ring-outline/50 focus:ring-2 focus:ring-primary/60" />
              <Button variant="secondary" disabled={keySave.isPending} onClick={() => keySave.mutate()}><KeyRound className="h-4 w-4" /> Save</Button>
            </div>
          </details>
        </> : <>
          <p className="font-body text-sm text-on-surface-variant">Connected as {settings.pushover_user_key_hint}</p>
          <Toggle label="Pushover notifications" checked={settings.pushover_enabled} onChange={(pushover_enabled) => update({ pushover_enabled })} />
          <Toggle label="Task reminders" checked={settings.pushover_task_reminders_enabled} disabled={!connectedAndEnabled} onChange={(pushover_task_reminders_enabled) => update({ pushover_task_reminders_enabled })} />
          <Toggle label="Daily brief" checked={settings.pushover_daily_digest_enabled} disabled={!connectedAndEnabled} onChange={(pushover_daily_digest_enabled) => update({ pushover_daily_digest_enabled })} />
          <Toggle label="Weekly summary" checked={settings.pushover_weekly_digest_enabled} disabled={!connectedAndEnabled} onChange={(pushover_weekly_digest_enabled) => update({ pushover_weekly_digest_enabled })} />
          {connectedAndEnabled && settings.pushover_task_reminders_enabled ? <label className="flex min-h-[3.25rem] items-center justify-between gap-3 rounded-card bg-surface-container-high px-4 py-2.5 text-sm font-medium text-on-surface ring-1 ring-inset ring-outline/50"><span>Date-only reminder time</span><input aria-label="Date-only reminder time" type="time" value={settings.date_only_reminder_time.slice(0, 5)} onChange={(event) => update({ date_only_reminder_time: event.target.value })} className="rounded-lg bg-surface-dim px-2 py-1 text-on-surface ring-1 ring-inset ring-outline/50" /></label> : null}
          <div className="flex flex-wrap gap-2">
            <Button variant="secondary" onClick={() => sendTest.mutate()} disabled={!connectedAndEnabled || sendTest.isPending}><Send className="h-4 w-4" />Send test notification</Button>
            <Button variant="ghost" className="!text-tertiary" onClick={() => { if (window.confirm('Disconnect Pushover and cancel pending pushes?')) disconnect.mutate() }}><Unplug className="h-4 w-4" />Disconnect</Button>
          </div>
        </>}
      </SettingsCard>
      <p className="flex items-center justify-center gap-2 text-center font-body text-xs text-on-surface-variant"><Check className="h-3.5 w-3.5 text-primary" />Changes save automatically.</p>
    </section>
  )
}
