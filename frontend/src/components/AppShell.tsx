import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'

import { ApiError, getSessionStatus, logoutSession } from '../lib/api'
import { Button } from './Button'
import { Card } from './Card'
import { useNotifications } from './Notifications'
import { PortraitOrientationGuard } from './PortraitOrientationGuard'

const navigation = [
  { to: '/', label: 'Capture', end: true },
  { to: '/tasks', label: 'Tasks', end: true },
  { to: '/tasks/groups', label: 'Groups', end: false }
]

function isIosDevice() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent)
}

function isStandaloneDisplayMode() {
  const displayModeStandalone = Boolean(
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(display-mode: standalone)')?.matches
      : false
  )

  return displayModeStandalone || window.navigator.standalone === true
}

function buildFriendlyMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message
  }
  return fallback
}

function buildAvatarLabel(displayName: string | null, email: string) {
  const source = (displayName?.trim() || email.split('@')[0] || 'G').replace(/\s+/g, ' ')
  const parts = source.split(' ').filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  }
  return source.slice(0, 2).toUpperCase()
}

function buildLoginPath(pathname: string, search: string) {
  const nextPath = `${pathname}${search}`
  return `/login?next=${encodeURIComponent(nextPath)}`
}

export function AppShell() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()
  const { notifyError } = useNotifications()

  const sessionQuery = useQuery({
    queryKey: ['session-status'],
    queryFn: getSessionStatus
  })

  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isStandalone, setIsStandalone] = useState(false)
  const [showIosInstallHelp, setShowIosInstallHelp] = useState(false)
  const [needRefresh, setNeedRefresh] = useState(false)
  const [offlineReady, setOfflineReady] = useState(false)
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false)
  const accountMenuRef = useRef<HTMLDivElement | null>(null)

  const { updateServiceWorker } = useRegisterSW({
    onNeedRefresh() {
      setNeedRefresh(true)
      setOfflineReady(false)
    },
    onOfflineReady() {
      setOfflineReady(true)
      setNeedRefresh(false)
    }
  })

  const updateStandalone = useCallback(() => {
    setIsStandalone(isStandaloneDisplayMode())
  }, [])

  useEffect(() => {
    const handleBeforeInstallPrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as BeforeInstallPromptEvent)
      updateStandalone()
    }

    const handleAppInstalled = () => {
      setInstallPrompt(null)
      setShowIosInstallHelp(false)
      updateStandalone()
    }

    updateStandalone()
    window.addEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
    window.addEventListener('appinstalled', handleAppInstalled)

    return () => {
      window.removeEventListener('beforeinstallprompt', handleBeforeInstallPrompt)
      window.removeEventListener('appinstalled', handleAppInstalled)
    }
  }, [updateStandalone])

  useEffect(() => {
    if (!isAccountMenuOpen) {
      return
    }

    const handlePointerDown = (event: MouseEvent) => {
      if (!accountMenuRef.current?.contains(event.target as Node)) {
        setIsAccountMenuOpen(false)
      }
    }

    const handleEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setIsAccountMenuOpen(false)
      }
    }

    document.addEventListener('mousedown', handlePointerDown)
    window.addEventListener('keydown', handleEscape)
    return () => {
      document.removeEventListener('mousedown', handlePointerDown)
      window.removeEventListener('keydown', handleEscape)
    }
  }, [isAccountMenuOpen])

  const logoutMutation = useMutation({
    mutationFn: async () => {
      const csrfToken = sessionQuery.data?.csrf_token
      if (!csrfToken) {
        throw new ApiError('Your session is missing a CSRF token.', 'csrf_missing', 403)
      }
      return logoutSession(csrfToken)
    },
    onSuccess: () => {
      setIsAccountMenuOpen(false)
      queryClient.clear()
      void navigate('/login', { replace: true })
    },
    onError: (error) => {
      notifyError(buildFriendlyMessage(error, 'Logout failed. Refresh and try again.'))
    }
  })

  const shouldShowInstallButton = !isStandalone && (installPrompt !== null || isIosDevice())

  const accountInitials = useMemo(() => {
    if (!sessionQuery.data?.user) {
      return 'G'
    }
    return buildAvatarLabel(sessionQuery.data.user.display_name, sessionQuery.data.user.email)
  }, [sessionQuery.data?.user])

  if (sessionQuery.isLoading) {
    return (
      <div className="safe-area-shell min-h-screen bg-surface text-on-surface">
        <PortraitOrientationGuard />
        <div className="mx-auto flex min-h-screen w-full max-w-md items-center px-4">
          <section className="w-full space-y-3" aria-busy="true">
            <p className="font-body text-xs uppercase tracking-[0.15em] text-on-surface-variant">
              Session check
            </p>
            <h1 className="font-display text-3xl text-on-surface">Loading workspace</h1>
            <p className="font-body text-sm leading-6 text-on-surface-variant">
              Verifying your account before loading Gust.
            </p>
          </section>
        </div>
      </div>
    )
  }

  if (sessionQuery.isError || !sessionQuery.data?.signed_in) {
    return <Navigate to={buildLoginPath(location.pathname, location.search)} replace />
  }

  async function handleInstallClick() {
    if (installPrompt) {
      await installPrompt.prompt()
      try {
        await installPrompt.userChoice
      } finally {
        setInstallPrompt(null)
      }
      return
    }

    if (isIosDevice()) {
      setShowIosInstallHelp((current) => !current)
    }
  }

  function openCompletedTasks() {
    setIsAccountMenuOpen(false)
    void navigate('/tasks/completed?group=all')
  }

  function openDesktopMode() {
    setIsAccountMenuOpen(false)
    void navigate('/desktop')
  }

  return (
    <div className="safe-area-shell min-h-screen bg-surface text-on-surface">
      <PortraitOrientationGuard />
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-3 pb-4 pt-3">
        <header className="safe-area-sticky-top sticky z-50 mb-4 space-y-5 bg-surface/95 pt-2 backdrop-blur-sm">
          <div className="flex items-center justify-between gap-3">
            <Link to="/" className="flex items-center gap-2">
              <img src="/logos/gust-wind-electric.svg" alt="Gust" className="h-6 w-6" />
              <h1 className="font-display text-2xl leading-none text-on-surface">Gust</h1>
            </Link>
            <div className="flex items-center gap-2">
              {shouldShowInstallButton ? (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    void handleInstallClick()
                  }}
                  aria-label={installPrompt ? 'Install Gust app' : 'Show iPhone install instructions'}
                >
                  {installPrompt ? 'Install' : 'Add to Home'}
                </Button>
              ) : null}
              <div className="relative" ref={accountMenuRef}>
                <button
                  type="button"
                  className="flex h-10 w-10 items-center justify-center rounded-full font-body text-xs font-bold uppercase tracking-[0.08em] text-black bg-[radial-gradient(circle_at_top,_#ffffff_10%,_#e5e5e5_90%)] shadow-[0_4px_0_#a1a1aa,_0_6px_10px_rgba(0,0,0,0.4),_inset_0_1px_2px_rgba(255,255,255,0.8)] hover:-translate-y-[1px] hover:shadow-[0_5px_0_#a1a1aa,_0_8px_12px_rgba(0,0,0,0.4),_inset_0_1px_2px_rgba(255,255,255,0.8)] active:translate-y-[4px] active:shadow-[0_0px_0_#a1a1aa,_0_2px_4px_rgba(0,0,0,0.4),_inset_0_2px_4px_rgba(0,0,0,0.1)] transition-all duration-200 outline-none select-none"
                  aria-haspopup="menu"
                  aria-expanded={isAccountMenuOpen}
                  aria-label="Open account menu"
                  onClick={() => {
                    setIsAccountMenuOpen((current) => !current)
                  }}
                >
                  {accountInitials}
                </button>
                {isAccountMenuOpen ? (
                  <div
                    role="menu"
                    className="absolute right-0 top-12 z-50 w-64 overflow-hidden rounded-card bg-[linear-gradient(180deg,_rgb(38,38,38)_0%,_rgb(26,26,26)_100%)] py-1 shadow-[0_18px_40px_rgba(0,0,0,0.58),_inset_0_1px_0_rgba(255,255,255,0.05)]"
                  >
                    <div className="mb-1 bg-white/[0.03] px-3 py-3">
                      <p className="font-body text-[0.65rem] uppercase tracking-[0.15em] text-on-surface-variant">
                        Signed in
                      </p>
                      <p className="truncate font-body text-sm text-on-surface">
                        {sessionQuery.data.user?.email}
                      </p>
                    </div>
                    <div className="flex flex-col">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={openCompletedTasks}
                        className="flex w-full items-center gap-3 px-3 py-2 text-left font-body text-sm text-on-surface transition-colors hover:bg-surface-container-highest"
                      >
                        <svg className="w-4 h-4 text-on-surface-variant" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                          <path d="M9 11l3 3L22 4" />
                          <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
                        </svg>
                        Completed Tasks
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={openDesktopMode}
                        className="flex w-full items-center gap-3 px-3 py-2 text-left font-body text-sm text-on-surface transition-colors hover:bg-surface-container-highest"
                      >
                        <svg className="w-4 h-4 text-on-surface-variant" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                          <rect x="2" y="3" width="20" height="14" rx="2" />
                          <line x1="8" y1="21" x2="16" y2="21" />
                          <line x1="12" y1="17" x2="12" y2="21" />
                        </svg>
                        Desktop Mode
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => logoutMutation.mutate()}
                        disabled={logoutMutation.isPending}
                        className="flex w-full items-center gap-3 px-3 py-2 text-left font-body text-sm text-tertiary transition-colors hover:bg-surface-container-highest disabled:opacity-60"
                      >
                        <svg className="w-4 h-4 text-tertiary" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
                          <path d="M9 21H5a2 2 0 01-2-2V5a2 2 0 012-2h4" />
                          <polyline points="16 17 21 12 16 7" />
                          <line x1="21" y1="12" x2="9" y2="12" />
                        </svg>
                        {logoutMutation.isPending ? 'Logging out...' : 'Logout'}
                      </button>
                    </div>
                  </div>
                ) : null}
              </div>
            </div>
          </div>

          {showIosInstallHelp ? (
            <Card className="overflow-hidden bg-surface-container-high/90 shadow-[0_0_40px_rgba(186,158,255,0.08)]">
              <div className="space-y-2">
                <p className="font-body text-[0.65rem] uppercase tracking-[0.2em] text-primary">
                  Install on iPhone
                </p>
                <p className="font-body text-sm leading-6 text-on-surface">
                  Open Safari&apos;s Share menu, then choose{' '}
                  <span className="font-semibold text-primary">Add to Home Screen</span> to install
                  Gust.
                </p>
              </div>
            </Card>
          ) : null}

          {needRefresh ? (
            <Card className="overflow-hidden bg-surface-container-highest shadow-[0_0_48px_rgba(186,158,255,0.12)]">
              <div className="flex items-center justify-between gap-3">
                <div className="space-y-1">
                  <p className="font-body text-[0.65rem] uppercase tracking-[0.2em] text-primary">
                    Update ready
                  </p>
                  <p className="font-body text-sm leading-6 text-on-surface">
                    A newer build is available. Reload to update the app shell.
                  </p>
                </div>
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={() => {
                    void updateServiceWorker(true)
                  }}
                >
                  Update
                </Button>
              </div>
            </Card>
          ) : null}

          {offlineReady ? (
            <Card className="overflow-hidden bg-surface-container-high/90">
              <p className="font-body text-sm leading-6 text-on-surface-variant">
                App shell cached for faster launches.
              </p>
            </Card>
          ) : null}

          <nav
            aria-label="Primary"
            className="grid grid-cols-3 gap-2 rounded-soft bg-surface-container p-1.5"
          >
            {navigation.map((item) => (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) =>
                  [
                    'rounded-soft px-3 py-2 text-center font-body text-sm transition',
                    isActive
                      ? 'bg-surface-container-highest text-primary shadow-ambient'
                      : 'text-on-surface-variant hover:bg-surface-container-high'
                  ].join(' ')
                }
              >
                {item.label}
              </NavLink>
            ))}
          </nav>
        </header>

        <main className="flex-1">
          <Outlet />
        </main>
      </div>
    </div>
  )
}
