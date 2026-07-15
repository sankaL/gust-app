function buildLoginPath(pathname: string, search: string, authError?: string): string {
  const params = new URLSearchParams({ next: `${pathname}${search}` })
  if (authError) params.set('auth_error', authError)
  return `/login?${params.toString()}`
}

export function buildAvatarLabel(displayName: string | null, email: string): string {
  const source = (displayName?.trim() || email.split('@')[0] || 'G').replace(/\s+/g, ' ')
  const parts = source.split(' ').filter(Boolean)
  return (parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}` : source.slice(0, 2)).toUpperCase()
}

function getAuthErrorParam(error: unknown): string | undefined {
  return error instanceof ApiError && error.code === 'auth_email_not_allowed'
    ? 'email_not_allowed'
    : undefined
}

export function resolveLoginPath(query: { isError: boolean; error: unknown; data?: { signed_in: boolean } }, pathname: string, search: string) {
  if (query.isError) return buildLoginPath(pathname, search, getAuthErrorParam(query.error))
  if (!query.data?.signed_in) return buildLoginPath(pathname, search)
  return null
}
import { ApiError } from './api'
