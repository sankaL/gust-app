import { Component, lazy, Suspense, type ReactNode } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Navigate, useSearchParams } from 'react-router-dom'

import { ApiError, getSessionStatus } from '../lib/api'

type AuthErrorCode = 'email_not_allowed'

// LandingRoute is lazy-loaded to keep GSAP out of the main entry chunk.
const LandingRoute = lazy(() =>
  import('./LandingRoute').then((m) => ({ default: m.LandingRoute }))
)

function resolveAuthErrorCode(rawCode: string | null): AuthErrorCode | null {
  return rawCode === 'email_not_allowed' ? rawCode : null
}

function RootSessionLoading() {
  return (
    <main className="safe-area-shell min-h-screen bg-surface text-on-surface">
      <div className="mx-auto flex min-h-screen w-full max-w-md items-center px-4">
        <section className="w-full space-y-3 text-center" aria-busy="true">
          <p className="font-body text-xs uppercase tracking-[0.15em] text-on-surface-variant">
            Session check
          </p>
          <h1 className="font-display text-3xl text-on-surface">Opening Gust</h1>
          <p className="font-body text-sm leading-6 text-on-surface-variant">
            Verifying your current session.
          </p>
        </section>
      </div>
    </main>
  )
}

function RootSessionError({ onRetry }: { onRetry: () => void }) {
  return (
    <main className="safe-area-shell min-h-screen bg-surface text-on-surface">
      <div className="mx-auto flex min-h-screen w-full max-w-md items-center px-4">
        <section className="w-full space-y-4 text-center" role="alert">
          <div className="space-y-3">
            <p className="font-body text-xs uppercase tracking-[0.15em] text-on-surface-variant">
              Session check
            </p>
            <h1 className="font-display text-3xl text-on-surface">Could not open Gust</h1>
            <p className="font-body text-sm leading-6 text-on-surface-variant">
              Gust could not verify your session. Check your connection and try again.
            </p>
          </div>
          <button
            type="button"
            className="rounded-card bg-white px-5 py-3 font-display text-base font-bold text-black shadow-[0_5px_0_#a1a1aa,_0_8px_15px_rgba(0,0,0,0.4)] transition-all hover:-translate-y-[1px] active:translate-y-[4px] active:shadow-[0_0px_0_#a1a1aa,_0_2px_4px_rgba(0,0,0,0.4)]"
            onClick={onRetry}
          >
            Try again
          </button>
        </section>
      </div>
    </main>
  )
}

function RootLandingLoadError() {
  return (
    <main className="safe-area-shell min-h-screen bg-surface text-on-surface">
      <div className="mx-auto flex min-h-screen w-full max-w-md items-center px-4">
        <section className="w-full space-y-4 text-center" role="alert">
          <div className="space-y-3">
            <p className="font-body text-xs uppercase tracking-[0.15em] text-on-surface-variant">
              Landing page
            </p>
            <h1 className="font-display text-3xl text-on-surface">Could not load Gust</h1>
            <p className="font-body text-sm leading-6 text-on-surface-variant">
              The landing page did not finish loading. Refresh this page to try again.
            </p>
          </div>
          <button
            type="button"
            className="rounded-card bg-white px-5 py-3 font-display text-base font-bold text-black shadow-[0_5px_0_#a1a1aa,_0_8px_15px_rgba(0,0,0,0.4)] transition-all hover:-translate-y-[1px] active:translate-y-[4px] active:shadow-[0_0px_0_#a1a1aa,_0_2px_4px_rgba(0,0,0,0.4)]"
            onClick={() => window.location.reload()}
          >
            Refresh
          </button>
        </section>
      </div>
    </main>
  )
}

class RootLandingErrorBoundary extends Component<
  { children: ReactNode },
  { hasError: boolean }
> {
  state = { hasError: false }

  static getDerivedStateFromError() {
    return { hasError: true }
  }

  render() {
    if (this.state.hasError) {
      return <RootLandingLoadError />
    }

    return this.props.children
  }
}

export function RootRoute() {
  const [searchParams] = useSearchParams()
  const sessionQuery = useQuery({
    queryKey: ['session-status'],
    queryFn: getSessionStatus,
    retry: false,
  })

  if (sessionQuery.isLoading) {
    return <RootSessionLoading />
  }

  const authErrorCode =
    resolveAuthErrorCode(searchParams.get('auth_error')) ??
    (sessionQuery.error instanceof ApiError && sessionQuery.error.code === 'auth_email_not_allowed'
      ? 'email_not_allowed'
      : null)

  if (sessionQuery.data?.signed_in) {
    return <Navigate to="/capture" replace />
  }

  if (sessionQuery.isError && !authErrorCode) {
    return (
      <RootSessionError
        onRetry={() => {
          void sessionQuery.refetch()
        }}
      />
    )
  }

  return (
    <RootLandingErrorBoundary>
      <Suspense fallback={<RootSessionLoading />}>
        <LandingRoute authErrorCode={authErrorCode} />
      </Suspense>
    </RootLandingErrorBoundary>
  )
}
