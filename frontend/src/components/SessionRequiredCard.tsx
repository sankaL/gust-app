import { useState, type FormEvent } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'

import {
  ApiError,
  signInWithLocalDevAccount,
  signInWithPassword,
  type SessionStatus
} from '../lib/api'
import { getAppConfig } from '../lib/config'
import { EMAIL_NOT_ALLOWED_MESSAGE } from '../lib/sessionPresentation'

function buildFriendlyMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message
  }

  return fallback
}

const ERROR_PANEL_CLASS =
  'rounded-card bg-chip-rose px-4 py-3 text-center ring-1 ring-inset ring-tertiary/25'

const INPUT_CLASS =
  'w-full rounded-card bg-surface-container-high px-4 py-3.5 text-sm text-on-surface outline-none ring-1 ring-inset ring-outline/60 transition-shadow focus:ring-2 focus:ring-primary/60'

function buildSignInErrorMessage(error: unknown): string {
  if (error instanceof ApiError && error.code === 'auth_email_not_allowed') {
    return EMAIL_NOT_ALLOWED_MESSAGE
  }
  return buildFriendlyMessage(error, 'Sign-in failed. Please try again.')
}

function PasswordSignInForm() {
  const queryClient = useQueryClient()
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')

  const signInMutation = useMutation({
    mutationFn: (credentials: { email: string; password: string }) =>
      signInWithPassword(credentials.email, credentials.password),
    onSuccess: async (session: SessionStatus) => {
      queryClient.setQueryData(['session-status'], session)
      await queryClient.invalidateQueries({ queryKey: ['session-status'] })
    },
    onError: () => setPassword('')
  })

  const canSubmit = email.trim().length > 0 && password.length > 0 && !signInMutation.isPending

  function handleSubmit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault()
    if (!canSubmit) return
    signInMutation.mutate({ email: email.trim(), password })
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-4" aria-label="Sign in" noValidate>
      <label className="block space-y-1">
        <span className="px-1 text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">Email</span>
        <input
          type="email"
          name="email"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          value={email}
          onChange={(event) => setEmail(event.target.value)}
          className={INPUT_CLASS}
        />
      </label>
      <label className="block space-y-1">
        <span className="px-1 text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">Password</span>
        <input
          type="password"
          name="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(event) => setPassword(event.target.value)}
          className={INPUT_CLASS}
        />
      </label>

      {signInMutation.isError ? (
        <div className={ERROR_PANEL_CLASS} role="alert">
          <p className="font-body text-sm leading-6 text-chip-rose-ink">
            {buildSignInErrorMessage(signInMutation.error)}
          </p>
        </div>
      ) : null}

      <button
        type="submit"
        disabled={!canSubmit}
        className="group relative flex h-14 w-full select-none items-center justify-between rounded-pill bg-primary px-6 text-on-primary shadow-[0_14px_30px_-12px_rgb(var(--color-primary-dim))] outline-none transition-all duration-200 ease-out-expo hover:bg-primary-dim focus-visible:ring-4 focus-visible:ring-primary/30 active:scale-[0.98] disabled:opacity-60"
      >
        <p className="font-display text-base font-bold tracking-[-0.005em]">
          {signInMutation.isPending ? 'Signing in...' : 'Sign in'}
        </p>
        <div className="flex items-center gap-1 font-body text-sm font-medium opacity-70 transition-all duration-200 group-hover:translate-x-1 group-hover:opacity-100">
          <svg className="h-4 w-4 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor" aria-hidden="true">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
          </svg>
        </div>
      </button>
    </form>
  )
}

type SessionRequiredCardProps = {
  errorMessage?: string | null
}

export function SessionRequiredCard({ errorMessage = null }: SessionRequiredCardProps = {}) {
  const queryClient = useQueryClient()
  const { devMode } = getAppConfig()

  const localDevSignInMutation = useMutation({
    mutationFn: signInWithLocalDevAccount,
    onSuccess: async (session: SessionStatus) => {
      queryClient.setQueryData(['session-status'], session)
      await queryClient.invalidateQueries({ queryKey: ['session-status'] })
    }
  })

  return (
    <div className="space-y-4 mt-8">
      {errorMessage ? (
        <div className={ERROR_PANEL_CLASS}>
          <p className="font-body text-sm leading-6 text-chip-rose-ink">{errorMessage}</p>
        </div>
      ) : null}
      {!devMode ? <PasswordSignInForm /> : null}

      {devMode ? (
        <div className="pt-2">
          <button
            type="button"
            onClick={() => localDevSignInMutation.mutate()}
            disabled={localDevSignInMutation.isPending}
            aria-label="Continue with Local Test Account"
            className="group relative flex h-14 w-full select-none items-center justify-between rounded-pill bg-primary px-6 text-on-primary shadow-[0_14px_30px_-12px_rgb(var(--color-primary-dim))] outline-none transition-all duration-200 ease-out-expo hover:bg-primary-dim focus-visible:ring-4 focus-visible:ring-primary/30 active:scale-[0.98] disabled:opacity-60"
          >
            <div className="flex items-center gap-3">
              <svg className="h-5 w-5 opacity-90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
              <p className="font-display text-base font-bold tracking-[-0.005em]">
                {localDevSignInMutation.isPending ? 'Signing in...' : 'Local Dev Account'}
              </p>
            </div>
            <div className="flex items-center gap-1 font-body text-sm font-medium opacity-70 transition-all duration-200 group-hover:translate-x-1 group-hover:opacity-100">
              <svg className="h-4 w-4 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </div>
          </button>
          {localDevSignInMutation.isError ? (
            <div className={`mt-4 ${ERROR_PANEL_CLASS}`}>
              <p className="font-body text-sm leading-6 text-chip-rose-ink">
                {buildFriendlyMessage(
                  localDevSignInMutation.error,
                  'Local test sign-in failed. Check the local backend and database services.'
                )}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
