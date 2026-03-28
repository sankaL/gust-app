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
import { useNotifications } from '../components/Notifications'

type RecordedAudio = {
  blob: Blob
  filename: string
}

type CaptureErrorState = {
  message: string
  requestId: string | null
  canRetry: boolean
}

function buildFriendlyMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message
  }

  return fallback
}

function buildVoiceCaptureError(error: unknown): CaptureErrorState {
  if (!(error instanceof ApiError)) {
    return {
      message: 'Transcription failed. Please retry the same recording.',
      requestId: null,
      canRetry: true
    }
  }

  const mapping: Record<string, string> = {
    transcription_no_speech:
      'No speech was detected. Check that your microphone is picking up audio, then retry.',
    invalid_capture:
      'No audio was captured. Record a short voice note and retry, or use text capture.',
    transcription_timeout:
      'Transcription timed out. Check your connection and retry the same recording.',
    transcription_provider_unavailable:
      'Transcription service is temporarily unavailable. Please retry in a moment.',
    transcription_provider_rejected:
      'This recording could not be transcribed. Retry with clearer audio or use text capture.',
    transcription_provider_invalid_response:
      'Transcription returned an invalid response. Please retry the same recording.',
    transcription_failed: 'Transcription failed. Please retry the same recording.'
  }

  const retryableErrorCodes = new Set(Object.keys(mapping))
  const fallbackMessage = error.message.trim() || 'Transcription failed. Please retry the same recording.'
  const isRetryable = retryableErrorCodes.has(error.code)

  return {
    message: mapping[error.code] ?? fallbackMessage,
    requestId: error.requestId,
    canRetry: isRetryable
  }
}

function classifyMicrophoneError(error: unknown): string {
  const fallback = 'Microphone access failed. Check your device settings, then try again.'
  if (!(error instanceof DOMException)) {
    return fallback
  }

  switch (error.name) {
    case 'NotAllowedError':
    case 'SecurityError':
    case 'PermissionDeniedError':
      return 'Microphone permission was denied. Text capture is still available.'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No microphone was found. Connect a mic and try again, or use text capture.'
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'Microphone is unavailable or in use by another app. Try again, or use text capture.'
    case 'OverconstrainedError':
      return 'Microphone settings are unsupported on this device. Try default audio settings or text capture.'
    default:
      return fallback
  }
}

