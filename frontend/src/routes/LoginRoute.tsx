import { useQuery } from '@tanstack/react-query'
import { Navigate, useSearchParams } from 'react-router-dom'

import { PortraitOrientationGuard } from '../components/PortraitOrientationGuard'
import { SessionRequiredCard } from '../components/SessionRequiredCard'
import { ApiError, getSessionStatus } from '../lib/api'

const EMAIL_NOT_ALLOWED_MESSAGE =
  'You are not part of the user list that has access to this app. If you should have access, please contact the administrator.'

function resolveNextPath(nextPath: string | null): string {
  if (!nextPath) {
    return '/'
  }

  let normalizedPath: string
  try {
    normalizedPath = decodeURIComponent(nextPath)
  } catch {
    return '/'
  }

  if (!normalizedPath.startsWith('/')) {
    return '/'
  }
  if (normalizedPath.startsWith('//')) {
    return '/'
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
            <h1 className="font-display text-3xl text-on-surface">Loading login</h1>
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
          <div className="space-y-2 flex flex-col items-center text-center">
            <div className="flex items-center justify-center gap-2">
              <img src="/logos/gust-wind-electric.svg" alt="Gust" className="h-7 w-7" />
              <h1 className="font-display text-3xl text-on-surface">Gust</h1>
            </div>
            <p className="font-body text-sm leading-6 text-on-surface-variant">
              Sign in to open your personal task workspace.
            </p>
          </div>

          <SessionRequiredCard errorMessage={errorMessage} />
        </section>
      </div>
    </main>
  )
}
