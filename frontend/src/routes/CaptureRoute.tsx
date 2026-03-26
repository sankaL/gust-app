import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import {
  ApiError,
  createTextCapture,
  createVoiceCapture,
  getSessionStatus,
  listExtractedTasks,
  listPendingTasks,
  approveExtractedTask,
  discardExtractedTask,
  approveAllExtractedTasks,
  discardAllExtractedTasks,
  listGroups,
  completeCapture,
  type ExtractedTask,
  type SubmitCaptureResponse
} from '../lib/api'
import { SessionRequiredCard } from '../components/SessionRequiredCard'
import { StagingTable } from '../components/StagingTable'
import { EditExtractedTaskModal } from '../components/EditExtractedTaskModal'
import { ExtractingLoader } from '../components/ExtractingLoader'

type RecordedAudio = {
  blob: Blob
  filename: string
}

function buildFriendlyMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message
  }

  return fallback
}

export function CaptureRoute() {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const recordedChunksRef = useRef<BlobPart[]>([])
  const retryAudioRef = useRef<RecordedAudio | null>(null)
  const queryClient = useQueryClient()

  const [isRecording, setIsRecording] = useState(false)
  const [isRecorderLoading, setIsRecorderLoading] = useState(false)
  const [textExpanded, setTextExpanded] = useState(false)
  const [textDraft, setTextDraft] = useState('')
  const [reviewCaptureId, setReviewCaptureId] = useState<string | null>(null)
  const [permissionError, setPermissionError] = useState<string | null>(null)
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [summary, setSummary] = useState<SubmitCaptureResponse | null>(null)
  const [showStaging, setShowStaging] = useState(false)

  const sessionQuery = useQuery({
    queryKey: ['session-status'],
    queryFn: getSessionStatus
  })

  // Query for all pending tasks (user-scoped, not capture-scoped)
  const allPendingTasksQuery = useQuery({
    queryKey: ['pending-tasks'],
    queryFn: listPendingTasks,
    enabled: !!sessionQuery.data?.signed_in
  })

  // Query for capture-specific tasks during review (used in staging table)
  const extractedTasksQuery = useQuery({
    queryKey: ['extracted-tasks', reviewCaptureId],
    queryFn: () => listExtractedTasks(reviewCaptureId!),
    enabled: !!reviewCaptureId && showStaging
  })

  const visiblePendingTasks =
    showStaging && reviewCaptureId
      ? (allPendingTasksQuery.data ?? []).filter((task) => task.capture_id !== reviewCaptureId)
      : (allPendingTasksQuery.data ?? [])

  // Resolve task capture context without requiring pending cache availability.
  const resolveTaskCaptureId = (taskId: string): string | null => {
    const pendingTask = allPendingTasksQuery.data?.find((task) => task.id === taskId)
    if (pendingTask?.capture_id) return pendingTask.capture_id

    const reviewTask = extractedTasksQuery.data?.find((task) => task.id === taskId)
    if (reviewTask?.capture_id) return reviewTask.capture_id

    return reviewCaptureId
  }

  // Handler functions for StagingTable
  const handleApproveTask = async (taskId: string) => {
    const captureId = resolveTaskCaptureId(taskId)
    if (!captureId) {
      setSubmitError('Task context is unavailable. Refresh and try again.')
      return
    }
    if (!sessionQuery.data?.csrf_token) return
    try {
      setSubmitError(null)
      await approveExtractedTask(captureId, taskId, sessionQuery.data.csrf_token)
      // Refresh both queries
      queryClient.invalidateQueries({ queryKey: ['extracted-tasks', captureId] })
      queryClient.invalidateQueries({ queryKey: ['pending-tasks'] })
      // Also invalidate tasks query to ensure TasksRoute and AllTasksView stay in sync
      await queryClient.invalidateQueries({ queryKey: ['tasks'] })
    } catch (error) {
      setSubmitError(buildFriendlyMessage(error, 'Failed to approve task.'))
    }
  }

  const handleDiscardTask = async (taskId: string) => {
    const captureId = resolveTaskCaptureId(taskId)
    if (!captureId) {
      setSubmitError('Task context is unavailable. Refresh and try again.')
      return
    }
    if (!sessionQuery.data?.csrf_token) return
    try {
      setSubmitError(null)
      await discardExtractedTask(captureId, taskId, sessionQuery.data.csrf_token)
      // Refresh both queries
      queryClient.invalidateQueries({ queryKey: ['extracted-tasks', captureId] })
      queryClient.invalidateQueries({ queryKey: ['pending-tasks'] })
      // Also invalidate tasks query to ensure TasksRoute and AllTasksView stay in sync
      await queryClient.invalidateQueries({ queryKey: ['tasks'] })
    } catch (error) {
      setSubmitError(buildFriendlyMessage(error, 'Failed to discard task.'))
    }
  }

  const handleApproveAll = async () => {
    if (!reviewCaptureId || !sessionQuery.data?.csrf_token) return
    try {
      setSubmitError(null)
      await approveAllExtractedTasks(reviewCaptureId, sessionQuery.data.csrf_token)
      // Refresh both queries
      queryClient.invalidateQueries({ queryKey: ['extracted-tasks', reviewCaptureId] })
      queryClient.invalidateQueries({ queryKey: ['pending-tasks'] })
      // Also invalidate tasks query to ensure TasksRoute and AllTasksView stay in sync
      await queryClient.invalidateQueries({ queryKey: ['tasks'] })
    } catch (error) {
      setSubmitError(buildFriendlyMessage(error, 'Failed to approve all tasks.'))
    }
  }

  const handleDiscardAll = async () => {
    if (!reviewCaptureId || !sessionQuery.data?.csrf_token) return
    try {
      setSubmitError(null)
      await discardAllExtractedTasks(reviewCaptureId, sessionQuery.data.csrf_token)
      // Refresh both queries
      queryClient.invalidateQueries({ queryKey: ['extracted-tasks', reviewCaptureId] })
      queryClient.invalidateQueries({ queryKey: ['pending-tasks'] })
      // Also invalidate tasks query to ensure TasksRoute and AllTasksView stay in sync
      await queryClient.invalidateQueries({ queryKey: ['tasks'] })
    } catch (error) {
      setSubmitError(buildFriendlyMessage(error, 'Failed to discard all tasks.'))
    }
  }

  // Modal state for editing extracted tasks
  const [editModalTask, setEditModalTask] = useState<ExtractedTask | null>(null)

  const handleTaskClick = (task: ExtractedTask) => {
    setEditModalTask(task)
  }

  const handleEditModalClose = () => {
    setEditModalTask(null)
  }

  const handleEditModalSave = async () => {
    // Refresh the task lists after save
    // Note: _taskId and _updates are unused because we invalidate by reviewCaptureId for consistency
    // with handleApproveAll/handleDiscardAll. Using editModalTask.capture_id would cause issues
    // when editing a task from a different capture than the one currently being reviewed.
    if (reviewCaptureId) {
      await queryClient.invalidateQueries({ queryKey: ['extracted-tasks', reviewCaptureId] })
    }
    // Always invalidate pending tasks as edited tasks may appear there
    await queryClient.invalidateQueries({ queryKey: ['pending-tasks'] })

    // Also invalidate tasks query to ensure TasksRoute stays in sync
    await queryClient.invalidateQueries({ queryKey: ['tasks'] })
  }

  // Groups query for the edit modal
  const groupsQuery = useQuery({
    queryKey: ['groups'],
    queryFn: listGroups,
    enabled: !!sessionQuery.data?.signed_in
  })

  // Batch approve all pending tasks across all captures
  const handleApproveAllPending = async () => {
    const tasks = visiblePendingTasks
    const csrfToken = sessionQuery.data?.csrf_token
    if (tasks.length === 0 || !csrfToken) return
    try {
      setSubmitError(null)
      // Group tasks by capture_id and batch per-capture
      const tasksByCapture = tasks.reduce((acc, task) => {
        if (!acc[task.capture_id]) acc[task.capture_id] = []
        acc[task.capture_id].push(task)
        return acc
      }, {} as Record<string, typeof tasks>)
      // Process each capture's tasks in parallel batches
      await Promise.all(
        Object.entries(tasksByCapture).map(async ([captureId]) => {
          // Use batch approve endpoint for each capture
          await approveAllExtractedTasks(captureId, csrfToken)
        })
      )
      // Refresh the pending list
      queryClient.invalidateQueries({ queryKey: ['pending-tasks'] })
    } catch (error) {
      setSubmitError(buildFriendlyMessage(error, 'Failed to approve all tasks.'))
    }
  }

  // Batch discard all pending tasks across all captures
  const handleDiscardAllPending = async () => {
    const tasks = visiblePendingTasks
    const csrfToken = sessionQuery.data?.csrf_token
    if (tasks.length === 0 || !csrfToken) return
    try {
      setSubmitError(null)
      // Group tasks by capture_id and batch per-capture
      const tasksByCapture = tasks.reduce((acc, task) => {
        if (!acc[task.capture_id]) acc[task.capture_id] = []
        acc[task.capture_id].push(task)
        return acc
      }, {} as Record<string, typeof tasks>)
      // Process each capture's tasks in parallel batches
      await Promise.all(
        Object.entries(tasksByCapture).map(async ([captureId]) => {
          // Use batch discard endpoint for each capture
          await discardAllExtractedTasks(captureId, csrfToken)
        })
      )
      // Refresh the pending list
      queryClient.invalidateQueries({ queryKey: ['pending-tasks'] })
    } catch (error) {
      setSubmitError(buildFriendlyMessage(error, 'Failed to discard all tasks.'))
    }
  }

  const isLoadingTasks = extractedTasksQuery.isLoading || extractedTasksQuery.isFetching
  const isLoadingAllPending = allPendingTasksQuery.isLoading || allPendingTasksQuery.isFetching

  const textCaptureMutation = useMutation({
    mutationFn: async (text: string) => {
      const csrfToken = sessionQuery.data?.csrf_token
      if (!csrfToken) {
        throw new ApiError('Your session is missing a CSRF token.', 'csrf_missing', 403)
      }

      return createTextCapture(text, csrfToken)
    },
    onSuccess: (payload) => {
      setSummary(null)
      setSubmitError(null)
      setTranscriptionError(null)
      setReviewCaptureId(payload.capture_id)
      setShowStaging(true)
    },
    onError: (error) => {
      setSubmitError(buildFriendlyMessage(error, 'Text capture could not be prepared.'))
    }
  })

  const voiceCaptureMutation = useMutation({
    mutationFn: async (audio: RecordedAudio) => {
      const csrfToken = sessionQuery.data?.csrf_token
      if (!csrfToken) {
        throw new ApiError('Your session is missing a CSRF token.', 'csrf_missing', 403)
      }

      return createVoiceCapture(audio.blob, audio.filename, csrfToken)
    },
    onSuccess: (payload) => {
      setSummary(null)
      setTranscriptionError(null)
      setSubmitError(null)
      setReviewCaptureId(payload.capture_id)
      setShowStaging(true)
    },
    onError: (error) => {
      setTranscriptionError(
        buildFriendlyMessage(error, 'Transcription failed. Please retry the same recording.')
      )
    }
  })



  useEffect(() => {
    return () => {
      mediaRecorderRef.current?.stream.getTracks().forEach((track) => track.stop())
      mediaRecorderRef.current = null
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
    }
  }, [])

  async function startRecording() {
    setPermissionError(null)
    setTranscriptionError(null)
    clearReviewState()
    setSummary(null)
    retryAudioRef.current = null
    setIsRecorderLoading(true)

    if (!navigator.mediaDevices?.getUserMedia) {
      setPermissionError('Microphone capture is unavailable. You can still use text capture.')
      setTextExpanded(true)
      setIsRecorderLoading(false)
      return
    }

    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      recordedChunksRef.current = []
      mediaStreamRef.current = stream
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data)
        }
      }

      recorder.onstop = () => {
        const mimeType = recorder.mimeType || 'audio/webm'
        const fileExtension = mimeType.includes('mp4') ? 'mp4' : 'webm'
        const blob = new Blob(recordedChunksRef.current, { type: mimeType })
        stream.getTracks().forEach((track) => track.stop())
        mediaStreamRef.current = null
        mediaRecorderRef.current = null
        setIsRecording(false)

        if (blob.size === 0) {
          setTranscriptionError('Recording was empty. Try again or use text capture.')
          return
        }

        const recordedAudio = {
          blob,
          filename: `capture.${fileExtension}`
        }

        retryAudioRef.current = recordedAudio
        voiceCaptureMutation.mutate(recordedAudio)
      }

      recorder.start()
      setIsRecording(true)
    } catch {
      setPermissionError('Microphone permission was denied. Text capture is still available.')
      setTextExpanded(true)
    } finally {
      setIsRecorderLoading(false)
    }
  }

  function stopRecording() {
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
    }
  }

  function clearReviewState() {
    setReviewCaptureId(null)
    setSubmitError(null)
  }

  function resetSummary() {
    setSummary(null)
    setTranscriptionError(null)
    setPermissionError(null)
  }

  function retryVoiceCapture() {
    const recordedAudio = retryAudioRef.current
    if (recordedAudio) {
      setTranscriptionError(null)
      voiceCaptureMutation.mutate(recordedAudio)
    }
  }

  const isBusy =
    isRecorderLoading ||
    voiceCaptureMutation.isPending ||
    textCaptureMutation.isPending

  if (sessionQuery.isLoading) {
    return (
      <section className="space-y-6" aria-busy="true">
        <div className="space-y-3">
          <p className="font-body text-sm uppercase tracking-[0.25em] text-on-surface-variant">
            Session check
          </p>
          <h2 className="font-display text-3xl text-on-surface">Capture</h2>
          <p className="max-w-sm font-body text-base leading-7 text-on-surface-variant">
            Verifying your session before starting capture.
          </p>
        </div>
      </section>
    )
  }

  if (sessionQuery.isError || !sessionQuery.data?.signed_in) {
    return (
      <section className="space-y-6">
        <div className="space-y-3">
          <p className="font-body text-sm uppercase tracking-[0.25em] text-on-surface-variant">
            Voice-first launch
          </p>
          <h2 className="font-display text-3xl text-on-surface">Capture</h2>
          <p className="max-w-sm font-body text-base leading-7 text-on-surface-variant">
            Sign in to record, review, and extract tasks safely through the backend session.
          </p>
        </div>

        <SessionRequiredCard />
      </section>
    )
  }

  return (
    <section className="space-y-4">
      {voiceCaptureMutation.isPending ? (
        <ExtractingLoader variant="voice" />
      ) : (
        <div className="rounded-soft bg-[radial-gradient(circle_at_top,_rgba(186,158,255,0.24),_rgba(16,16,16,0.94)_58%)] px-4 py-5 shadow-ambient">
          <div className="space-y-6 text-center">
            <div className="space-y-1">
              <p className="font-body text-sm font-medium text-on-surface">
                {isRecording
                  ? 'Recording...'
                  : 'Tap to record'}
              </p>
            </div>

            <button
              type="button"
              onClick={isRecording ? stopRecording : startRecording}
              disabled={isBusy && !isRecording}
              className={[
                'group relative mx-auto flex h-36 w-36 items-center justify-center rounded-full transition-all duration-200 outline-none select-none',
                isRecording
                  ? 'translate-y-[8px] bg-[radial-gradient(circle_at_top,_#fb7185_10%,_#be123c_90%)] text-white shadow-[inset_0_6px_12px_rgba(0,0,0,0.4),_0_2px_4px_rgba(0,0,0,0.4)]'
                  : 'bg-[radial-gradient(circle_at_top,_#c4b5fd_10%,_#7c3aed_90%)] text-white shadow-[0_8px_0_#4c1d95,_0_15px_20px_rgba(0,0,0,0.4),_inset_0_2px_3px_rgba(255,255,255,0.6)] hover:-translate-y-[2px] hover:shadow-[0_10px_0_#4c1d95,_0_18px_24px_rgba(0,0,0,0.4),_inset_0_2px_3px_rgba(255,255,255,0.6)] active:translate-y-[8px] active:shadow-[0_0px_0_#4c1d95,_0_4px_8px_rgba(0,0,0,0.4),_inset_0_4px_8px_rgba(0,0,0,0.3)]'
              ].join(' ')}
              aria-label={isRecording ? 'Stop recording' : 'Start recording'}
            >
              <div className="flex items-center justify-center transition-all duration-200 drop-shadow-md">
                {isRecording ? (
                  <svg className="h-10 w-10 animate-pulse text-white/90" fill="currentColor" viewBox="0 0 24 24">
                    <rect x="6" y="6" width="12" height="12" rx="2" />
                  </svg>
                ) : (
                  <svg className="h-14 w-14 text-white/95" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" />
                  </svg>
                )}
              </div>
            </button>

            <div className="space-y-2">
              {permissionError ? (
                <p className="rounded-card bg-tertiary/10 px-3 py-2 font-body text-sm text-on-surface">
                  {permissionError}
                </p>
              ) : null}
              {transcriptionError ? (
                <div className="space-y-2 rounded-card bg-tertiary/10 px-3 py-3">
                  <p className="font-body text-sm text-on-surface">{transcriptionError}</p>
                  <div className="flex flex-wrap justify-center gap-2">
                    <button
                      type="button"
                      onClick={retryVoiceCapture}
                      className="rounded-pill bg-primary px-3 py-1.5 text-sm font-medium text-surface"
                    >
                      Retry Same Recording
                    </button>
                    <button
                      type="button"
                      onClick={() => setTranscriptionError(null)}
                      className="rounded-pill border border-outline px-3 py-1.5 text-sm text-on-surface-variant"
                    >
                      Dismiss
                    </button>
                  </div>
                </div>
              ) : null}
            </div>
          </div>
        </div>
      )}

      {!textExpanded ? (
        <button
          type="button"
          onClick={() => setTextExpanded(true)}
          className="group relative w-full flex items-center justify-between rounded-card transition-all duration-200 outline-none select-none px-5 py-4 bg-[radial-gradient(circle_at_top_left,_#5b21b6_0%,_#2e1065_100%)] text-white shadow-[0_6px_0_#171033,_0_8px_15px_rgba(0,0,0,0.4),_inset_0_1px_2px_rgba(255,255,255,0.2)] hover:-translate-y-[1px] hover:shadow-[0_7px_0_#171033,_0_12px_20px_rgba(0,0,0,0.5),_inset_0_1px_2px_rgba(255,255,255,0.2)] active:translate-y-[6px] active:shadow-[0_0px_0_#171033,_0_2px_4px_rgba(0,0,0,0.4),_inset_0_2px_6px_rgba(0,0,0,0.3)]"
        >
          <div className="flex items-center gap-3">
            <svg className="h-6 w-6 text-white/90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
            <p className="font-display text-lg font-medium tracking-wide">Write it</p>
          </div>
          <div className="flex items-center gap-1 font-body text-sm font-medium text-white/50 transition-colors group-hover:text-white/90">
            <span>Expand</span>
            <svg className="h-4 w-4 opacity-70" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 9l-7 7-7-7" />
            </svg>
          </div>
        </button>
      ) : (
        <div className="space-y-4 rounded-card px-5 py-4 bg-[radial-gradient(circle_at_top_left,_#5b21b6_0%,_#2e1065_100%)] text-white shadow-[0_2px_0_#171033,_0_4px_8px_rgba(0,0,0,0.3),_inset_0_1px_2px_rgba(255,255,255,0.15)] animate-in fade-in slide-in-from-top-2 duration-200">
          <div className="flex items-center justify-between gap-3">
            <div className="flex items-center gap-3">
              <svg className="h-6 w-6 text-white/90" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
              </svg>
              <p className="font-display text-lg font-medium tracking-wide">Write it</p>
            </div>
            <button
              onClick={() => setTextExpanded(false)}
              className="rounded-full px-3 py-1.5 text-sm font-medium text-white/70 hover:bg-white/10 hover:text-white transition-colors focus:ring-2 focus:ring-white/30 outline-none"
              aria-label="Collapse text input"
            >
              Hide
            </button>
          </div>

          <div className="space-y-3">
            <textarea
              value={textDraft}
              onChange={(event) => setTextDraft(event.target.value)}
              rows={5}
              placeholder="Type or paste here..."
              className="w-full resize-none rounded-card bg-black/40 px-4 py-3 font-body text-sm text-white placeholder:text-white/40 outline-none transition focus:ring-2 focus:ring-white/30 shadow-[inset_0_2px_6px_rgba(0,0,0,0.4)]"
            />
            {textCaptureMutation.isError && submitError ? (
              <p className="rounded-card bg-red-500/10 px-3 py-2 font-body text-sm text-red-200 shadow-sm border border-red-500/20">
                {submitError}
              </p>
            ) : null}
            <div className="flex justify-end">
              <button
                type="button"
                onClick={() => textCaptureMutation.mutate(textDraft)}
                disabled={textCaptureMutation.isPending || !textDraft.trim()}
                className="rounded-pill bg-white/10 hover:bg-white/20 text-white border border-white/5 px-5 py-2 text-sm font-semibold shadow-sm active:scale-95 transition-all disabled:opacity-50 disabled:active:scale-100 disabled:hover:bg-white/10 backdrop-blur-sm"
              >
                {textCaptureMutation.isPending ? 'Preparing...' : 'Review Text Capture'}
              </button>
            </div>
          </div>
        </div>
      )}

      {(voiceCaptureMutation.isPending || textCaptureMutation.isPending) ? (
        <ExtractingLoader variant="tasks" />
      ) : null}

      {summary ? (
        <div className="space-y-3 rounded-card bg-surface-container p-4">
          <div className="space-y-1">
            <p className="font-body text-xs uppercase tracking-[0.15em] text-on-surface-variant">
              Result Summary
            </p>
            <h3 className="font-display text-xl text-on-surface">
              {summary.zero_actionable ? 'No actionable tasks found' : 'Capture completed'}
            </h3>
          </div>
          <div className="grid grid-cols-3 gap-2">
            <SummaryMetric label="Created" value={summary.tasks_created_count} />
            <SummaryMetric label="Review" value={summary.tasks_flagged_for_review_count} />
            <SummaryMetric label="Skipped" value={summary.tasks_skipped_count} />
          </div>
          {summary.skipped_items.length > 0 ? (
            <div className="space-y-1 rounded-card bg-surface-dim p-3">
              <p className="font-body text-xs uppercase tracking-[0.15em] text-on-surface-variant">
                Skipped Items
              </p>
              <ul className="space-y-1">
                {summary.skipped_items.map((item, index) => (
                  <li key={`${item.code}-${index}`} className="font-body text-xs text-on-surface">
                    {(item.title ? `${item.title}: ` : '') + item.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={resetSummary}
              className="rounded-pill bg-primary px-3 py-1.5 text-sm font-medium text-surface"
            >
              Start Another Capture
            </button>
            <Link
              to="/tasks"
              className="rounded-pill border border-outline px-3 py-1.5 text-sm text-on-surface-variant"
            >
              View Tasks
            </Link>
          </div>
        </div>
      ) : null}

      {showStaging && reviewCaptureId ? (
        <div className="space-y-4 mt-4">
          <StagingTable
            tasks={extractedTasksQuery.data ?? []}
            onApprove={handleApproveTask}
            onDiscard={handleDiscardTask}
            onApproveAll={handleApproveAll}
            onDiscardAll={handleDiscardAll}
            onTaskClick={handleTaskClick}
            isLoading={isLoadingTasks}
            title="Newly extracted tasks"
            subtext="Review and approve tasks from your latest capture"
            emptyMessage="No newly captured tasks to review"
          />

          {submitError ? (
            <p className="rounded-card bg-tertiary/10 px-3 py-2 font-body text-sm text-on-surface">
              {submitError}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={async () => {
                if (!reviewCaptureId || !sessionQuery.data?.csrf_token) {
                  return
                }
                try {
                  setSubmitError(null)
                  await completeCapture(reviewCaptureId, sessionQuery.data.csrf_token)
                  setShowStaging(false)
                  setReviewCaptureId(null)
                } catch (error) {
                  setSubmitError(buildFriendlyMessage(error, 'Failed to complete capture.'))
                }
              }}
              className="rounded-pill border border-outline px-3 py-1.5 text-sm text-on-surface-variant"
            >
              Done
            </button>
          </div>
        </div>
      ) : null}

      {/* Older pending tasks across previous captures */}
      {sessionQuery.data?.signed_in && visiblePendingTasks.length > 0 ? (
        <div className="space-y-4 mt-4">
          <StagingTable
            tasks={visiblePendingTasks}
            onApprove={handleApproveTask}
            onDiscard={handleDiscardTask}
            onApproveAll={handleApproveAllPending}
            onDiscardAll={handleDiscardAllPending}
            onTaskClick={handleTaskClick}
            isLoading={isLoadingAllPending}
            title="Old pending tasks"
            subtext="Pending tasks from previous captures awaiting review"
            emptyMessage="No older pending tasks to review"
          />
        </div>
      ) : null}

      {/* Edit Task Modal */}
      {editModalTask && sessionQuery.data?.csrf_token && (
        <EditExtractedTaskModal
          task={editModalTask}
          groups={groupsQuery.data ?? []}
          isOpen={!!editModalTask}
          onClose={handleEditModalClose}
          onSave={handleEditModalSave}
          csrfToken={sessionQuery.data.csrf_token}
        />
      )}
    </section>
  )
}

function SummaryMetric({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-card bg-surface-dim px-4 py-4 text-center">
      <p className="font-display text-2xl text-on-surface">{value}</p>
      <p className="font-body text-xs uppercase tracking-[0.2em] text-on-surface-variant">
        {label}
      </p>
    </div>
  )
}
