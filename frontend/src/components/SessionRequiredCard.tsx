import { useMutation, useQueryClient } from '@tanstack/react-query'

import {
  ApiError,
  getAuthStartUrl,
  signInWithLocalDevAccount,
  type SessionStatus
} from '../lib/api'
import { getAppConfig } from '../lib/config'

function buildFriendlyMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message
  }

  return fallback
}

export function SessionRequiredCard() {
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
    <div className="rounded-soft border border-outline/40 bg-surface-container p-6 shadow-ambient">
      <div className="space-y-4">
        <p className="font-display text-2xl text-on-surface">Session Required</p>
        {devMode ? (
          <>
            <p className="font-body text-sm leading-6 text-on-surface-variant">
              Local dev mode still requires a protected backend session. Use the local test account
              to exercise capture and task flows against the Makefile stack.
            </p>
            <button
              type="button"
              onClick={() => localDevSignInMutation.mutate()}
              disabled={localDevSignInMutation.isPending}
              className="inline-flex rounded-pill bg-primary px-5 py-3 font-body text-sm font-medium text-surface disabled:cursor-not-allowed disabled:opacity-70"
            >
              {localDevSignInMutation.isPending
                ? 'Signing in to local test account...'
                : 'Continue with Local Test Account'}
            </button>
            {localDevSignInMutation.isError ? (
              <p className="font-body text-sm leading-6 text-tertiary">
                {buildFriendlyMessage(
                  localDevSignInMutation.error,
                  'Local test sign-in failed. Check the local Supabase and backend services.'
                )}
              </p>
            ) : null}
          </>
        ) : (
          <>
            <p className="font-body text-sm leading-6 text-on-surface-variant">
              Gust fails closed when session state is missing. Sign in with Google to continue.
            </p>
            <a
              href={getAuthStartUrl()}
              className="inline-flex rounded-pill bg-primary px-5 py-3 font-body text-sm font-medium text-surface"
            >
              Sign in with Google
            </a>
          </>
        )}
      </div>
    </div>
  )
}
