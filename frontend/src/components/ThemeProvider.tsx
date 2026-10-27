import { useCallback, useEffect, useLayoutEffect, useMemo, useState, type PropsWithChildren } from 'react'

import {
  applyThemeToDocument,
  readThemePreference,
  resolveTheme,
  systemPrefersDark,
  writeThemePreference,
  type ThemePalette,
  type ThemePreference,
} from '../lib/theme'
import { ThemeContext } from '../hooks/useTheme'

function useSystemDarkMode() {
  const [prefersDark, setPrefersDark] = useState(systemPrefersDark)
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return undefined
    const query = window.matchMedia('(prefers-color-scheme: dark)')
    if (!query?.addEventListener) return undefined
    const handleChange = (event: MediaQueryListEvent) => setPrefersDark(event.matches)
    query.addEventListener('change', handleChange)
    return () => query.removeEventListener('change', handleChange)
  }, [])
  return prefersDark
}

export function ThemeProvider({ children }: PropsWithChildren) {
  const [preference, setPreferenceState] = useState<ThemePreference>(readThemePreference)
  const [palette, setPalette] = useState<ThemePalette>('default')
  const prefersDark = useSystemDarkMode()
  const resolvedTheme = resolveTheme(preference, prefersDark)

  useLayoutEffect(() => {
    applyThemeToDocument(resolvedTheme, palette)
  }, [palette, resolvedTheme])

  const setPreference = useCallback((next: ThemePreference) => {
    writeThemePreference(next)
    setPreferenceState(next)
  }, [])

  const value = useMemo(() => ({ preference, resolvedTheme, setPreference, setPalette }), [preference, resolvedTheme, setPreference])
  return <ThemeContext.Provider value={value}>{children}</ThemeContext.Provider>
}
