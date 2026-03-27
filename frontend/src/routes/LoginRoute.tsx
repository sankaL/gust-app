import { useQuery } from '@tanstack/react-query'
import { Navigate, useSearchParams } from 'react-router-dom'

import { SessionRequiredCard } from '../components/SessionRequiredCard'
import { getSessionStatus } from '../lib/api'
import { getAppConfig } from '../lib/config'

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
    queryFn: getSessionStatus
  })
  const config = getAppConfig()

  const nextPath = resolveNextPath(searchParams.get('next'))

  if (sessionQuery.isLoading) {
    return (
      <main className="min-h-screen bg-surface text-on-surface">
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
    <main className="min-h-screen bg-surface text-on-surface">
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
            <p className="font-body text-xs uppercase tracking-[0.15em] text-on-surface-variant">
              {config.environmentLabel}
            </p>
          </div>

          <SessionRequiredCard />
        </section>
      </div>
    </main>
  )
}
