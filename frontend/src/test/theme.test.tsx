import { readFileSync } from 'node:fs'
import path from 'node:path'
import { runInThisContext } from 'node:vm'

import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { ThemeProvider } from '../components/ThemeProvider'
import { AccountSheet } from '../components/shell/AccountSheet'
import { useClassicDarkPalette } from '../hooks/useTheme'
import { applyThemeToDocument, readThemePreference, resolveTheme } from '../lib/theme'

function resetDocumentTheme() {
  delete document.documentElement.dataset.theme
  delete document.documentElement.dataset.palette
  document.head.innerHTML = '<meta name="theme-color" content="#ecf1ed" />'
}

function themeColor() {
  return document.querySelector('meta[name="theme-color"]')?.getAttribute('content')
}

function stubPrefersDark(matches: boolean) {
  vi.stubGlobal('matchMedia', vi.fn(() => ({ matches, addEventListener: vi.fn(), removeEventListener: vi.fn() })))
}

beforeEach(() => {
  localStorage.clear()
  resetDocumentTheme()
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

describe('theme preference', () => {
  it('reads only known preferences and falls back to light', () => {
    expect(readThemePreference()).toBe('light')
    localStorage.setItem('gust_theme', 'dark')
    expect(readThemePreference()).toBe('dark')
    localStorage.setItem('gust_theme', 'neon')
    expect(readThemePreference()).toBe('light')
    vi.spyOn(Storage.prototype, 'getItem').mockImplementation(() => { throw new Error('blocked') })
    expect(readThemePreference()).toBe('light')
  })

  it('resolves system against the OS setting', () => {
    expect(resolveTheme('system', true)).toBe('dark')
    expect(resolveTheme('system', false)).toBe('light')
    expect(resolveTheme('dark', false)).toBe('dark')
  })

  it('applies theme, palette and browser chrome color to the document', () => {
    applyThemeToDocument('dark', 'default')
    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(document.documentElement.dataset.palette).toBeUndefined()
    expect(themeColor()).toBe('#12172b')

    applyThemeToDocument('dark', 'classic')
    expect(document.documentElement.dataset.palette).toBe('classic')
    expect(themeColor()).toBe('#090614')
  })
})

function renderAccountSheet(onLogout = vi.fn(), onClose = vi.fn()) {
  render(
    <ThemeProvider>
      <AccountSheet open onClose={onClose} email="user@example.com" displayName="Gust User" initials="GU" isLoggingOut={false} canInstall={false} installLabel="Install" onInstall={vi.fn()} onCompletedTasks={vi.fn()} onSettings={vi.fn()} onDesktopMode={vi.fn()} onLogout={onLogout} />
    </ThemeProvider>
  )
  return { onLogout }
}

describe('theme provider and account sheet', () => {
  it('switches and persists the theme from the account sheet', async () => {
    stubPrefersDark(false)
    renderAccountSheet()
    expect(document.documentElement.dataset.theme).toBe('light')

    await userEvent.setup().click(screen.getByRole('radio', { name: 'Dark' }))

    expect(document.documentElement.dataset.theme).toBe('dark')
    expect(localStorage.getItem('gust_theme')).toBe('dark')
  })

  it('follows the OS setting for the Auto preference', () => {
    stubPrefersDark(true)
    localStorage.setItem('gust_theme', 'system')
    renderAccountSheet()
    expect(document.documentElement.dataset.theme).toBe('dark')
  })

  it('opens straight on the signed-in card with no visible header but stays closable', async () => {
    const onClose = vi.fn()
    renderAccountSheet(vi.fn(), onClose)
    const sheet = screen.getByRole('dialog', { name: 'Account' })
    expect(sheet.querySelector('h2')).toBeNull()
    expect(screen.getByText('Gust User')).toBeInTheDocument()

    // Swipe and backdrop tap are hidden from screen readers, so a visually hidden close button stays reachable.
    const close = screen.getByRole('button', { name: 'Close account menu' })
    expect(close).toHaveClass('sheet-hidden-close')
    await userEvent.setup().click(close)
    expect(onClose).toHaveBeenCalledTimes(1)

    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('signs out from the account sheet', async () => {
    const { onLogout } = renderAccountSheet()
    await userEvent.setup().click(screen.getByRole('menuitem', { name: 'Logout' }))
    expect(onLogout).toHaveBeenCalledTimes(1)
  })

  it('uses the classic palette only while a desktop shell is mounted', () => {
    function DesktopProbe() {
      useClassicDarkPalette()
      return null
    }
    const { unmount } = render(<ThemeProvider><DesktopProbe /></ThemeProvider>)
    expect(document.documentElement.dataset.palette).toBe('classic')
    unmount()
    render(<ThemeProvider><span /></ThemeProvider>)
    expect(document.documentElement.dataset.palette).toBeUndefined()
  })
})

describe('pre-paint theme script', () => {
  const html = readFileSync(path.resolve(import.meta.dirname, '../../index.html'), 'utf8')
  const script = /<script>([\s\S]*?)<\/script>/.exec(html)?.[1] ?? ''

  function runPrePaintScript() {
    runInThisContext(script)
  }

  it('applies a saved dark theme before React mounts, matching ThemeProvider', () => {
    localStorage.setItem('gust_theme', 'dark')
    runPrePaintScript()
    const prePaint = { theme: document.documentElement.dataset.theme, color: themeColor() }

    resetDocumentTheme()
    applyThemeToDocument(resolveTheme(readThemePreference(), false), 'default')
    expect(prePaint).toEqual({ theme: document.documentElement.dataset.theme, color: themeColor() })
  })

  it('resolves the Auto preference from the OS setting and defaults to light', () => {
    stubPrefersDark(true)
    localStorage.setItem('gust_theme', 'system')
    runPrePaintScript()
    expect(document.documentElement.dataset.theme).toBe('dark')

    resetDocumentTheme()
    localStorage.clear()
    runPrePaintScript()
    expect(document.documentElement.dataset.theme).toBe('light')
    expect(themeColor()).toBe('#ecf1ed')
  })
})
