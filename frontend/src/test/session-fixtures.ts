import { type SessionStatus } from '../lib/api'

export function signedInSession(): SessionStatus {
  return {
    signed_in: true,
    user: { id: 'user-1', email: 'user@example.com', display_name: 'Gust User' },
    timezone: 'UTC',
    inbox_group_id: 'inbox-1',
    csrf_token: 'csrf-token'
  }
}

export function signedOutSession(): SessionStatus {
  return {
    signed_in: false,
    user: null,
    timezone: null,
    inbox_group_id: null,
    csrf_token: null
  }
}
