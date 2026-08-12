import { useState } from 'react'
import { Navigate, useLocation } from 'react-router-dom'

import { useDeviceRedirect } from '../hooks/useDeviceRedirect'
import { useAccountMenu, useDesktopRecorder, useDesktopSession } from '../hooks/useDesktopShellState'
import { resolveLoginPath } from '../lib/sessionPresentation'
import { DesktopShellLayout } from './DesktopShellLayout'
import { DEFAULT_DESKTOP_HEADER, type DesktopHeaderContent } from './DesktopShellContext'
import { TimezoneSyncGate } from './TimezoneSyncGate'

function DesktopSessionLoading() {
  return (
    <div className="min-h-[100dvh] bg-surface text-on-surface">
      <div className="mx-auto flex min-h-[100dvh] max-w-7xl items-center px-8">
        <section className="space-y-3" aria-busy="true">
          <p className="font-body text-xs uppercase tracking-[0.18em] text-on-surface-variant">Session check</p>
          <h1 className="font-display text-4xl tracking-tight text-on-surface">Loading mission control</h1>
          <p className="font-body text-sm text-on-surface-variant">Verifying your account before opening the desktop workspace.</p>
        </section>
      </div>
    </div>
  )
}

export function DesktopShell() {
  useDeviceRedirect()
  const location = useLocation()
  const [header, setHeader] = useState<DesktopHeaderContent>(DEFAULT_DESKTOP_HEADER)
  const { sessionQuery, timezoneSync, groupsQuery, openTasksQuery, logoutMutation, accountInitials } = useDesktopSession()
  const accountMenu = useAccountMenu()
  const recorder = useDesktopRecorder(sessionQuery.data)

  if (sessionQuery.isLoading) return <DesktopSessionLoading />
  const loginPath = resolveLoginPath(sessionQuery, location.pathname, location.search)
  if (loginPath) return <Navigate to={loginPath} replace />
  if (!timezoneSync.isReady) return <TimezoneSyncGate desktop isError={timezoneSync.isError} onRetry={() => void timezoneSync.retry()} />
  const session = sessionQuery.data!

  return (
    <DesktopShellLayout
      session={session}
      groups={groupsQuery.data ?? []}
      isGroupsLoading={groupsQuery.isLoading}
      openTasks={openTasksQuery.data ?? []}
      areNavigationSignalsLoading={openTasksQuery.isLoading || openTasksQuery.isError}
      header={header}
      setHeader={setHeader}
      logout={logoutMutation}
      account={{
        initials: accountInitials,
        email: session.user?.email,
        isOpen: accountMenu.isOpen,
        setIsOpen: accountMenu.setIsOpen,
        menuRef: accountMenu.menuRef,
      }}
      recorder={recorder}
    />
  )
}
