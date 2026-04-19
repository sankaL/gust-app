type AppConfig = {
  apiBaseUrl: string
  devMode: boolean
}

function normalizeBaseUrl(value: string): string {
  return value.replace(/\/+$/, '')
}

function inferApiBaseUrl(): string {
  if (typeof window === 'undefined') {
    return 'http://localhost:8000'
  }

  const { hostname } = window.location

  if (hostname === 'gustapp.ca' || hostname.endsWith('.gustapp.ca')) {
    return 'https://api.gustapp.ca'
  }

  if (
    hostname === 'localhost' ||
    hostname === '127.0.0.1' ||
    hostname === '[::1]'
  ) {
    return 'http://localhost:8000'
  }

  // For local network IPs (e.g., 192.168.x.x), use the same IP for the backend
  return window.location.origin.replace(/:\d+$/, ':8000')
}

export function getAppConfig(): AppConfig {
  const devMode = import.meta.env.VITE_GUST_DEV_MODE === 'true'
  
  // In dev mode, infer the API URL from the current location to support
  // accessing from local network IPs (e.g., 192.168.x.x for mobile testing)
  let apiBaseUrl: string
  if (devMode && typeof window !== 'undefined') {
    apiBaseUrl = inferApiBaseUrl()
  } else {
    apiBaseUrl = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL ?? inferApiBaseUrl())
  }

  return {
    apiBaseUrl,
    devMode
  }
}
