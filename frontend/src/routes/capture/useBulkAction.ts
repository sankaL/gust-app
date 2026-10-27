import { useState } from 'react'

import { useNotifications } from '../../components/Notifications'

/** Runs a bulk action while tracking its pending state for the footer buttons. */
export function useBulkAction() {
  const [running, setRunning] = useState<'approve' | 'discard' | null>(null)
  const { notifyError } = useNotifications()
  const run = async (kind: 'approve' | 'discard', action: () => Promise<void>) => {
    setRunning(kind)
    try { await action() }
    catch (error) { notifyError(error instanceof Error ? error.message : `${kind === 'approve' ? 'Approve' : 'Discard'} all could not be completed.`) }
    finally { setRunning(null) }
  }
  return { running, run }
}
