import { ApiError, type SessionStatus } from './api'

export function requireCsrfToken(session: SessionStatus | undefined): string {
  const csrfToken = session?.csrf_token
  if (!csrfToken) {
    throw new ApiError('Your session is missing a CSRF token.', 'csrf_missing', 403)
  }
  return csrfToken
}
