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

function RootErrorState({ eyebrow, title, description, actionLabel, onAction }: {
  eyebrow: string
  title: string
  description: string
  actionLabel: string
  onAction: () => void
}) {
  return (
    <main className="safe-area-shell min-h-screen bg-surface text-on-surface">
      <div className="mx-auto flex min-h-screen w-full max-w-md items-center px-4">
        <section className="w-full space-y-4 text-center" role="alert">
          <div className="space-y-3">
            <p className="font-body text-xs uppercase tracking-[0.15em] text-on-surface-variant">
              {eyebrow}
            </p>
            <h1 className="font-display text-3xl text-on-surface">{title}</h1>
            <p className="font-body text-sm leading-6 text-on-surface-variant">{description}</p>
          </div>
          <button
            type="button"
            className="rounded-card bg-white px-5 py-3 font-display text-base font-bold text-black shadow-[0_5px_0_#a1a1aa,_0_8px_15px_rgba(0,0,0,0.4)] transition-all hover:-translate-y-[1px] active:translate-y-[4px] active:shadow-[0_0px_0_#a1a1aa,_0_2px_4px_rgba(0,0,0,0.4)]"
            onClick={onAction}
          >
            {actionLabel}
          </button>
        </section>
      </div>
    </main>
  )
}

function RootSessionError({ onRetry }: { onRetry: () => void }) {
  return <RootErrorState eyebrow="Session check" title="Could not open Gust" description="Gust could not verify your session. Check your connection and try again." actionLabel="Try again" onAction={onRetry} />
}

function RootLandingLoadError() {
  return <RootErrorState eyebrow="Landing page" title="Could not load Gust" description="The landing page did not finish loading. Refresh this page to try again." actionLabel="Refresh" onAction={() => window.location.reload()} />
}

type RootSessionResolutionProps = {
  authErrorCode: AuthErrorCode | null
  isError: boolean
  isLoading: boolean
  isSignedIn: boolean
  onRetry: () => void
}

function RootSessionResolution({
  authErrorCode,
  isError,
  isLoading,
  isSignedIn,
  onRetry,
}: RootSessionResolutionProps) {
  if (isLoading) {
    return <RootSessionLoading />
  }

  if (isSignedIn) {
    return <Navigate to="/capture" replace />
  }

  if (isError && !authErrorCode) {
    return <RootSessionError onRetry={onRetry} />
  }

  return (
    <RootLandingErrorBoundary>
      <Suspense fallback={<RootSessionLoading />}>
        <LandingRoute authErrorCode={authErrorCode} />
      </Suspense>
    </RootLandingErrorBoundary>
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

  const authErrorCode =
    resolveAuthErrorCode(searchParams.get('auth_error')) ??
    (sessionQuery.error instanceof ApiError && sessionQuery.error.code === 'auth_email_not_allowed'
      ? 'email_not_allowed'
      : null)

  return (
    <RootSessionResolution
      authErrorCode={authErrorCode}
      isError={sessionQuery.isError}
      isLoading={sessionQuery.isLoading}
      isSignedIn={sessionQuery.data?.signed_in === true}
      onRetry={() => {
        void sessionQuery.refetch()
      }}
    />
  )
}
