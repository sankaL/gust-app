import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Link } from 'react-router-dom'

import {
  ApiError,
  createTextCapture,
  createVoiceCapture,
  getAuthStartUrl,
  getSessionStatus,
  submitCapture,
  type SubmitCaptureResponse
} from '../lib/api'

type ReviewSource = 'voice' | 'text' | null

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

  const [isRecording, setIsRecording] = useState(false)
  const [isRecorderLoading, setIsRecorderLoading] = useState(false)
  const [textExpanded, setTextExpanded] = useState(false)
  const [textDraft, setTextDraft] = useState('')
  const [reviewCaptureId, setReviewCaptureId] = useState<string | null>(null)
  const [reviewText, setReviewText] = useState('')
  const [reviewSource, setReviewSource] = useState<ReviewSource>(null)
  const [permissionError, setPermissionError] = useState<string | null>(null)
  const [transcriptionError, setTranscriptionError] = useState<string | null>(null)
  const [submitError, setSubmitError] = useState<string | null>(null)
  const [summary, setSummary] = useState<SubmitCaptureResponse | null>(null)

  const sessionQuery = useQuery({
    queryKey: ['session-status'],
    queryFn: getSessionStatus
  })

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
      setReviewText(payload.transcript_text)
      setReviewSource('text')
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
      setReviewText(payload.transcript_text)
      setReviewSource('voice')
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
      setReviewText('')
      setReviewSource(null)
      setSubmitError(null)
      setTranscriptionError(null)
      retryAudioRef.current = null
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

  function discardReview() {
    retryAudioRef.current = null
    clearReviewState()
  }

  function clearReviewState() {
    setReviewCaptureId(null)
    setReviewText('')
    setReviewSource(null)
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

        <div className="rounded-soft border border-outline/40 bg-surface-container p-6 shadow-ambient">
          <div className="space-y-4">
            <p className="font-display text-2xl text-on-surface">Session Required</p>
            <p className="font-body text-sm leading-6 text-on-surface-variant">
              Gust fails closed when session state is missing. Sign in with Google to continue to
              capture.
            </p>
            <a
              href={getAuthStartUrl()}
              className="inline-flex rounded-pill bg-primary px-5 py-3 font-body text-sm font-medium text-surface"
            >
              Sign in with Google
            </a>
          </div>
        </div>
      </section>
    )
  }

  const userName = sessionQuery.data.user?.display_name ?? sessionQuery.data.user?.email ?? 'Gust user'

  return (
    <section className="space-y-6">
      <div className="space-y-3">
        <p className="font-body text-sm uppercase tracking-[0.25em] text-on-surface-variant">
          Voice-first launch
        </p>
        <h2 className="font-display text-3xl text-on-surface">Capture</h2>
        <p className="max-w-sm font-body text-base leading-7 text-on-surface-variant">
          Record first, review before write, and keep local edits until extraction succeeds or you
          discard them.
        </p>
      </div>

      <div className="rounded-soft border border-primary/20 bg-[radial-gradient(circle_at_top,_rgba(186,158,255,0.24),_rgba(16,16,16,0.94)_58%)] px-6 py-7 shadow-ambient">
        <div className="space-y-8 text-center">
          <div className="space-y-2">
            <p className="font-body text-xs uppercase tracking-[0.3em] text-on-surface-variant">
              {userName}
            </p>
            <p className="font-display text-2xl text-on-surface">
              {isRecording
                ? 'Tap again to stop'
                : voiceCaptureMutation.isPending
                  ? 'Transcribing recording'
                  : reviewCaptureId
                    ? 'Review the transcript'
                    : 'Tap to record'}
            </p>
            <p className="font-body text-sm text-on-surface-variant">
              Voice is primary. Text stays available when the mic is unavailable or not ideal.
            </p>
          </div>

          <button
            type="button"
            onClick={isRecording ? stopRecording : startRecording}
            disabled={isBusy && !isRecording}
            className={[
              'mx-auto flex h-56 w-56 items-center justify-center rounded-pill border border-white/10 transition',
              isRecording
                ? 'bg-[radial-gradient(circle_at_top,_rgba(253,129,168,0.95),_rgba(140,43,87,0.72))] text-white'
                : 'bg-[radial-gradient(circle_at_top,_rgba(186,158,255,0.92),_rgba(132,85,239,0.82))] text-surface'
            ].join(' ')}
            aria-label={isRecording ? 'Stop recording' : 'Start recording'}
          >
            <span className="font-display text-4xl">{isRecording ? 'Stop' : 'Mic'}</span>
          </button>

          <div className="space-y-3">
            {permissionError ? (
              <p className="rounded-card border border-tertiary/30 bg-tertiary/10 px-4 py-3 font-body text-sm text-on-surface">
                {permissionError}
              </p>
            ) : null}
            {transcriptionError ? (
              <div className="space-y-3 rounded-card border border-tertiary/30 bg-tertiary/10 px-4 py-4">
                <p className="font-body text-sm text-on-surface">{transcriptionError}</p>
                <div className="flex flex-wrap justify-center gap-3">
                  <button
                    type="button"
                    onClick={retryVoiceCapture}
                    className="rounded-pill bg-primary px-4 py-2 text-sm font-medium text-surface"
                  >
                    Retry Same Recording
                  </button>
                  <button
                    type="button"
                    onClick={() => setTranscriptionError(null)}
                    className="rounded-pill border border-outline px-4 py-2 text-sm text-on-surface-variant"
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
        <div className="space-y-4 rounded-card border border-primary/15 bg-surface-container p-6">
          <div className="space-y-2">
            <p className="font-body text-xs uppercase tracking-[0.2em] text-on-surface-variant">
              Result Summary
            </p>
            <h3 className="font-display text-2xl text-on-surface">
              {summary.zero_actionable ? 'No actionable tasks found' : 'Capture completed'}
            </h3>
          </div>
          <div className="grid grid-cols-3 gap-3">
            <SummaryMetric label="Created" value={summary.tasks_created_count} />
            <SummaryMetric label="Review" value={summary.tasks_flagged_for_review_count} />
            <SummaryMetric label="Skipped" value={summary.tasks_skipped_count} />
          </div>
          {summary.skipped_items.length > 0 ? (
            <div className="space-y-2 rounded-card bg-surface-dim p-4">
              <p className="font-body text-xs uppercase tracking-[0.2em] text-on-surface-variant">
                Skipped Items
              </p>
              <ul className="space-y-2">
                {summary.skipped_items.map((item, index) => (
                  <li key={`${item.code}-${index}`} className="font-body text-sm text-on-surface">
                    {(item.title ? `${item.title}: ` : '') + item.message}
                  </li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={resetSummary}
              className="rounded-pill bg-primary px-4 py-2 text-sm font-medium text-surface"
            >
              Start Another Capture
            </button>
            <Link
              to="/tasks"
              className="rounded-pill border border-outline px-4 py-2 text-sm text-on-surface-variant"
            >
              View Tasks
            </Link>
          </div>
        </div>
      ) : null}

      {reviewCaptureId ? (
        <div className="space-y-4 rounded-card border border-primary/20 bg-surface-container p-6">
          <div className="space-y-2">
            <p className="font-body text-xs uppercase tracking-[0.2em] text-on-surface-variant">
              Transcript Review
            </p>
            <h3 className="font-display text-2xl text-on-surface">
              {reviewSource === 'voice' ? 'Voice transcript' : 'Text draft review'}
            </h3>
            <p className="font-body text-sm text-on-surface-variant">
              Edit anything you need before Gust creates tasks.
            </p>
          </div>

          <label className="space-y-2">
            <span className="font-body text-sm text-on-surface-variant">Transcript</span>
            <textarea
              aria-label="Transcript"
              value={reviewText}
              onChange={(event) => setReviewText(event.target.value)}
              rows={8}
              className="min-h-40 w-full rounded-card border border-outline/40 bg-surface-dim px-4 py-4 font-body text-base text-on-surface outline-none transition focus:border-primary"
            />
          </label>

          {submitError ? (
            <p className="rounded-card border border-tertiary/30 bg-tertiary/10 px-4 py-3 font-body text-sm text-on-surface">
              {submitError}
            </p>
          ) : null}

          <div className="flex flex-wrap gap-3">
            <button
              type="button"
              onClick={() => {
                if (reviewCaptureId) {
                  submitMutation.mutate({
                    captureId: reviewCaptureId,
                    transcriptText: reviewText
                  })
                }
              }}
              disabled={submitMutation.isPending}
              className="rounded-pill bg-primary px-4 py-2 text-sm font-medium text-surface"
            >
              {submitMutation.isPending ? 'Submitting' : 'Submit Transcript'}
            </button>
            <button
              type="button"
              onClick={discardReview}
              className="rounded-pill border border-outline px-4 py-2 text-sm text-on-surface-variant"
            >
              Discard
            </button>
          </div>
        </div>
      ) : null}

      <div className="space-y-4 rounded-card bg-surface-container p-6">
        <div className="flex items-center justify-between gap-4">
          <div>
            <p className="font-display text-xl text-on-surface">Text fallback</p>
            <p className="font-body text-sm text-on-surface-variant">
              Secondary by design, still fully reviewable before extraction.
            </p>
          </div>
          <button
            type="button"
            onClick={() => setTextExpanded((current) => !current)}
            className="rounded-pill border border-outline px-4 py-2 text-xs uppercase tracking-[0.2em] text-on-surface-variant"
          >
            {textExpanded ? 'Collapse' : 'Expand'}
          </button>
        </div>

        {textExpanded ? (
          <div className="space-y-4">
            <textarea
              value={textDraft}
              onChange={(event) => setTextDraft(event.target.value)}
              rows={5}
              placeholder="Type or paste a messy brain dump here..."
              className="w-full rounded-card border border-outline/40 bg-surface-dim px-4 py-4 font-body text-base text-on-surface outline-none transition focus:border-primary"
            />
            {textCaptureMutation.isError && submitError ? (
              <p className="rounded-card border border-tertiary/30 bg-tertiary/10 px-4 py-3 font-body text-sm text-on-surface">
                {submitError}
              </p>
            ) : null}
            <button
              type="button"
              onClick={() => textCaptureMutation.mutate(textDraft)}
              disabled={textCaptureMutation.isPending}
              className="rounded-pill bg-surface-container-highest px-4 py-2 text-sm text-on-surface"
            >
              {textCaptureMutation.isPending ? 'Preparing Review' : 'Review Text Capture'}
            </button>
          </div>
        ) : (
          <div className="rounded-card bg-surface-dim px-4 py-5 text-sm text-on-surface-variant">
            Expand the fallback when typing is faster or the mic is unavailable.
          </div>
        )}
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
