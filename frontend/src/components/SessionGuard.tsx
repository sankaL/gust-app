import { type ReactNode } from 'react'

import { type SessionStatus } from '../lib/api'
import { SessionRequiredCard } from './SessionRequiredCard'

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

        <SessionRequiredCard />
      </section>
    )
  }

  return <>{children}</>
}
