type AppConfig = {
  apiBaseUrl: string
  devMode: boolean
  environmentLabel: string
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

  return window.location.origin
}

export function getAppConfig(): AppConfig {
  const devMode = import.meta.env.VITE_GUST_DEV_MODE === 'true'
  const apiBaseUrl = normalizeBaseUrl(import.meta.env.VITE_API_BASE_URL ?? inferApiBaseUrl())

  return {
    apiBaseUrl,
    devMode,
    environmentLabel: devMode ? 'Local dev mode' : 'Standard mode'
  }
}
