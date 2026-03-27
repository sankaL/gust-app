type AppConfig = {
  apiBaseUrl: string
  devMode: boolean
  environmentLabel: string
}

export function getAppConfig(): AppConfig {
  const devMode = import.meta.env.VITE_GUST_DEV_MODE === 'true'
  const apiBaseUrl = import.meta.env.VITE_API_BASE_URL ?? 'http://localhost:8000'

  return {
    apiBaseUrl,
    devMode,
    environmentLabel: devMode ? 'Local dev mode' : 'Standard mode'
  }
}
