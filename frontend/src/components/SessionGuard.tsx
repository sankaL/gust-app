import { type ReactNode } from 'react'

import { getAuthStartUrl, type SessionStatus } from '../lib/api'

type SessionGuardProps = {
  session: SessionStatus | undefined
  isLoading: boolean
  isError: boolean
  title: string
  eyebrow: string
  description: string
  children: ReactNode
}

export function SessionGuard({
  session,
  isLoading,
  isError,
  title,
  eyebrow,
  description,
  children
}: SessionGuardProps) {
  if (isLoading) {
    return (
      <section className="space-y-6" aria-busy="true">
        <div className="space-y-3">
          <p className="font-body text-sm uppercase tracking-[0.25em] text-on-surface-variant">
            Session check
          </p>
          <h2 className="font-display text-3xl text-on-surface">{title}</h2>
          <p className="max-w-sm font-body text-base leading-7 text-on-surface-variant">
            Verifying your session before loading this screen.
          </p>
        </div>
      </section>
    )
  }

  if (isError || !session?.signed_in) {
    return (
      <section className="space-y-6">
        <div className="space-y-3">
          <p className="font-body text-sm uppercase tracking-[0.25em] text-on-surface-variant">
            {eyebrow}
          </p>
          <h2 className="font-display text-3xl text-on-surface">{title}</h2>
          <p className="max-w-sm font-body text-base leading-7 text-on-surface-variant">
            {description}
          </p>
        </div>

        <div className="rounded-soft border border-outline/40 bg-surface-container p-6 shadow-ambient">
          <div className="space-y-4">
            <p className="font-display text-2xl text-on-surface">Session Required</p>
            <p className="font-body text-sm leading-6 text-on-surface-variant">
              Gust fails closed when session state is missing. Sign in with Google to continue.
            </p>
            <a
              href={getAuthStartUrl()}
              className="inline-flex rounded-pill bg-primary px-5 py-3 font-body text-sm font-medium text-surface"
            >
              Sign in with Google
            </a>
          </div>
        </div>
      </section>
    )
  }

  return <>{children}</>
}
