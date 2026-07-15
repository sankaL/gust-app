export function buildLoginPath(pathname: string, search: string, authError?: string): string {
  const params = new URLSearchParams({ next: `${pathname}${search}` })
  if (authError) params.set('auth_error', authError)
  return `/login?${params.toString()}`
}

export function buildAvatarLabel(displayName: string | null, email: string): string {
  const source = (displayName?.trim() || email.split('@')[0] || 'G').replace(/\s+/g, ' ')
  const parts = source.split(' ').filter(Boolean)
  return (parts.length >= 2 ? `${parts[0][0]}${parts[1][0]}` : source.slice(0, 2)).toUpperCase()
}

export function getAuthErrorParam(error: unknown): string | undefined {
  return error instanceof ApiError && error.code === 'auth_email_not_allowed'
    ? 'email_not_allowed'
    : undefined
}
import { ApiError } from './api'
