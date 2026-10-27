import { createContext, useContext, useLayoutEffect } from 'react'

import type { ResolvedTheme, ThemePalette, ThemePreference } from '../lib/theme'

export type ThemeContextValue = {
  preference: ThemePreference
  resolvedTheme: ResolvedTheme
  setPreference: (preference: ThemePreference) => void
  setPalette: (palette: ThemePalette) => void
}

export const ThemeContext = createContext<ThemeContextValue | null>(null)

const STATIC_THEME: ThemeContextValue = {
  preference: 'light',
  resolvedTheme: 'light',
  setPreference: () => undefined,
  setPalette: () => undefined,
}

export function useTheme(): ThemeContextValue {
  // Isolated component renders (tests, previews) fall back to the default light theme.
  return useContext(ThemeContext) ?? STATIC_THEME
}

/** Desktop keeps its original violet palette in dark mode; mobile uses the midnight palette. */
export function useClassicDarkPalette() {
  const { setPalette } = useTheme()
  useLayoutEffect(() => {
    setPalette('classic')
    return () => setPalette('default')
  }, [setPalette])
}
