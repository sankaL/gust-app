import { useEffect } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { isMobilePhoneDevice } from '../lib/device'

const DEVICE_REDIRECT_OVERRIDE_KEY = 'gust_device_redirected'

export function markDeviceRedirectOverride() {
  sessionStorage.setItem(DEVICE_REDIRECT_OVERRIDE_KEY, 'true')
}

export function useDeviceRedirect() {
  const navigate = useNavigate()
  const location = useLocation()

  useEffect(() => {
    // Prevent redirection loops when manually switching modes using navigation links
    if (sessionStorage.getItem(DEVICE_REDIRECT_OVERRIDE_KEY) === 'true') {
      return
    }

    const isPhone = isMobilePhoneDevice()
    const isDesktopPath = location.pathname.startsWith('/desktop')

    if (!isPhone && !isDesktopPath) {
      markDeviceRedirectOverride()
      void navigate('/desktop', { replace: true })
    } else if (isPhone && isDesktopPath) {
      markDeviceRedirectOverride()
      void navigate('/', { replace: true })
    }
  }, [navigate, location.pathname])
}
