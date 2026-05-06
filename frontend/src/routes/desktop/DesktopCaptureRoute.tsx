import { useMemo, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useOutletContext, useSearchParams } from 'react-router-dom'

import { EditExtractedTaskModal } from '../../components/EditExtractedTaskModal'
import { StagingTable } from '../../components/StagingTable'
import { useDesktopHeader, type DesktopOutletContext } from '../../components/DesktopShell'
import { useNotifications } from '../../components/Notifications'
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
} from '../../lib/api'

function buildFriendlyMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message
  }
  return fallback
}

export function DesktopCaptureRoute() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const { session, groups } = useOutletContext<DesktopOutletContext>()
  const { notifyError, notifySuccess } = useNotifications()
  const [editModalTask, setEditModalTask] = useState<ExtractedTask | null>(null)

  const captureId = searchParams.get('capture')
  const header = useMemo(
    () => ({
      eyebrow: 'Capture tasks',
      title: 'Review Capture',
      subtitle: captureId
        ? 'Edit, approve, or discard extracted tasks before they join your list'
        : 'Pending extracted tasks waiting for review',
    }),
    [captureId]
  )
  useDesktopHeader(header)

  const extractedTasksQuery = useQuery({
    queryKey: ['extracted-tasks', captureId],
    queryFn: () => listExtractedTasks(captureId!),
    enabled: Boolean(captureId),
  })

  const pendingTasksQuery = useQuery({
    queryKey: ['pending-tasks'],
    queryFn: listPendingTasks,
  })

  const csrfToken = session.csrf_token
  const visiblePendingTasks = captureId
    ? (pendingTasksQuery.data ?? []).filter((task) => task.capture_id !== captureId)
    : (pendingTasksQuery.data ?? [])

  async function refreshTaskQueries(activeCaptureId?: string | null) {
    const invalidations = [
      queryClient.invalidateQueries({ queryKey: ['pending-tasks'] }),
      queryClient.invalidateQueries({ queryKey: ['tasks'] }),
      queryClient.invalidateQueries({ queryKey: ['desktop', 'tasks'] }),
      queryClient.invalidateQueries({ queryKey: ['groups'] }),
    ]

    if (activeCaptureId) {
      invalidations.unshift(
        queryClient.invalidateQueries({ queryKey: ['extracted-tasks', activeCaptureId] })
      )
    }

    await Promise.all(invalidations)
  }

  function resolveTaskCaptureId(taskId: string): string | null {
    const extractedTask = extractedTasksQuery.data?.find((task) => task.id === taskId)
    if (extractedTask?.capture_id) return extractedTask.capture_id

    const pendingTask = pendingTasksQuery.data?.find((task) => task.id === taskId)
    if (pendingTask?.capture_id) return pendingTask.capture_id

    return captureId
  }

  async function handleApproveTask(taskId: string) {
    const taskCaptureId = resolveTaskCaptureId(taskId)
    if (!taskCaptureId || !csrfToken) {
      notifyError('Task context is unavailable. Refresh and try again.')
      return
    }

    try {
      await approveExtractedTask(taskCaptureId, taskId, csrfToken)
      await refreshTaskQueries(taskCaptureId)
      notifySuccess('Task approved.')
    } catch (error) {
      notifyError(buildFriendlyMessage(error, 'Failed to approve task.'))
    }
  }

  async function handleDiscardTask(taskId: string) {
    const taskCaptureId = resolveTaskCaptureId(taskId)
    if (!taskCaptureId || !csrfToken) {
      notifyError('Task context is unavailable. Refresh and try again.')
      return
    }

    try {
      await discardExtractedTask(taskCaptureId, taskId, csrfToken)
      await refreshTaskQueries(taskCaptureId)
      notifySuccess('Task discarded.')
    } catch (error) {
      notifyError(buildFriendlyMessage(error, 'Failed to discard task.'))
    }
  }

  async function handleApproveAll(activeCaptureId: string | null) {
    if (!activeCaptureId || !csrfToken) return
    await approveAllExtractedTasks(activeCaptureId, csrfToken)
    await refreshTaskQueries(activeCaptureId)
    notifySuccess('Approved all extracted tasks.')
  }

  async function handleDiscardAll(activeCaptureId: string | null) {
    if (!activeCaptureId || !csrfToken) return
    await discardAllExtractedTasks(activeCaptureId, csrfToken)
    await refreshTaskQueries(activeCaptureId)
    notifySuccess('Discarded all extracted tasks.')
  }

  async function handleApproveAllPending() {
    if (!csrfToken) return
    const captureIds = Array.from(new Set(visiblePendingTasks.map((task) => task.capture_id)))
    await Promise.all(captureIds.map((activeCaptureId) => approveAllExtractedTasks(activeCaptureId, csrfToken)))
    await refreshTaskQueries(null)
    notifySuccess('Approved all older pending tasks.')
  }

  async function handleDiscardAllPending() {
    if (!csrfToken) return
    const captureIds = Array.from(new Set(visiblePendingTasks.map((task) => task.capture_id)))
    await Promise.all(captureIds.map((activeCaptureId) => discardAllExtractedTasks(activeCaptureId, csrfToken)))
    await refreshTaskQueries(null)
    notifySuccess('Discarded all older pending tasks.')
  }

  const completeMutation = useMutation({
    mutationFn: async () => {
      if (!captureId || !csrfToken) {
        throw new ApiError('Capture context is unavailable.', 'capture_missing', 422)
      }
      return completeCapture(captureId, csrfToken)
    },
    onSuccess: async () => {
      await refreshTaskQueries(captureId)
      notifySuccess('Capture review completed.')
      void navigate('/desktop/tasks')
    },
    onError: (error) => {
      notifyError(buildFriendlyMessage(error, 'Failed to complete capture.'))
    },
  })

  const hasLatestCapture = Boolean(captureId)
  const latestTasks = extractedTasksQuery.data ?? []

  return (
    <section className="w-full space-y-6">
      {hasLatestCapture ? (
        <div className="space-y-4">
          <StagingTable
            tasks={latestTasks}
            onApprove={handleApproveTask}
            onDiscard={handleDiscardTask}
            onApproveAll={() => handleApproveAll(captureId)}
            onDiscardAll={() => handleDiscardAll(captureId)}
            onTaskClick={setEditModalTask}
            isLoading={extractedTasksQuery.isLoading || extractedTasksQuery.isFetching}
            title="Newly extracted tasks"
            subtext="Review and approve tasks from your latest desktop recording"
            emptyMessage="No newly captured tasks to review"
          />

          <div className="flex justify-end">
            <button
              type="button"
              onClick={() => completeMutation.mutate()}
              disabled={completeMutation.isPending}
              className="rounded-pill border border-outline px-4 py-2 text-sm font-medium text-on-surface-variant transition hover:bg-surface-container hover:text-on-surface disabled:opacity-60"
            >
              {completeMutation.isPending ? 'Finishing...' : 'Done'}
            </button>
          </div>
        </div>
      ) : null}

      {visiblePendingTasks.length > 0 ? (
        <div>
          <StagingTable
            tasks={visiblePendingTasks}
            onApprove={handleApproveTask}
            onDiscard={handleDiscardTask}
            onApproveAll={handleApproveAllPending}
            onDiscardAll={handleDiscardAllPending}
            onTaskClick={setEditModalTask}
            isLoading={pendingTasksQuery.isLoading || pendingTasksQuery.isFetching}
            title={hasLatestCapture ? 'Older pending tasks' : 'Pending capture tasks'}
            subtext="Extracted tasks awaiting review"
            emptyMessage="No pending tasks to review"
          />
        </div>
      ) : null}

      {!hasLatestCapture && visiblePendingTasks.length === 0 ? (
        <div className="py-12 text-center">
          <p className="font-display text-2xl text-on-surface">No capture tasks to review</p>
          <p className="mt-2 font-body text-sm text-on-surface-variant">
            Use the floating mic button to record a desktop capture.
          </p>
        </div>
      ) : null}

      {editModalTask && csrfToken ? (
        <EditExtractedTaskModal
          task={editModalTask}
          groups={groups}
          isOpen={Boolean(editModalTask)}
          onClose={() => setEditModalTask(null)}
          onSave={() => refreshTaskQueries(editModalTask.capture_id)}
          csrfToken={csrfToken}
        />
      ) : null}
    </section>
  )
}
