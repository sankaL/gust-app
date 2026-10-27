import { useMemo } from 'react'
import { Navigate, Outlet, useLocation } from 'react-router-dom'

import { useAppShellController } from '../hooks/useAppShellController'
import { useDeviceRedirect } from '../hooks/useDeviceRedirect'
import { useShellSheets } from '../hooks/useShellSheets'
import type { SessionStatus } from '../lib/api'
import { resolveLoginPath } from '../lib/sessionPresentation'
import { CaptureEditModal } from '../routes/capture/CaptureView'
import { CaptureSheet } from '../routes/capture/CaptureSheet'
import { ReviewSheet } from '../routes/capture/ReviewSheet'
import { useCaptureController } from '../routes/capture/useCaptureController'
import { AppShellActionsContext, MobileShellContext } from './AppShellActions'
import { AppShellLoading, BottomNavigation, ShellNotices } from './AppShellView'
import { PortraitOrientationGuard } from './PortraitOrientationGuard'
import { AccountSheet } from './shell/AccountSheet'
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
  return <SignedInShell controller={controller} session={sessionQuery.data!} />
}

function SignedInShell({ controller, session }: { controller: ReturnType<typeof useAppShellController>; session: SessionStatus }) {
  const { pathname } = useLocation()
  const sheets = useShellSheets()
  const capture = useCaptureController({ isActive: sheets.activeSheet === 'capture' || sheets.activeSheet === 'review' })
  const pendingReviewCount = capture.queries.pendingTasks.length
  const { openSheet } = sheets
  const shellContext = useMemo(
    () => ({ topBarAction: controller.topBarAction, pendingReviewCount, openSheet }),
    [controller.topBarAction, openSheet, pendingReviewCount]
  )

  return (
    <div className="safe-area-shell min-h-screen text-on-surface">
      <PortraitOrientationGuard />
      <MobileShellContext.Provider value={shellContext}>
        <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-5 pb-[calc(var(--safe-area-bottom)+9.5rem)]">
          <ShellNotices showIosInstallHelp={controller.install.showIosInstallHelp} needRefresh={controller.needRefresh} offlineReady={controller.offlineReady} onUpdate={controller.update} />
          <AppShellActionsContext.Provider value={controller.shellActions}>
            <main key={pathname} className="animate-route-in flex-1"><Outlet /></main>
          </AppShellActionsContext.Provider>
        </div>
        <BottomNavigation
          isAccountOpen={sheets.activeSheet === 'account'}
          onAccount={() => openSheet('account')}
          onCapture={() => openSheet('capture', 'record')}
        />
        <CaptureSheet
          controller={capture}
          open={sheets.activeSheet === 'capture'}
          launchMode={sheets.captureMode}
          onConsumeLaunchMode={sheets.consumeCaptureMode}
          onClose={sheets.closeSheet}
          onReopen={() => openSheet('capture')}
          onOpenReview={() => openSheet('review')}
        />
        <ReviewSheet controller={capture} open={sheets.activeSheet === 'review'} onClose={sheets.closeSheet} onCapture={() => openSheet('capture', 'record')} />
        <AccountSheet
          open={sheets.activeSheet === 'account'}
          onClose={sheets.closeSheet}
          email={session.user?.email}
          displayName={session.user?.display_name}
          initials={controller.accountInitials}
          isLoggingOut={controller.logout.isPending}
          canInstall={controller.shouldShowInstallButton}
          installLabel={controller.install.installPrompt !== null ? 'Install Gust app' : 'Add to Home Screen'}
          onInstall={() => { sheets.closeSheet(); void controller.install.requestInstall() }}
          onCompletedTasks={controller.openCompletedTasks}
          onSettings={controller.openSettings}
          onDesktopMode={controller.openDesktopMode}
          onLogout={() => controller.logout.mutate()}
        />
        <CaptureEditModal
          task={capture.state.editTask}
          groups={capture.queries.groups.data ?? []}
          csrfToken={capture.queries.session.data?.csrf_token ?? null}
          onClose={() => capture.state.setEditTask(null)}
          onSave={() => capture.review.refresh(capture.state.reviewCaptureId)}
        />
      </MobileShellContext.Provider>
    </div>
  )
}
