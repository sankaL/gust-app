import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import {
  ApiError,
  createTextCapture,
  createVoiceCapture,
  getSessionStatus,
  submitCapture,
  listExtractedTasks,
  listPendingTasks,
  approveExtractedTask,
  discardExtractedTask,
  approveAllExtractedTasks,
  discardAllExtractedTasks,
  updateExtractedTaskDueDate,
  completeCapture,
  type SubmitCaptureResponse
} from '../lib/api'
import { SessionRequiredCard } from '../components/SessionRequiredCard'
import { StagingTable } from '../components/StagingTable'

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
    } catch (error) {
      setSubmitError(buildFriendlyMessage(error, 'Failed to discard all tasks.'))
    }
  }

  const handleDueDateChange = async (taskId: string, dueDate: string | null) => {
    const captureId = resolveTaskCaptureId(taskId)
    if (!captureId) {
      setSubmitError('Task context is unavailable. Refresh and try again.')
      return
    }
    if (!sessionQuery.data?.csrf_token) return
    try {
      setSubmitError(null)
      await updateExtractedTaskDueDate(captureId, taskId, dueDate, sessionQuery.data.csrf_token)
      // Refresh both queries
      queryClient.invalidateQueries({ queryKey: ['extracted-tasks', captureId] })
      queryClient.invalidateQueries({ queryKey: ['pending-tasks'] })
    } catch (error) {
      setSubmitError(buildFriendlyMessage(error, 'Failed to update due date.'))
    }
  }

  // Batch approve all pending tasks across all captures
  const handleApproveAllPending = async () => {
    const tasks = allPendingTasksQuery.data ?? []
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
    const tasks = allPendingTasksQuery.data ?? []
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

  const submitMutation = useMutation({
    mutationFn: async (payload: { captureId: string; transcriptText: string }) => {
      const csrfToken = sessionQuery.data?.csrf_token
      if (!csrfToken) {
        throw new ApiError('Your session is missing a CSRF token.', 'csrf_missing', 403)
      }

      return submitCapture(payload.captureId, payload.transcriptText, csrfToken)
    },
    onSuccess: (payload) => {
      setSummary(payload)
      setTextDraft('')
      setTextExpanded(false)
      setReviewCaptureId(null)
      setShowStaging(false)
      setSubmitError(null)
      setTranscriptionError(null)
      retryAudioRef.current = null
      // Refresh the persistent pending list
      queryClient.invalidateQueries({ queryKey: ['pending-tasks'] })
    },
    onError: (error) => {
      setSubmitError(
        buildFriendlyMessage(error, 'Extraction failed. Edit the transcript and retry.')
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
    textCaptureMutation.isPending ||
    submitMutation.isPending

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

      <div className="rounded-soft bg-[radial-gradient(circle_at_top,_rgba(186,158,255,0.24),_rgba(16,16,16,0.94)_58%)] px-4 py-5 shadow-ambient">
        <div className="space-y-6 text-center">
          <div className="space-y-1">
            <p className="font-display text-xl text-on-surface">
              {isRecording
                ? 'Recording...'
                : voiceCaptureMutation.isPending
                  ? 'Transcribing...'
                  : 'Ready to capture'}
            </p>
          </div>

          <button
            type="button"
            onClick={isRecording ? stopRecording : startRecording}
            disabled={isBusy && !isRecording}
            className={[
              'mx-auto flex h-48 w-48 items-center justify-center rounded-pill border border-white/10 transition-all duration-300 active:scale-95',
              isRecording
                ? 'bg-[radial-gradient(circle_at_top,_rgba(253,129,168,0.95),_rgba(140,43,87,0.72))] text-white shadow-[0_0_60px_rgba(253,129,168,0.5)]'
                : 'bg-[radial-gradient(circle_at_top,_rgba(186,158,255,0.92),_rgba(132,85,239,0.82))] text-surface shadow-[0_0_40px_rgba(186,158,255,0.4)] hover:shadow-[0_0_60px_rgba(186,158,255,0.6)]'
            ].join(' ')}
            aria-label={isRecording ? 'Stop recording' : 'Start recording'}
          >
            {isRecording ? (
              <svg className="h-16 w-16" fill="currentColor" viewBox="0 0 24 24">
                <rect x="6" y="6" width="12" height="12" rx="2" />
              </svg>
            ) : (
              <svg className="h-16 w-16" fill="currentColor" viewBox="0 0 24 24">
                <path d="M12 14c1.66 0 3-1.34 3-3V5c0-1.66-1.34-3-3-3S9 3.34 9 5v6c0 1.66 1.34 3 3 3z" />
                <path d="M17 11c0 2.76-2.24 5-5 5s-5-2.24-5-5H5c0 3.53 2.61 6.43 6 6.92V21h2v-3.08c3.39-.49 6-3.39 6-6.92h-2z" />
              </svg>
            )}
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

      {/* Persistent Pending Tasks List - always visible when signed in */}
      {sessionQuery.data?.signed_in && (allPendingTasksQuery.data?.length ?? 0) > 0 ? (
        <div className="space-y-3 rounded-card bg-surface-container p-4">
          <div className="flex items-center justify-between gap-3">
            <div>
              <h2 className="font-display text-lg text-on-surface">
                Pending Tasks ({allPendingTasksQuery.data?.length ?? 0})
              </h2>
              <p className="font-body text-xs text-on-surface-variant">
                Tasks from all captures awaiting your review
              </p>
            </div>
          </div>
          <StagingTable
            tasks={allPendingTasksQuery.data ?? []}
            onApprove={handleApproveTask}
            onDiscard={handleDiscardTask}
            onApproveAll={handleApproveAllPending}
            onDiscardAll={handleDiscardAllPending}
            onDueDateChange={handleDueDateChange}
            isLoading={isLoadingAllPending}
          />
        </div>
      ) : null}

      {showStaging && reviewCaptureId ? (
        <div className="space-y-3 rounded-card bg-surface-container p-4">
          <StagingTable
            tasks={extractedTasksQuery.data ?? []}
            onApprove={handleApproveTask}
            onDiscard={handleDiscardTask}
            onApproveAll={handleApproveAll}
            onDiscardAll={handleDiscardAll}
            onDueDateChange={handleDueDateChange}
            isLoading={isLoadingTasks}
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

      <div className="space-y-3 rounded-card bg-surface-container p-4">
        <div className="flex items-center justify-between gap-3">
          <p className="font-display text-lg text-on-surface">Write it</p>
          <button
            type="button"
            onClick={() => setTextExpanded((current) => !current)}
            className="rounded-full bg-primary/20 p-2 text-primary transition-colors hover:bg-primary/30"
            aria-label={textExpanded ? 'Collapse text input' : 'Expand text input'}
          >
            <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
            </svg>
          </button>
        </div>

        {textExpanded ? (
          <div className="space-y-3">
            <textarea
              value={textDraft}
              onChange={(event) => setTextDraft(event.target.value)}
              rows={5}
              placeholder="Type or paste here..."
              className="w-full rounded-card bg-surface-dim px-3 py-3 font-body text-sm text-on-surface outline-none transition focus:ring-2 focus:ring-primary/50"
            />
            {textCaptureMutation.isError && submitError ? (
              <p className="rounded-card bg-tertiary/10 px-3 py-2 font-body text-sm text-on-surface">
                {submitError}
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => textCaptureMutation.mutate(textDraft)}
              disabled={textCaptureMutation.isPending}
              className="rounded-pill bg-surface-container-highest px-3 py-1.5 text-sm text-on-surface"
            >
              {textCaptureMutation.isPending ? 'Preparing Review' : 'Review Text Capture'}
            </button>
          </div>
        ) : null}
      </div>
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
