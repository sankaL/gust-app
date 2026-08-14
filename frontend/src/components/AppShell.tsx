import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { useAppShellController } from '../hooks/useAppShellController'
import { useDeviceRedirect } from '../hooks/useDeviceRedirect'
import { resolveLoginPath } from '../lib/sessionPresentation'
import { AppShellActionsContext } from './AppShellActions'
import { AppShellHeader, AppShellLoading, BottomNavigation } from './AppShellView'
import { PortraitOrientationGuard } from './PortraitOrientationGuard'
import { TimezoneSyncGate } from './TimezoneSyncGate'

export function AppShell() {
  useDeviceRedirect()
  const location = useLocation()
  const controller = useAppShellController()
  const { sessionQuery } = controller

  if (sessionQuery.isLoading) return <AppShellLoading />
  const loginPath = resolveLoginPath(sessionQuery, location.pathname, location.search)
  if (loginPath) return <Navigate to={loginPath} replace />
  if (!controller.timezoneSync.isReady) return <TimezoneSyncGate isError={controller.timezoneSync.isError} onRetry={() => void controller.timezoneSync.retry()} />
  const session = sessionQuery.data!

  return (
    <div className="safe-area-shell min-h-screen bg-surface text-on-surface">
      <PortraitOrientationGuard />
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-4 pb-[calc(var(--safe-area-bottom)+6.5rem)] pt-3">
        <AppShellHeader
          session={session}
          topBarAction={controller.topBarAction}
          accountInitials={controller.accountInitials}
          shouldShowInstallButton={controller.shouldShowInstallButton}
          hasInstallPrompt={controller.install.installPrompt !== null}
          isAccountMenuOpen={controller.isAccountMenuOpen}
          isLoggingOut={controller.logout.isPending}
          showIosInstallHelp={controller.install.showIosInstallHelp}
          needRefresh={controller.needRefresh}
          offlineReady={controller.offlineReady}
          accountMenuRef={controller.accountMenuRef}
          onInstall={() => void controller.install.requestInstall()}
          onToggleAccountMenu={controller.toggleAccountMenu}
          onCompletedTasks={controller.openCompletedTasks}
          onDesktopMode={controller.openDesktopMode}
          onLogout={() => controller.logout.mutate()}
          onUpdate={controller.update}
        />
        <AppShellActionsContext.Provider value={controller.shellActions}>
          <main className="flex-1"><Outlet /></main>
        </AppShellActionsContext.Provider>
        <BottomNavigation
          isRecording={controller.isRecording}
          isRecordingActionDisabled={controller.isRecordingActionDisabled}
          onToggleRecording={controller.onToggleRecording}
        />
      </div>
    </div>
  )
}
