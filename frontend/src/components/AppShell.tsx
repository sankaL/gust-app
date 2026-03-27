import { useCallback, useEffect, useState } from 'react'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { NavLink, Outlet } from 'react-router-dom'

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
  const displayModeStandalone =
    typeof window.matchMedia === 'function'
      ? window.matchMedia('(display-mode: standalone)').matches
      : false

  return (
    displayModeStandalone || window.navigator.standalone === true
  )
}

export function AppShell() {
  const config = getAppConfig()
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isStandalone, setIsStandalone] = useState(false)
  const [showIosInstallHelp, setShowIosInstallHelp] = useState(false)
  const [needRefresh, setNeedRefresh] = useState(false)
  const [offlineReady, setOfflineReady] = useState(false)

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

  const shouldShowInstallButton = !isStandalone && (installPrompt !== null || isIosDevice())

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
            </div>
          </div>

          {showIosInstallHelp ? (
            <Card className="overflow-hidden bg-surface-container-high/90 shadow-[0_0_40px_rgba(186,158,255,0.08)]">
              <div className="space-y-2">
                <p className="font-body text-[0.65rem] uppercase tracking-[0.2em] text-primary">
                  Install on iPhone
                </p>
                <p className="font-body text-sm leading-6 text-on-surface">
                  Open Safari&apos;s Share menu, then choose <span className="font-semibold text-primary">Add to Home Screen</span> to install Gust.
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
                <Button type="button" variant="primary" size="sm" onClick={() => updateServiceWorker(true)}>
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
