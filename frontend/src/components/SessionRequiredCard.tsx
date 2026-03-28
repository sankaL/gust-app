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
    <div className="space-y-4 mt-8">
      <div>
        <a
          href={getAuthStartUrl()}
          className="group relative w-full flex items-center justify-between rounded-card transition-all duration-200 outline-none select-none px-5 py-4 bg-[radial-gradient(circle_at_top_left,_#ffffff_10%,_#e5e5e5_90%)] text-black shadow-[0_6px_0_#a1a1aa,_0_8px_15px_rgba(0,0,0,0.4),_inset_0_1px_2px_rgba(255,255,255,0.8)] hover:-translate-y-[1px] hover:shadow-[0_7px_0_#a1a1aa,_0_12px_20px_rgba(0,0,0,0.5),_inset_0_1px_2px_rgba(255,255,255,0.8)] active:translate-y-[6px] active:shadow-[0_0px_0_#a1a1aa,_0_2px_4px_rgba(0,0,0,0.4),_inset_0_2px_6px_rgba(0,0,0,0.1)]"
          aria-label="Sign in with Google"
        >
          <div className="flex items-center gap-3">
            <svg viewBox="0 0 24 24" className="w-6 h-6 text-black/90" fill="currentColor">
              <path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="currentColor" />
              <path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="currentColor" />
              <path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z" fill="currentColor" />
              <path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="currentColor" />
            </svg>
            <p className="font-display text-lg font-medium tracking-wide">
              Sign in with Google
            </p>
          </div>
          <div className="flex items-center gap-1 font-body text-sm font-medium text-black/50 transition-colors group-hover:text-black/90">
            <svg className="h-4 w-4 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M14 5l7 7m0 0l-7 7m7-7H3" />
            </svg>
          </div>
        </a>
      </div>

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
            <div className="mt-4 rounded-card border border-error/35 bg-[rgba(80,18,18,0.92)] px-4 py-3 text-center shadow-[0_12px_24px_rgba(0,0,0,0.35)]">
              <p className="font-body text-sm leading-6 text-red-100">
                {buildFriendlyMessage(
                  localDevSignInMutation.error,
                  'Local test sign-in failed. Check the local Supabase and backend services.'
                )}
              </p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  )
}
