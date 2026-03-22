/// <reference types="vite/client" />

interface ImportMetaEnv {
  readonly VITE_API_BASE_URL?: string
  readonly VITE_GUST_DEV_MODE?: string
}

interface ImportMeta {
  readonly env: ImportMetaEnv
}
