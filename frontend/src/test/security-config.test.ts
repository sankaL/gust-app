import { readdirSync, readFileSync, statSync } from 'node:fs'
import path from 'node:path'

import { getAppConfig } from '../lib/config'

const SRC_ROOT = path.resolve(import.meta.dirname, '..')
const ALLOWED_ENV_KEYS = new Set([
  'MODE',
  'VITE_ADMIN_EMAIL',
  'VITE_API_BASE_URL',
  'VITE_GUST_DEV_MODE'
])
const FORBIDDEN_ENV_PREFIXES = ['VITE_SUPABASE', 'VITE_OPENROUTER', 'VITE_MISTRAL', 'VITE_RESEND']

function collectSourceFiles(directory: string): string[] {
  const entries = readdirSync(directory)
  const files: string[] = []

  for (const entry of entries) {
    const fullPath = path.join(directory, entry)
    const stats = statSync(fullPath)
    if (stats.isDirectory()) {
      files.push(...collectSourceFiles(fullPath))
      continue
    }
    if ((fullPath.endsWith('.ts') || fullPath.endsWith('.tsx')) && !fullPath.includes('/test/')) {
      files.push(fullPath)
    }
  }

  return files
}

describe('frontend env safety', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('only reads approved VITE env keys from source files', () => {
    const files = collectSourceFiles(SRC_ROOT)
    const discoveredKeys = new Set<string>()

    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      const matches = source.matchAll(/import\.meta\.env\.([A-Z0-9_]+)/g)
      for (const match of matches) {
        discoveredKeys.add(match[1])
      }
    }

    expect([...discoveredKeys].sort()).toEqual([...ALLOWED_ENV_KEYS].sort())
  })

  it('does not reference provider-oriented VITE env prefixes anywhere in src', () => {
    const files = collectSourceFiles(SRC_ROOT)

    for (const file of files) {
      const source = readFileSync(file, 'utf8')
      for (const prefix of FORBIDDEN_ENV_PREFIXES) {
        expect(source.includes(prefix)).toBe(false)
      }
    }
  })

  it('rejects a cleartext production API origin', () => {
    vi.stubEnv('VITE_GUST_DEV_MODE', 'false')
    vi.stubEnv('VITE_API_BASE_URL', 'http://api.gustapp.ca')

    expect(() => getAppConfig()).toThrow('must use HTTPS')
  })

  it('rejects a non-URL API base', () => {
    vi.stubEnv('VITE_GUST_DEV_MODE', 'false')
    vi.stubEnv('VITE_API_BASE_URL', 'api.gustapp.ca')

    expect(() => getAppConfig()).toThrow('must be an absolute URL')
  })

  it('rejects API origins containing credentials or paths', () => {
    vi.stubEnv('VITE_GUST_DEV_MODE', 'false')
    vi.stubEnv('VITE_API_BASE_URL', 'https://user:password@api.gustapp.ca/v1')

    expect(() => getAppConfig()).toThrow('must not contain credentials')
  })

  it('rejects API origins containing query parameters', () => {
    vi.stubEnv('VITE_GUST_DEV_MODE', 'false')
    vi.stubEnv('VITE_API_BASE_URL', 'https://api.gustapp.ca?redirect=https://evil.example')

    expect(() => getAppConfig()).toThrow('must not contain credentials')
  })

  it('allows cleartext localhost only in dev mode', () => {
    vi.stubEnv('VITE_GUST_DEV_MODE', 'true')
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:8000')

    expect(getAppConfig().apiBaseUrl).toBe('http://localhost:8000')
  })

  it('rejects explicitly configured cleartext localhost outside dev mode', () => {
    vi.stubEnv('VITE_GUST_DEV_MODE', 'false')
    vi.stubEnv('VITE_API_BASE_URL', 'http://localhost:8000')

    expect(() => getAppConfig()).toThrow('must use HTTPS')
  })
})
