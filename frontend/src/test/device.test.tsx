import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { isMobilePhoneDevice } from '../lib/device'
import { AppProviders } from '../providers'
import { AppShell } from '../components/AppShell'
import { DesktopShell } from '../components/DesktopShell'
import { RootRoute } from '../routes/RootRoute'
import { DEVICE_REDIRECT_OVERRIDE_KEY } from '../hooks/useDeviceRedirect'
import { signedInSession, signedOutSession } from './session-fixtures'

const defaultUserAgent = window.navigator.userAgent
const defaultPlatform = window.navigator.platform
const defaultMaxTouchPoints = window.navigator.maxTouchPoints

function setUserAgent(ua: string, platform = 'MacIntel', touchPoints = 0) {
  Object.defineProperty(window.navigator, 'userAgent', {
    value: ua,
    configurable: true
  })
  Object.defineProperty(window.navigator, 'platform', {
    value: platform,
    configurable: true
  })
  Object.defineProperty(window.navigator, 'maxTouchPoints', {
    value: touchPoints,
    configurable: true
  })
}

function setMatchMedia({ landscape = false } = {}) {
  Object.defineProperty(window, 'matchMedia', {
    writable: true,
    value: vi.fn().mockImplementation((query: string) => ({
      matches: query === '(orientation: landscape)' && landscape,
      media: query,
      onchange: null,
      addListener: vi.fn(),
      removeListener: vi.fn(),
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
      dispatchEvent: vi.fn()
    }))
  })
}

function jsonResponse(body: unknown, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'Content-Type': 'application/json' }
  })
}

function requestUrl(input: RequestInfo | URL) {
  if (typeof input === 'string') {
    return input
  }
  if (input instanceof URL) {
    return input.toString()
  }
  return input.url
}

describe('Device detection utilities', () => {
  beforeEach(() => {
    sessionStorage.clear()
    setUserAgent(defaultUserAgent, defaultPlatform, defaultMaxTouchPoints)
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('detects iPhones as mobile phones', () => {
    setUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'iPhone',
      5
    )
    expect(isMobilePhoneDevice()).toBe(true)
  })

  it('detects Android phones as mobile phones', () => {
    setUserAgent(
      'Mozilla/5.0 (Linux; Android 10; SM-G973F) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/80.0.3987.149 Mobile Safari/537.36',
      'Linux armv8l',
      5
    )
    expect(isMobilePhoneDevice()).toBe(true)
  })

  it('detects iPads as NOT mobile phones (tablets)', () => {
    // Older iPad agent
    setUserAgent(
      'Mozilla/5.0 (iPad; CPU OS 12_2 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/12.1.1 Mobile/15E148 Safari/604.1',
      'iPad',
      5
    )
    expect(isMobilePhoneDevice()).toBe(false)

    // Modern iPad Pro (claims Macintosh, MacIntel platform, multi-touch points > 1)
    setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_6) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/14.0.1 Safari/605.1.15',
      'MacIntel',
      5
    )
    expect(isMobilePhoneDevice()).toBe(false)
  })

  it('detects macOS and Windows desktops as NOT mobile phones', () => {
    setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'MacIntel',
      0
    )
    expect(isMobilePhoneDevice()).toBe(false)

    setUserAgent(
      'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'Win32',
      0
    )
    expect(isMobilePhoneDevice()).toBe(false)
  })
})

