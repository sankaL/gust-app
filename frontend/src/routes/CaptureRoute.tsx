import { Navigate, useSearchParams } from 'react-router-dom'

/**
 * Capture now lives in a bottom sheet over the task list. `/capture` stays as a deep link
 * (PWA launch, desktop "Mobile Mode", older bookmarks) that opens that sheet.
 */
export function CaptureRoute() {
  const [searchParams] = useSearchParams()
  const next = new URLSearchParams({ sheet: 'capture' })
  if (searchParams.get('record') === '1') next.set('mode', 'record')
  else if (searchParams.get('compose') === '1') next.set('mode', 'type')
  return <Navigate to={`/tasks?${next.toString()}`} replace />
}
