import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'

import { ApiError, getSessionStatus, logoutSession } from '../lib/api'
import { getAppConfig } from '../lib/config'
import { Button } from './Button'
import { Card } from './Card'

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
  const config = getAppConfig()
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const location = useLocation()

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
  const [menuError, setMenuError] = useState<string | null>(null)
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
      setMenuError(null)
      queryClient.clear()
      navigate('/login', { replace: true })
    },
    onError: (error) => {
      setMenuError(buildFriendlyMessage(error, 'Logout failed. Refresh and try again.'))
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
      <div className="min-h-screen bg-surface text-on-surface">
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
    navigate('/tasks/completed?group=all')
  }

  function openDesktopMode() {
    setIsAccountMenuOpen(false)
    navigate('/desktop')
  }

  return (
    <div className="min-h-screen bg-surface text-on-surface">
      <div className="mx-auto flex min-h-screen w-full max-w-md flex-col px-3 pb-4 pt-3">
        <header className="sticky top-0 z-50 mb-4 space-y-5 bg-surface/95 pt-2 backdrop-blur-sm">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <img src="/logos/gust-wind-electric.svg" alt="Gust" className="h-6 w-6" />
              <h1 className="font-display text-2xl leading-none text-on-surface">Gust</h1>
            </div>
            <div className="flex items-center gap-2">
              {shouldShowInstallButton ? (
                <Button
                  type="button"
                  variant="primary"
                  size="sm"
                  onClick={handleInstallClick}
                  aria-label={installPrompt ? 'Install Gust app' : 'Show iPhone install instructions'}
                >
                  {installPrompt ? 'Install' : 'Add to Home'}
                </Button>
              ) : null}
              <div className="rounded-pill bg-surface-container-high px-2 py-1 text-right shadow-ambient">
                <p className="font-body text-xs font-medium">{config.environmentLabel}</p>
              </div>
              <div className="relative" ref={accountMenuRef}>
                <button
                  type="button"
                  className="flex h-10 w-10 items-center justify-center rounded-full border border-outline/40 bg-surface-container-high font-body text-xs font-semibold uppercase tracking-[0.08em] text-on-surface transition hover:bg-surface-container-highest"
                  aria-haspopup="menu"
                  aria-expanded={isAccountMenuOpen}
                  aria-label="Open account menu"
                  onClick={() => {
                    setMenuError(null)
                    setIsAccountMenuOpen((current) => !current)
                  }}
                >
                  {accountInitials}
                </button>
                {isAccountMenuOpen ? (
                  <div
                    role="menu"
                    className="absolute right-0 top-12 z-50 w-64 rounded-card bg-surface-container-highest shadow-[0_4px_24px_rgba(0,0,0,0.6)] border border-white/10 p-3"
                  >
                    <div className="space-y-1 px-1 pb-2">
                      <p className="font-body text-xs uppercase tracking-[0.15em] text-on-surface-variant">
                        Signed in
                      </p>
                      <p className="truncate font-body text-sm text-on-surface">
                        {sessionQuery.data.user?.email}
                      </p>
                    </div>
                    <div className="space-y-1">
                      <button
                        type="button"
                        role="menuitem"
                        onClick={openCompletedTasks}
                        className="w-full rounded-soft px-3 py-2 text-left font-body text-sm text-on-surface transition hover:bg-surface-container-high"
                      >
                        Completed Tasks
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={openDesktopMode}
                        className="w-full rounded-soft px-3 py-2 text-left font-body text-sm text-on-surface transition hover:bg-surface-container-high"
                      >
                        Desktop Mode
                      </button>
                      <button
                        type="button"
                        role="menuitem"
                        onClick={() => logoutMutation.mutate()}
                        disabled={logoutMutation.isPending}
                        className="w-full rounded-soft px-3 py-2 text-left font-body text-sm text-tertiary transition hover:bg-surface-container-high disabled:opacity-60"
                      >
                        {logoutMutation.isPending ? 'Logging out...' : 'Logout'}
                      </button>
                    </div>
                    {menuError ? (
                      <p className="px-1 pt-2 font-body text-xs text-tertiary">{menuError}</p>
                    ) : null}
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
                  onClick={() => updateServiceWorker(true)}
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
