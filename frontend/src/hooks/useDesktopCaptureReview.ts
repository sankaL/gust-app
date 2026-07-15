import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { useNotifications } from '../components/Notifications'
import {
  ApiError,
  approveAllExtractedTasks,
  approveExtractedTask,
  completeCapture,
  discardAllExtractedTasks,
  discardExtractedTask,
  listExtractedTasks,
  listPendingTasks,
  type ExtractedTask,
} from '../lib/api'

type SingleAction = (captureId: string, taskId: string, csrfToken: string) => Promise<unknown>
type BulkAction = (captureId: string, csrfToken: string) => Promise<unknown>

function friendlyMessage(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback
}

function captureMap(tasks: ExtractedTask[]) {
  return new Map(tasks.map((task) => [task.id, task.capture_id]))
}

function captureContext(captureId: string | undefined | null, csrfToken: string | null | undefined) {
  if (!captureId || !csrfToken) return null
  return { captureId, csrfToken }
}

function bulkRequests(ids: string[], csrfToken: string | null | undefined, action: BulkAction) {
  if (!csrfToken || ids.length === 0) return []
  return ids.map((id) => action(id, csrfToken))
}

export function useDesktopCaptureReview(csrfToken: string | null | undefined) {
  const navigate = useNavigate()
  const client = useQueryClient()
  const [params] = useSearchParams()
  const { notifyError, notifySuccess } = useNotifications()
  const captureId = params.get('capture')
  const extractedQuery = useQuery({ queryKey: ['extracted-tasks', captureId], queryFn: () => listExtractedTasks(captureId!), enabled: Boolean(captureId) })
  const pendingQuery = useQuery({ queryKey: ['pending-tasks'], queryFn: listPendingTasks })
  const latestTasks = useMemo(() => extractedQuery.data ?? [], [extractedQuery.data])
  const pendingTasks = useMemo(() => pendingQuery.data ?? [], [pendingQuery.data])
  const taskCaptureIds = useMemo(() => captureMap([...latestTasks, ...pendingTasks]), [latestTasks, pendingTasks])
  const visiblePendingTasks = captureId ? pendingTasks.filter((task) => task.capture_id !== captureId) : pendingTasks

  async function refresh(activeCaptureId?: string | null) {
    const keys = [['pending-tasks'], ['tasks'], ['desktop', 'tasks'], ['groups']]
    if (activeCaptureId) keys.unshift(['extracted-tasks', activeCaptureId])
    await Promise.all(keys.map((queryKey) => client.invalidateQueries({ queryKey })))
  }

  async function runSingle(taskId: string, action: SingleAction, success: string, failure: string) {
    const context = captureContext(taskCaptureIds.get(taskId) ?? captureId, csrfToken)
    if (!context) {
      notifyError('Task context is unavailable. Refresh and try again.')
      return
    }
    try {
      await action(context.captureId, taskId, context.csrfToken)
      await refresh(context.captureId)
      notifySuccess(success)
    } catch (error) {
      notifyError(friendlyMessage(error, failure))
    }
  }

  async function runBulk(ids: string[], action: BulkAction, success: string, failure: string) {
    const requests = bulkRequests(ids, csrfToken, action)
    if (requests.length === 0) return
    try {
      await Promise.all(requests)
      await refresh(ids.length === 1 ? ids[0] : null)
      notifySuccess(success)
    } catch (error) {
      notifyError(friendlyMessage(error, failure))
    }
  }

  const complete = useMutation({
    mutationFn: () => {
      if (!captureId || !csrfToken) throw new ApiError('Capture context is unavailable.', 'capture_missing', 422)
      return completeCapture(captureId, csrfToken)
    },
    onSuccess: async () => { await refresh(captureId); notifySuccess('Capture review completed.'); void navigate('/desktop/tasks') },
    onError: (error) => notifyError(friendlyMessage(error, 'Failed to complete capture.')),
  })
  const pendingCaptureIds = () => Array.from(new Set(visiblePendingTasks.map((task) => task.capture_id)))
  return {
    captureId, extractedQuery, pendingQuery, latestTasks, visiblePendingTasks, complete, refresh,
    approve: (taskId: string) => runSingle(taskId, approveExtractedTask, 'Task approved.', 'Failed to approve task.'),
    discard: (taskId: string) => runSingle(taskId, discardExtractedTask, 'Task discarded.', 'Failed to discard task.'),
    approveLatest: () => runBulk(captureId ? [captureId] : [], approveAllExtractedTasks, 'Approved all extracted tasks.', 'Failed to approve all extracted tasks.'),
    discardLatest: () => runBulk(captureId ? [captureId] : [], discardAllExtractedTasks, 'Discarded all extracted tasks.', 'Failed to discard all extracted tasks.'),
    approvePending: () => runBulk(pendingCaptureIds(), approveAllExtractedTasks, 'Approved all older pending tasks.', 'Failed to approve older pending tasks.'),
    discardPending: () => runBulk(pendingCaptureIds(), discardAllExtractedTasks, 'Discarded all older pending tasks.', 'Failed to discard older pending tasks.'),
  }
}