export function CaptureRoute() {
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const recordedChunksRef = useRef<BlobPart[]>([])
  const retryAudioRef = useRef<RecordedAudio | null>(null)
  const wakeLockRef = useRef<WakeLockSentinel | null>(null)
  const wakeLockRequestIdRef = useRef(0)
  const isRecordingRef = useRef(false)
  const queryClient = useQueryClient()
  const { notifyError, notifySuccess } = useNotifications()

  const [isRecording, setIsRecording] = useState(false)
  const [isRecorderLoading, setIsRecorderLoading] = useState(false)
  const [textExpanded, setTextExpanded] = useState(false)
  const [textDraft, setTextDraft] = useState('')
  const [reviewCaptureId, setReviewCaptureId] = useState<string | null>(null)
  const [permissionError, setPermissionError] = useState<string | null>(null)
  const [transcriptionError, setTranscriptionError] = useState<CaptureErrorState | null>(null)
  const [textCaptureError, setTextCaptureError] = useState<string | null>(null)
  const [summary, setSummary] = useState<SubmitCaptureResponse | null>(null)
  const [showStaging, setShowStaging] = useState(false)

  const sessionQuery = useQuery({
    queryKey: ['session-status'],
    queryFn: getSessionStatus,
    retry: false,
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

  const refreshTaskQueries = async (captureId?: string | null) => {
    const invalidations = [
      queryClient.invalidateQueries({ queryKey: ['pending-tasks'] }),
      queryClient.invalidateQueries({ queryKey: ['tasks'] })
    ]

    if (captureId) {
      invalidations.unshift(
        queryClient.invalidateQueries({ queryKey: ['extracted-tasks', captureId] })
      )
    }

    await Promise.all(invalidations)
  }

  // Handler functions for StagingTable
  const handleApproveTask = async (taskId: string) => {
    const captureId = resolveTaskCaptureId(taskId)
    if (!captureId) {
      notifyError('Task context is unavailable. Refresh and try again.')
      return
    }
    if (!sessionQuery.data?.csrf_token) return
    try {
      await approveExtractedTask(captureId, taskId, sessionQuery.data.csrf_token)
      await refreshTaskQueries(captureId)
      notifySuccess('Task approved.')
    } catch (error) {
      notifyError(buildFriendlyMessage(error, 'Failed to approve task.'))
    }
  }

  const handleDiscardTask = async (taskId: string) => {
    const captureId = resolveTaskCaptureId(taskId)
    if (!captureId) {
      notifyError('Task context is unavailable. Refresh and try again.')
      return
    }
    if (!sessionQuery.data?.csrf_token) return
    try {
      await discardExtractedTask(captureId, taskId, sessionQuery.data.csrf_token)
      await refreshTaskQueries(captureId)
      notifySuccess('Task discarded.')
    } catch (error) {
      notifyError(buildFriendlyMessage(error, 'Failed to discard task.'))
    }
  }

  const handleApproveAll = async () => {
    if (!reviewCaptureId || !sessionQuery.data?.csrf_token) return
    await approveAllExtractedTasks(reviewCaptureId, sessionQuery.data.csrf_token)
    await refreshTaskQueries(reviewCaptureId)
    notifySuccess('Approved all extracted tasks.')
  }

  const handleDiscardAll = async () => {
    if (!reviewCaptureId || !sessionQuery.data?.csrf_token) return
    await discardAllExtractedTasks(reviewCaptureId, sessionQuery.data.csrf_token)
    await refreshTaskQueries(reviewCaptureId)
    notifySuccess('Discarded all extracted tasks.')
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
    await refreshTaskQueries(reviewCaptureId)
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
    const tasksByCapture = tasks.reduce((acc, task) => {
      if (!acc[task.capture_id]) acc[task.capture_id] = []
      acc[task.capture_id].push(task)
      return acc
    }, {} as Record<string, typeof tasks>)
    await Promise.all(
      Object.entries(tasksByCapture).map(async ([captureId]) => {
        await approveAllExtractedTasks(captureId, csrfToken)
      })
    )
    await refreshTaskQueries(null)
    notifySuccess('Approved all older pending tasks.')
  }

  // Batch discard all pending tasks across all captures
  const handleDiscardAllPending = async () => {
    const tasks = visiblePendingTasks
    const csrfToken = sessionQuery.data?.csrf_token
    if (tasks.length === 0 || !csrfToken) return
    const tasksByCapture = tasks.reduce((acc, task) => {
      if (!acc[task.capture_id]) acc[task.capture_id] = []
      acc[task.capture_id].push(task)
      return acc
    }, {} as Record<string, typeof tasks>)
    await Promise.all(
      Object.entries(tasksByCapture).map(async ([captureId]) => {
        await discardAllExtractedTasks(captureId, csrfToken)
      })
    )
    await refreshTaskQueries(null)
    notifySuccess('Discarded all older pending tasks.')
  }

  const isLoadingTasks = extractedTasksQuery.isLoading || extractedTasksQuery.isFetching
  const isLoadingAllPending = allPendingTasksQuery.isLoading || allPendingTasksQuery.isFetching
  const isProcessingLatestCapture =
    showStaging && Boolean(reviewCaptureId) && isLoadingTasks && !extractedTasksQuery.data?.length

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
      setTextCaptureError(null)
      setTranscriptionError(null)
      setReviewCaptureId(payload.capture_id)
      setShowStaging(true)
    },
    onError: (error) => {
      setTextCaptureError(buildFriendlyMessage(error, 'Text capture could not be prepared.'))
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
      setTextCaptureError(null)
      setReviewCaptureId(payload.capture_id)
      setShowStaging(true)
    },
    onError: (error) => {
      setTranscriptionError(buildVoiceCaptureError(error))
    }
  })

  useEffect(() => {
    isRecordingRef.current = isRecording
  }, [isRecording])

  async function requestWakeLock() {
    if (
      !navigator.wakeLock ||
      document.visibilityState !== 'visible' ||
      !isRecordingRef.current
    ) {
      return
    }

    const currentWakeLock = wakeLockRef.current
    if (currentWakeLock && !currentWakeLock.released) {
      return
    }

    const requestId = wakeLockRequestIdRef.current + 1
    wakeLockRequestIdRef.current = requestId

    try {
      const sentinel = await navigator.wakeLock.request('screen')
      if (
        wakeLockRequestIdRef.current !== requestId ||
        !isRecordingRef.current ||
        document.visibilityState !== 'visible'
      ) {
        try {
          await sentinel.release()
        } catch {
          // Ignore release errors; we only need to avoid keeping stale locks.
        }
        return
      }
      sentinel.addEventListener('release', () => {
        if (wakeLockRef.current === sentinel) {
          wakeLockRef.current = null
        }
      })
      wakeLockRef.current = sentinel
    } catch {
      if (wakeLockRequestIdRef.current === requestId) {
        wakeLockRef.current = null
      }
    }
  }

  async function releaseWakeLock() {
    wakeLockRequestIdRef.current += 1
    const sentinel = wakeLockRef.current
    wakeLockRef.current = null
    if (!sentinel) {
      return
    }

    try {
      await sentinel.release()
    } catch {
      // Ignore release failures; recording cleanup should still complete.
    }
  }

  useEffect(() => {
    if (!isRecording) {
      void releaseWakeLock()
      return
    }

    void requestWakeLock()

    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void requestWakeLock()
        return
      }

      void releaseWakeLock()
    }

    document.addEventListener('visibilitychange', handleVisibilityChange)

    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange)
      void releaseWakeLock()
    }
  }, [isRecording])



  useEffect(() => {
    return () => {
      void releaseWakeLock()
      mediaRecorderRef.current?.stream.getTracks().forEach((track) => track.stop())
      mediaRecorderRef.current = null
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
    }
  }, [])

  async function startRecording() {
    setPermissionError(null)
    setTranscriptionError(null)
    setTextCaptureError(null)
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
          setTranscriptionError({
            message: 'No audio was captured. Try again or use text capture.',
            requestId: null,
            canRetry: false
          })
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
    } catch (error) {
      setPermissionError(classifyMicrophoneError(error))
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
  }

  function resetSummary() {
    setSummary(null)
    setTranscriptionError(null)
    setPermissionError(null)
    setTextCaptureError(null)
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
                <div className="mx-auto flex max-w-xl items-start gap-3 rounded-card bg-[linear-gradient(145deg,rgba(118,58,11,0.96),rgba(78,37,8,0.94))] px-4 py-3 text-left shadow-[0_10px_22px_rgba(0,0,0,0.32),inset_0_1px_0_rgba(255,214,153,0.18)]">
                  <span className="mt-0.5 inline-flex shrink-0 items-center justify-center text-amber-100 drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]">
                    <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                      <path d="M12 3.5a1 1 0 0 1 .88.53l8.4 15.4A1 1 0 0 1 20.4 21H3.6a1 1 0 0 1-.88-1.47l8.4-15.4A1 1 0 0 1 12 3.5zm0 5a1 1 0 0 0-1 1v4.4a1 1 0 0 0 2 0V9.5a1 1 0 0 0-1-1zm0 8.2a1.15 1.15 0 1 0 0 2.3 1.15 1.15 0 0 0 0-2.3z" />
                    </svg>
                  </span>
                  <p className="font-body text-sm leading-6 text-amber-50/95">{permissionError}</p>
                </div>
              ) : null}
              {transcriptionError ? (
                <div className="space-y-3 rounded-card bg-[linear-gradient(145deg,rgba(110,22,38,0.96),rgba(66,14,24,0.94))] px-4 py-3 text-left shadow-[0_12px_26px_rgba(0,0,0,0.34),inset_0_1px_0_rgba(255,148,177,0.16)]">
                  <div className="flex items-start gap-3">
                    <span className="mt-0.5 inline-flex shrink-0 items-center justify-center text-red-100 drop-shadow-[0_1px_2px_rgba(0,0,0,0.35)]">
                      <svg className="h-5 w-5" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">
                        <path d="M12 2.8A9.2 9.2 0 1 0 21.2 12 9.21 9.21 0 0 0 12 2.8zm0 13.45a1.17 1.17 0 1 1 0 2.34 1.17 1.17 0 0 1 0-2.34zm1-3.12a1 1 0 1 1-2 0V7.9a1 1 0 0 1 2 0z" />
                      </svg>
                    </span>
                    <div className="space-y-1">
                      <p className="font-body text-sm leading-6 text-red-50/95">{transcriptionError.message}</p>
                      {transcriptionError.requestId ? (
                        <p className="font-body text-xs text-red-100/75">
                          Support ID: {transcriptionError.requestId}
                        </p>
                      ) : null}
                    </div>
                  </div>
                  <div className="flex flex-wrap justify-start gap-2 pl-9">
                    {transcriptionError.canRetry && retryAudioRef.current ? (
                      <button
                        type="button"
                        onClick={retryVoiceCapture}
                        className="rounded-pill bg-red-100 px-3 py-1.5 text-sm font-semibold text-red-900 shadow-[0_2px_8px_rgba(0,0,0,0.22)] transition hover:-translate-y-0.5 hover:bg-red-50"
                      >
                        Retry Same Recording
                      </button>
                    ) : null}
                    <button
                      type="button"
                      onClick={() => setTranscriptionError(null)}
                      className="rounded-pill bg-black/25 px-3 py-1.5 text-sm text-red-100/95 transition hover:bg-black/35"
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
            <p className="font-display text-base font-medium tracking-wide">Write it instead</p>
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
              <p className="font-display text-base font-medium tracking-wide">Write it instead</p>
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
            {textCaptureMutation.isError && textCaptureError ? (
              <p className="rounded-card border border-error/35 bg-[rgba(80,18,18,0.92)] px-3 py-2 font-body text-sm text-red-100 shadow-[0_12px_24px_rgba(0,0,0,0.35)]">
                {textCaptureError}
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
        <div className="space-y-3 rounded-card border border-white/10 bg-[rgba(22,22,22,0.94)] p-4 shadow-[0_20px_40px_rgba(0,0,0,0.35)] backdrop-blur-sm">
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
            <div className="space-y-1 rounded-card border border-white/5 bg-surface-dim p-3">
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
          {isProcessingLatestCapture ? (
            <div className="rounded-card border border-white/10 bg-[rgba(22,22,22,0.94)] p-4 shadow-[0_20px_40px_rgba(0,0,0,0.35)] backdrop-blur-sm">
              <p className="font-body text-xs uppercase tracking-[0.15em] text-on-surface-variant">
                Latest capture
              </p>
              <h3 className="mt-2 font-display text-xl text-on-surface">Organizing your tasks</h3>
              <p className="mt-2 text-sm leading-6 text-on-surface-variant">
                The transcript is ready. Extracted tasks are still arriving, so this view will stay in a
                loading state until the first review set is available.
              </p>
            </div>
          ) : null}

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

          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => {
                void (async () => {
                  if (!reviewCaptureId || !sessionQuery.data?.csrf_token) {
                    return
                  }
                  try {
                    await completeCapture(reviewCaptureId, sessionQuery.data.csrf_token)
                    setShowStaging(false)
                    setReviewCaptureId(null)
                    notifySuccess('Capture review completed.')
                  } catch (error) {
                    notifyError(buildFriendlyMessage(error, 'Failed to complete capture.'))
                  }
                })()
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
