import { useCallback, useEffect, useState } from 'react'

import { Card } from './Card'

import { isMobilePhoneDevice } from '../lib/device'

function matchesMedia(query: string) {
  if (typeof window === 'undefined' || typeof window.matchMedia !== 'function') {
    return false
  }

  return Boolean(window.matchMedia(query)?.matches)
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
  return isMobilePhoneDevice() && isLandscapeOrientation()
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
  // In-memory dismiss: reactivates if the user navigates away and back while
  // still in landscape. Dismissed state resets automatically on portrait rotation.
  const [dismissed, setDismissed] = useState(false)

  const syncGuard = useCallback(() => {
    const shouldShow = shouldShowPortraitGuard()
    setShowGuard(shouldShow)
    // Auto-reset dismiss when the user rotates back to portrait
    if (!shouldShow) setDismissed(false)
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

  if (!showGuard || dismissed) {
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
          <button
            type="button"
            onClick={() => setDismissed(true)}
            className="mt-2 w-full rounded-xl border border-white/10 bg-white/5 py-2.5 font-body text-sm font-medium text-on-surface-variant transition-colors hover:bg-white/10 active:bg-white/[0.03]"
          >
            Continue anyway
          </button>
        </div>
      </Card>
    </div>
  )
}

