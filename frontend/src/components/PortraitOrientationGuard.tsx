import { useCallback, useEffect, useState } from 'react'

import { Card } from './Card'

const mobileUserAgentPattern = /android|iphone|ipad|ipod/i

function matchesMedia(query: string) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }

  return Boolean(window.matchMedia(query)?.matches)
}

function isCoarsePointerDevice() {
  if (matchesMedia('(pointer: coarse)')) {
    return true
  }

  if (typeof window === 'undefined') {
    return false
  }

  return mobileUserAgentPattern.test(window.navigator.userAgent)
}

function isLandscapeOrientation() {
  if (matchesMedia('(orientation: landscape)')) {
    return true
  }

  if (typeof window === 'undefined') {
    return false
  }

  return window.innerWidth > window.innerHeight
}

function shouldShowPortraitGuard() {
  return isCoarsePointerDevice() && isLandscapeOrientation()
}

async function tryLockPortraitOrientation() {
  if (typeof screen === 'undefined' || !screen.orientation) {
    return
  }

  const orientation = screen.orientation as ScreenOrientation & {
    lock?: (orientation: 'portrait') => Promise<void>
  }

  if (typeof orientation.lock !== 'function') {
    return
  }

  try {
    await orientation.lock('portrait')
  } catch {
    // Ignore unsupported browsers and contexts that reject orientation lock.
  }
}

export function PortraitOrientationGuard() {
  const [showGuard, setShowGuard] = useState(() => shouldShowPortraitGuard())

  const syncGuard = useCallback(() => {
    setShowGuard(shouldShowPortraitGuard())
  }, [])

  useEffect(() => {
    syncGuard()
    void tryLockPortraitOrientation()

    window.addEventListener('resize', syncGuard)
    window.addEventListener('orientationchange', syncGuard)

    return () => {
      window.removeEventListener('resize', syncGuard)
      window.removeEventListener('orientationchange', syncGuard)
    }
  }, [syncGuard])

  if (!showGuard) {
    return null
  }

  return (
    <div className="safe-area-overlay fixed inset-0 z-[120] flex items-center justify-center bg-surface/95 backdrop-blur-md">
      <Card className="w-full max-w-sm bg-surface-container-high/95 shadow-[0_0_48px_rgba(186,158,255,0.18)]">
        <div className="space-y-3 text-center">
          <p className="font-body text-[0.65rem] uppercase tracking-[0.2em] text-primary">
            Portrait Only
          </p>
          <h2 className="font-display text-2xl text-on-surface">Rotate your device upright</h2>
          <p className="font-body text-sm leading-6 text-on-surface-variant">
            Gust is optimized for portrait capture. Turn your device back to continue using
            the app.
          </p>
        </div>
      </Card>
    </div>
  )
}
