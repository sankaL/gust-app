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
  'rounded-card bg-[radial-gradient(circle_at_top,_rgba(138,41,55,0.95)_0%,_rgba(57,16,24,0.98)_72%,_rgba(29,9,14,1)_100%)] px-4 py-3 text-center shadow-[0_7px_0_#22090f,_0_18px_34px_rgba(0,0,0,0.5),_inset_0_1px_0_rgba(255,208,214,0.14),_inset_0_-10px_18px_rgba(0,0,0,0.22)]'

const INPUT_CLASS =
  'w-full rounded-card bg-surface-dim px-4 py-3 text-sm text-on-surface outline-none ring-1 ring-white/10 focus:ring-primary'

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
        <span className="text-[0.68rem] uppercase tracking-[0.16em] text-on-surface-variant">Email</span>
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
        <span className="text-[0.68rem] uppercase tracking-[0.16em] text-on-surface-variant">Password</span>
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
          <p className="font-body text-sm leading-6 text-red-100">
            {buildSignInErrorMessage(signInMutation.error)}
          </p>
        </div>
      ) : null}

      <button
        type="submit"
        disabled={!canSubmit}
        className="group relative w-full flex items-center justify-between rounded-card transition-all duration-200 outline-none select-none px-5 py-4 bg-[radial-gradient(circle_at_top_left,_#ffffff_10%,_#e5e5e5_90%)] text-black shadow-[0_6px_0_#a1a1aa,_0_8px_15px_rgba(0,0,0,0.4),_inset_0_1px_2px_rgba(255,255,255,0.8)] hover:-translate-y-[1px] hover:shadow-[0_7px_0_#a1a1aa,_0_12px_20px_rgba(0,0,0,0.5),_inset_0_1px_2px_rgba(255,255,255,0.8)] active:translate-y-[6px] active:shadow-[0_0px_0_#a1a1aa,_0_2px_4px_rgba(0,0,0,0.4),_inset_0_2px_6px_rgba(0,0,0,0.1)] disabled:opacity-60 disabled:active:translate-y-0 disabled:hover:translate-y-0"
      >
        <p className="font-display text-lg font-medium tracking-wide">
          {signInMutation.isPending ? 'Signing in...' : 'Sign in'}
        </p>
        <div className="flex items-center gap-1 font-body text-sm font-medium text-black/50 transition-colors group-hover:text-black/90">
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
          <p className="font-body text-sm leading-6 text-red-100">{errorMessage}</p>
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
            className="group relative w-full flex items-center justify-between rounded-card transition-all duration-200 outline-none select-none px-5 py-4 bg-[radial-gradient(circle_at_top_left,_#5b21b6_0%,_#2e1065_100%)] text-white shadow-[0_6px_0_#171033,_0_8px_15px_rgba(0,0,0,0.4),_inset_0_1px_2px_rgba(255,255,255,0.2)] hover:-translate-y-[1px] hover:shadow-[0_7px_0_#171033,_0_12px_20px_rgba(0,0,0,0.5),_inset_0_1px_2px_rgba(255,255,255,0.2)] active:translate-y-[6px] active:shadow-[0_0px_0_#171033,_0_2px_4px_rgba(0,0,0,0.4),_inset_0_2px_6px_rgba(0,0,0,0.3)] disabled:opacity-70 disabled:active:translate-y-0 disabled:hover:translate-y-0 disabled:hover:shadow-[0_6px_0_#171033,_0_8px_15px_rgba(0,0,0,0.4),_inset_0_1px_2px_rgba(255,255,255,0.2)]"
          >
            <div className="flex items-center gap-3">
              <svg className="h-6 w-6 text-white/90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M10 20l4-16m4 4l4 4-4 4M6 16l-4-4 4-4" />
              </svg>
              <p className="font-display text-lg font-medium tracking-wide">
                {localDevSignInMutation.isPending ? 'Signing in...' : 'Local Dev Account'}
              </p>
            </div>
            <div className="flex items-center gap-1 font-body text-sm font-medium text-white/50 transition-colors group-hover:text-white/90">
              <svg className="h-4 w-4 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
              </svg>
            </div>
          </button>
          {localDevSignInMutation.isError ? (
            <div className={`mt-4 ${ERROR_PANEL_CLASS}`}>
              <p className="font-body text-sm leading-6 text-red-100">
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
