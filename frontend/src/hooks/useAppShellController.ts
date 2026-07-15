import { type ReactNode, useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useRegisterSW } from 'virtual:pwa-register/react'
import { useNavigate } from 'react-router-dom'

import { ApiError, getSessionStatus, logoutSession } from '../lib/api'
import { buildAvatarLabel } from '../lib/sessionPresentation'
import { markDeviceRedirectOverride } from './useDeviceRedirect'
import { useNotifications } from '../components/Notifications'

function isIosDevice() {
  return /iphone|ipad|ipod/i.test(window.navigator.userAgent)
}

function isStandaloneDisplayMode() {
  const matchesStandalone =
    typeof window.matchMedia === 'function' &&
    Boolean(window.matchMedia('(display-mode: standalone)')?.matches)
  return matchesStandalone || window.navigator.standalone === true
}

function useInstallState() {
  const [installPrompt, setInstallPrompt] = useState<BeforeInstallPromptEvent | null>(null)
  const [isStandalone, setIsStandalone] = useState(false)
  const [showIosInstallHelp, setShowIosInstallHelp] = useState(false)
  const updateStandalone = useCallback(() => setIsStandalone(isStandaloneDisplayMode()), [])
  useEffect(() => {
    const handlePrompt = (event: Event) => {
      event.preventDefault()
      setInstallPrompt(event as BeforeInstallPromptEvent)
      updateStandalone()
    }
    const handleInstalled = () => {
      setInstallPrompt(null)
      setShowIosInstallHelp(false)
      updateStandalone()
    }
    updateStandalone()
    window.addEventListener('beforeinstallprompt', handlePrompt)
    window.addEventListener('appinstalled', handleInstalled)
    return () => {
      window.removeEventListener('beforeinstallprompt', handlePrompt)
      window.removeEventListener('appinstalled', handleInstalled)
    }
  }, [updateStandalone])

  async function requestInstall() {
    if (!installPrompt) {
      if (isIosDevice()) setShowIosInstallHelp((current) => !current)
      return
    }
    await installPrompt.prompt()
    try {
      await installPrompt.userChoice
    } finally {
      setInstallPrompt(null)
    }
  }
  return { installPrompt, isStandalone, showIosInstallHelp, requestInstall }
}

function useDismissibleMenu(isOpen: boolean, close: () => void) {
  const menuRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (!isOpen) return
    const closeOutside = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) close()
    }
    const closeOnEscape = (event: KeyboardEvent) => {
      if (event.key === 'Escape') close()
    }
    document.addEventListener('mousedown', closeOutside)
    window.addEventListener('keydown', closeOnEscape)
    return () => {
      document.removeEventListener('mousedown', closeOutside)
      window.removeEventListener('keydown', closeOnEscape)
    }
  }, [close, isOpen])
  return menuRef
}

function usePwaStatus() {
  const [needRefresh, setNeedRefresh] = useState(false)
  const [offlineReady, setOfflineReady] = useState(false)
  const { updateServiceWorker } = useRegisterSW({
    onNeedRefresh: () => { setNeedRefresh(true); setOfflineReady(false) },
    onOfflineReady: () => { setOfflineReady(true); setNeedRefresh(false) },
  })
  return { needRefresh, offlineReady, update: () => void updateServiceWorker(true) }
}

function useLogout({ token, closeMenu, onError }: { token?: string | null; closeMenu: () => void; onError: (message: string) => void }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  return useMutation({
    mutationFn: () => {
      if (!token) throw new ApiError('Your session is missing a CSRF token.', 'csrf_missing', 403)
      return logoutSession(token)
    },
    onSuccess: () => { closeMenu(); queryClient.clear(); void navigate('/login', { replace: true }) },
    onError: (error) => onError(error instanceof ApiError ? error.message : 'Logout failed. Refresh and try again.'),
  })
}

export function useAppShellController() {
  const navigate = useNavigate()
  const { notifyError } = useNotifications()
  const sessionQuery = useQuery({ queryKey: ['session-status'], queryFn: getSessionStatus, retry: false })
  const install = useInstallState()
  const pwa = usePwaStatus()
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false)
  const [topBarAction, setTopBarAction] = useState<ReactNode | null>(null)
  const closeMenu = useCallback(() => setIsAccountMenuOpen(false), [])
  const accountMenuRef = useDismissibleMenu(isAccountMenuOpen, closeMenu)
  const shellActions = useMemo(() => ({ setTopBarAction }), [])
  const logout = useLogout({ token: sessionQuery.data?.csrf_token, closeMenu, onError: notifyError })
  const user = sessionQuery.data?.user
  const accountInitials = user ? buildAvatarLabel(user.display_name, user.email) : 'G'

  function openCompletedTasks() { closeMenu(); void navigate('/tasks/completed?group=all') }
  function openDesktopMode() { closeMenu(); markDeviceRedirectOverride(); void navigate('/desktop') }

  return {
    sessionQuery,
    install,
    needRefresh: pwa.needRefresh,
    offlineReady: pwa.offlineReady,
    isAccountMenuOpen,
    topBarAction,
    accountMenuRef,
    shellActions,
    accountInitials,
    logout,
    shouldShowInstallButton: !install.isStandalone && (install.installPrompt !== null || isIosDevice()),
    toggleAccountMenu: () => setIsAccountMenuOpen((current) => !current),
    openCompletedTasks,
    openDesktopMode,
    update: pwa.update,
  }
}
