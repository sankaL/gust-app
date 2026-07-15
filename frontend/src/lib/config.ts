type AppConfig = {
  apiBaseUrl: string
  devMode: boolean
}

const LOOPBACK_HOSTS = new Set(['localhost', '127.0.0.1', '[::1]'])

function parseAbsoluteUrl(value: string): URL {
  try {
    return new URL(value)
  } catch {
    throw new Error('VITE_API_BASE_URL must be an absolute URL.')
  }
}

function assertSafeProtocol(parsed: URL, allowLocalHttp: boolean): void {
  const localHttpAllowed =
    allowLocalHttp && LOOPBACK_HOSTS.has(parsed.hostname) && parsed.protocol === 'http:'

  if (parsed.protocol !== 'https:' && !localHttpAllowed) {
    throw new Error('VITE_API_BASE_URL must use HTTPS outside local development.')
  }
}

function assertOriginOnly(parsed: URL): void {
  if (parsed.username || parsed.password || parsed.search || parsed.hash) {
    throw new Error('VITE_API_BASE_URL must not contain credentials, a query, or a fragment.')
  }
  if (parsed.pathname !== '/' && parsed.pathname !== '') {
    throw new Error('VITE_API_BASE_URL must not contain a path.')
  }
}

function normalizeBaseUrl(value: string, allowLocalHttp: boolean): string {
  const parsed = parseAbsoluteUrl(value)
  assertSafeProtocol(parsed, allowLocalHttp)
  assertOriginOnly(parsed)

  return parsed.origin
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
  const configuredApiBaseUrl = import.meta.env.VITE_API_BASE_URL
  const apiBaseUrl = normalizeBaseUrl(
    configuredApiBaseUrl ?? inferApiBaseUrl(),
    devMode || configuredApiBaseUrl === undefined
  )

  return {
    apiBaseUrl,
    devMode
  }
}
