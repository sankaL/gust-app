/// <reference types="vite-plugin-pwa/client" />
/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  readonly VITE_GUST_DEV_MODE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}

interface BeforeInstallPromptEvent extends Event {
  prompt: () => Promise<void>
  userChoice: Promise<{
    outcome: 'accepted' | 'dismissed'
    platform: string
  }>
}

interface WakeLockSentinel extends EventTarget {
  readonly released: boolean
  release: () => Promise<void>
}

interface WakeLock {
  request: (type: 'screen') => Promise<WakeLockSentinel>
}

interface Navigator {
  standalone?: boolean
  wakeLock?: WakeLock
}
