import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { isMobilePhoneDevice } from '../lib/device'

export const DEVICE_REDIRECT_OVERRIDE_KEY = 'gust_device_redirected'

const MOBILE_TO_DESKTOP_PATHS: Record<string, string> = {
  '/tasks': '/desktop/tasks',
  '/tasks/completed': '/desktop/completed',
  '/tasks/groups': '/desktop/groups'
}

const DESKTOP_TO_MOBILE_PATHS: Record<string, string> = Object.fromEntries(
  Object.entries(MOBILE_TO_DESKTOP_PATHS).map(([mobilePath, desktopPath]) => [
    desktopPath,
    mobilePath
  ])
)

function mobileToDesktopDestination(pathname: string, search: string) {
  const mappedPath = MOBILE_TO_DESKTOP_PATHS[pathname]
  if (mappedPath) return `${mappedPath}${search}`
  return /^\/tasks\/[^/]+$/.test(pathname) ? `/desktop${pathname}${search}` : '/desktop'
}

function desktopToMobileDestination(pathname: string, search: string) {
  const mappedPath = DESKTOP_TO_MOBILE_PATHS[pathname]
  if (mappedPath) return `${mappedPath}${search}`
  return /^\/desktop\/tasks\/[^/]+$/.test(pathname)
    ? `${pathname.replace('/desktop', '')}${search}`
    : '/capture'
}

export function markDeviceRedirectOverride() {
  try {
    sessionStorage.setItem(DEVICE_REDIRECT_OVERRIDE_KEY, 'true')
  } catch {
    /* storage unavailable; redirect will still complete because the navigate call sits after this */
  }
}

export function resolveDeviceRedirect(pathname: string, search: string, isPhone: boolean) {
  const isDesktopPath = pathname.startsWith('/desktop')
  if (!isPhone && !isDesktopPath) return mobileToDesktopDestination(pathname, search)
  if (isPhone && isDesktopPath) return desktopToMobileDestination(pathname, search)
  return null
}

export function useDeviceRedirect() {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    // Prevent redirection loops when manually switching modes using navigation links
    if (sessionStorage.getItem(DEVICE_REDIRECT_OVERRIDE_KEY) === 'true') {
      return
    }

    const destination = resolveDeviceRedirect(
      location.pathname,
      location.search,
      isMobilePhoneDevice()
    )
    if (destination) {
      markDeviceRedirectOverride()
      void navigate(destination, { replace: true })
    }
  }, [navigate, location.pathname, location.search])
}
