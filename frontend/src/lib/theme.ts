export type ThemePreference = 'light' | 'dark' | 'system'
export type ResolvedTheme = 'light' | 'dark'
export type ThemePalette = 'default' | 'classic'

// Appearance is a non-sensitive UI preference, so it is the one value Gust keeps in localStorage.
const THEME_STORAGE_KEY = 'gust_theme'
const DEFAULT_THEME_PREFERENCE: ThemePreference = 'light'

const THEME_COLORS: Record<ResolvedTheme | 'classic', string> = {
  light: '#ecf1ed',
  dark: '#12172b',
  classic: '#090614',
}

function isThemePreference(value: unknown): value is ThemePreference {
  return value === 'light' || value === 'dark' || value === 'system'
}

export function readThemePreference(): ThemePreference {
  try {
    const stored = window.localStorage.getItem(THEME_STORAGE_KEY)
    return isThemePreference(stored) ? stored : DEFAULT_THEME_PREFERENCE
  } catch {
    return DEFAULT_THEME_PREFERENCE
  }
}

export function writeThemePreference(preference: ThemePreference) {
  try {
    window.localStorage.setItem(THEME_STORAGE_KEY, preference)
  } catch {
    /* storage unavailable (private mode); the choice still applies for this visit */
  }
}

export function systemPrefersDark(): boolean {
  return typeof window.matchMedia === 'function' && Boolean(window.matchMedia('(prefers-color-scheme: dark)')?.matches)
}

export function resolveTheme(preference: ThemePreference, prefersDark = systemPrefersDark()): ResolvedTheme {
  if (preference === 'system') return prefersDark ? 'dark' : 'light'
  return preference
}

export function applyThemeToDocument(theme: ResolvedTheme, palette: ThemePalette) {
  const root = document.documentElement
  root.dataset.theme = theme
  if (palette === 'classic') root.dataset.palette = 'classic'
  else delete root.dataset.palette
  const color = theme === 'dark' && palette === 'classic' ? THEME_COLORS.classic : THEME_COLORS[theme]
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', color)
}
