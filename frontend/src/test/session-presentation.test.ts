import { describe, expect, it } from 'vitest'

import { resolveLoginPath } from '../lib/sessionPresentation'

describe('session presentation', () => {
  it('preserves task-preview query state in the login return path', () => {
    const loginPath = resolveLoginPath(
      { isError: false, error: null, data: { signed_in: false } },
      '/tasks',
      '?group=all&task=e9e311a9-4a17-43fc-9382-835473f872eb'
    )
    if (!loginPath) throw new Error('Expected a login redirect path.')
    const params = new URLSearchParams(loginPath.split('?', 2)[1])

    expect(loginPath.startsWith('/login?')).toBe(true)
    expect(params.get('next')).toBe(
      '/tasks?group=all&task=e9e311a9-4a17-43fc-9382-835473f872eb'
    )
  })
})