describe('Device-specific routing redirection', () => {
  beforeEach(() => {
    sessionStorage.clear()
    setUserAgent(defaultUserAgent, defaultPlatform, defaultMaxTouchPoints)
    setMatchMedia()

    vi.stubGlobal(
      'fetch',
      vi.fn((url: string) => {
        if (url.includes('/auth/session')) {
          return jsonResponse(signedInSession())
        }
        if (url.includes('/groups')) {
          return jsonResponse([])
        }
        return jsonResponse({})
      })
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
    vi.unstubAllGlobals()
  })

  function renderRoutes(initialEntries: string[]) {
    const router = createMemoryRouter(
      [
        {
          path: '/',
          element: <RootRoute />
        },
        {
          path: '/',
          element: <AppShell />,
          children: [
            { path: 'capture', element: <div data-testid="mobile-capture">Mobile Capture</div> }
          ]
        },
        {
          path: '/desktop',
          element: <DesktopShell />,
          children: [
            { index: true, element: <div data-testid="desktop-dashboard">Desktop Dashboard</div> }
          ]
        }
      ],
      { initialEntries }
    )

    return {
      router,
      ...render(
        <AppProviders>
          <RouterProvider router={router} />
        </AppProviders>
      )
    }
  }

  it('redirects signed-in desktop visitors from / to /desktop', async () => {
    vi.mocked(fetch).mockImplementationOnce((input: RequestInfo | URL) => {
      const url = requestUrl(input)
      return Promise.resolve(
        url.includes('/auth/session') ? jsonResponse(signedInSession()) : jsonResponse({})
      )
    })
    setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'MacIntel',
      0
    )

    const { router } = renderRoutes(['/'])

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/desktop')
    })
    expect(await screen.findByTestId('desktop-dashboard')).toBeInTheDocument()
    expect(sessionStorage.getItem(DEVICE_REDIRECT_OVERRIDE_KEY)).toBe('true')
  })

  it('keeps the public landing page at / for signed-out desktop visitors', async () => {
    setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'MacIntel',
      0
    )
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(signedOutSession())))

    const { router } = renderRoutes(['/'])

    expect(
      await screen.findByRole('heading', { name: 'Speak it once,' }, { timeout: 5_000 })
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
    expect(sessionStorage.getItem(DEVICE_REDIRECT_OVERRIDE_KEY)).toBeNull()
  })

  it('redirects desktop/iPad users from /capture to /desktop on initial visit', async () => {
    setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'MacIntel',
      0
    )

    const { router } = renderRoutes(['/capture'])

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/desktop')
    })
    expect(sessionStorage.getItem(DEVICE_REDIRECT_OVERRIDE_KEY)).toBe('true')
  })

  it('redirects mobile phone users from /desktop to /capture on initial visit', async () => {
    setUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'iPhone',
      5
    )

    const { router } = renderRoutes(['/desktop'])

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/capture')
    })
    expect(sessionStorage.getItem(DEVICE_REDIRECT_OVERRIDE_KEY)).toBe('true')
  })

  it('does NOT redirect a desktop user visiting /capture if they already have the gust_device_redirected flag set', async () => {
    setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'MacIntel',
      0
    )
    sessionStorage.setItem(DEVICE_REDIRECT_OVERRIDE_KEY, 'true')

    const { router } = renderRoutes(['/capture'])

    // Wait a brief moment to ensure no redirect happens
    await act(async () => {
      await new Promise((r) => setTimeout(r, 100))
    })
    expect(router.state.location.pathname).toBe('/capture')
  })

  it('keeps desktop users in mobile mode after using the desktop capture shortcut', async () => {
    setUserAgent(
      'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
      'MacIntel',
      0
    )

    const { router } = renderRoutes(['/desktop'])

    const mobileCaptureLink = await screen.findByRole('link', { name: /^capture$/i })
    expect(sessionStorage.getItem(DEVICE_REDIRECT_OVERRIDE_KEY)).toBeNull()

    fireEvent.click(mobileCaptureLink)

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/capture')
    })
    expect(sessionStorage.getItem(DEVICE_REDIRECT_OVERRIDE_KEY)).toBe('true')
  })

  it('redirects signed-in mobile phone visitors from / to /capture', async () => {
    vi.mocked(fetch).mockImplementationOnce((input: RequestInfo | URL) => {
      const url = requestUrl(input)
      return Promise.resolve(
        url.includes('/auth/session') ? jsonResponse(signedInSession()) : jsonResponse({})
      )
    })
    setUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'iPhone',
      5
    )

    const { router } = renderRoutes(['/'])

    await waitFor(() => {
      expect(router.state.location.pathname).toBe('/capture')
    })
    expect(await screen.findByTestId('mobile-capture')).toBeInTheDocument()
    expect(sessionStorage.getItem(DEVICE_REDIRECT_OVERRIDE_KEY)).toBeNull()
  })

  it('keeps the public landing page at / for signed-out mobile phone visitors', async () => {
    setUserAgent(
      'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1',
      'iPhone',
      5
    )
    vi.stubGlobal('fetch', vi.fn(() => jsonResponse(signedOutSession())))

    const { router } = renderRoutes(['/'])

    expect(
      await screen.findByRole('heading', { name: 'Speak it once,' }, { timeout: 5_000 })
    ).toBeInTheDocument()
    expect(router.state.location.pathname).toBe('/')
  })
})
