import { useQuery } from '@tanstack/react-query'
import { Navigate, useSearchParams } from 'react-router-dom'

import { PortraitOrientationGuard } from '../components/PortraitOrientationGuard'
import { SessionRequiredCard } from '../components/SessionRequiredCard'
import { ApiError, getSessionStatus } from '../lib/api'
import { defaultSignedInPath } from '../lib/device'
import { EMAIL_NOT_ALLOWED_MESSAGE } from '../lib/sessionPresentation'

function resolveNextPath(nextPath: string | null): string {
  if (!nextPath) {
    return defaultSignedInPath()
  }

  let normalizedPath: string
  try {
    normalizedPath = decodeURIComponent(nextPath)
  } catch {
    return defaultSignedInPath()
  }

  if (!normalizedPath.startsWith('/')) {
    return defaultSignedInPath()
  }
  if (normalizedPath.startsWith('//')) {
    return defaultSignedInPath()
  }
  return normalizedPath
}

export function LoginRoute() {
  const [searchParams] = useSearchParams()
  const sessionQuery = useQuery({
    queryKey: ['session-status'],
    queryFn: getSessionStatus,
    retry: false,
  })

  const nextPath = resolveNextPath(searchParams.get('next'))
  const authError = searchParams.get('auth_error')
  const authErrorMessage = authError === 'email_not_allowed' ? EMAIL_NOT_ALLOWED_MESSAGE : null
  const sessionErrorMessage =
    sessionQuery.error instanceof ApiError && sessionQuery.error.code === 'auth_email_not_allowed'
      ? EMAIL_NOT_ALLOWED_MESSAGE
      : null
  const errorMessage = authErrorMessage ?? sessionErrorMessage

  if (sessionQuery.isLoading) {
    return (
      <main className="safe-area-shell min-h-screen bg-surface text-on-surface">
        <PortraitOrientationGuard />
        <div className="mx-auto flex min-h-screen w-full max-w-md items-center px-4">
          <section className="w-full space-y-3 flex flex-col items-center text-center" aria-busy="true">
            <p className="font-body text-xs uppercase tracking-[0.15em] text-on-surface-variant">
              Session check
            </p>
            <h1 className="font-display text-3xl font-extrabold tracking-[-0.02em] text-on-surface">Loading login</h1>
            <p className="font-body text-sm leading-6 text-on-surface-variant">
              Verifying your current session.
            </p>
          </section>
        </div>
      </main>
    )
  }

  if (sessionQuery.data?.signed_in) {
    return <Navigate to={nextPath} replace />
  }

  return (
    <main className="safe-area-shell min-h-screen bg-surface text-on-surface">
      <PortraitOrientationGuard />
      <div className="mx-auto flex min-h-screen w-full max-w-md items-center px-4 py-8">
        <section className="w-full space-y-6">
          <div className="animate-rise-in flex flex-col items-center space-y-3 text-center">
            <span className="flex h-16 w-16 items-center justify-center rounded-[1.4rem] bg-surface-container-high shadow-float ring-1 ring-outline/50">
              <img src="/logos/gust-wind-electric.svg" alt="" className="h-9 w-9" />
            </span>
            <h1 className="font-display text-[2.2rem] font-extrabold tracking-[-0.03em] text-on-surface">Gust</h1>
            <p className="max-w-[16rem] font-body text-[0.95rem] leading-6 text-on-surface-variant">
              Say it once. Gust turns your voice into tasks.
            </p>
          </div>

          <SessionRequiredCard errorMessage={errorMessage} />
        </section>
      </div>
    </main>
  )
}
