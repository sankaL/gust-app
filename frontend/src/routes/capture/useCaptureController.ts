import { useCallback, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { useNotifications } from '../../components/Notifications'
import {
  approveAllExtractedTasks,
  approveExtractedTask,
  completeCapture,
  createTextCapture,
  createVoiceCapture,
  discardAllExtractedTasks,
  discardExtractedTask,
  getSessionStatus,
  listExtractedTasks,
  listGroups,
  listPendingTasks,
  type ExtractedTask,
  type SubmitCaptureResponse,
} from '../../lib/api'
import { requireCsrfToken } from '../../lib/sessionSecurity'
import type { RecordedAudio } from '../../lib/microphone'
import { buildVoiceCaptureError, captureErrorMessage, resolveCaptureId, uniqueCaptureIds, type CaptureErrorState } from './captureModel'
import { useCaptureRecorder } from './useCaptureRecorder'

function useCaptureState() {
  const [textExpanded, setTextExpanded] = useState(false)
  const [textDraft, setTextDraft] = useState('')
  const [reviewCaptureId, setReviewCaptureId] = useState<string | null>(null)
  const [showStaging, setShowStaging] = useState(false)
  const [transcriptionError, setTranscriptionError] = useState<CaptureErrorState | null>(null)
  const [textCaptureError, setTextCaptureError] = useState<string | null>(null)
  const [summary, setSummary] = useState<SubmitCaptureResponse | null>(null)
  const [editTask, setEditTask] = useState<ExtractedTask | null>(null)
  return { textExpanded, setTextExpanded, textDraft, setTextDraft, reviewCaptureId, setReviewCaptureId, showStaging, setShowStaging, transcriptionError, setTranscriptionError, textCaptureError, setTextCaptureError, summary, setSummary, editTask, setEditTask }
}

function useCaptureQueries(reviewCaptureId: string | null, showStaging: boolean) {
  const session = useQuery({ queryKey: ['session-status'], queryFn: getSessionStatus, retry: false })
  const pending = useQuery({ queryKey: ['pending-tasks'], queryFn: listPendingTasks, enabled: !!session.data?.signed_in })
  const extracted = useQuery({ queryKey: ['extracted-tasks', reviewCaptureId], queryFn: () => listExtractedTasks(reviewCaptureId!), enabled: !!reviewCaptureId && showStaging })
  const groups = useQuery({ queryKey: ['groups'], queryFn: listGroups, enabled: !!session.data?.signed_in })
  const visiblePending = showStaging && reviewCaptureId
    ? (pending.data ?? []).filter((task) => task.capture_id !== reviewCaptureId)
    : (pending.data ?? [])
  return { session, pending, extracted, groups, visiblePending }
}

function useCaptureMutations(state: ReturnType<typeof useCaptureState>, session: ReturnType<typeof useCaptureQueries>['session']) {
  const beginReview = (captureId: string) => {
    state.setSummary(null); state.setTextCaptureError(null); state.setTranscriptionError(null)
    state.setReviewCaptureId(captureId); state.setShowStaging(true)
  }
  const text = useMutation({
    mutationFn: (value: string) => createTextCapture(value, requireCsrfToken(session.data)),
    onSuccess: (payload) => beginReview(payload.capture_id),
    onError: (error) => state.setTextCaptureError(captureErrorMessage(error, 'Text capture could not be prepared.')),
  })
  const voice = useMutation({
    mutationFn: (audio: RecordedAudio) => createVoiceCapture(audio.blob, audio.filename, requireCsrfToken(session.data)),
    onSuccess: (payload) => beginReview(payload.capture_id),
    onError: (error) => state.setTranscriptionError(buildVoiceCaptureError(error)),
  })
  return { text, voice }
}

type ReviewContext = {
  state: ReturnType<typeof useCaptureState>
  queries: ReturnType<typeof useCaptureQueries>
  notifyError: (message: string) => string
  notifySuccess: (message: string) => string
}

const EMPTY_EXTRACTED_TASKS: ExtractedTask[] = []

function availableTasks(tasks: ExtractedTask[] | undefined) {
  return tasks || EMPTY_EXTRACTED_TASKS
}

function taskCaptureId(context: ReviewContext, taskId: string) {
  return resolveCaptureId(
    taskId,
    availableTasks(context.queries.pending.data),
    availableTasks(context.queries.extracted.data),
    context.state.reviewCaptureId,
  )
}

function useCaptureReviewActions(context: ReviewContext) {
  const queryClient = useQueryClient()
  const refresh = async (captureId?: string | null) => {
    const work = [queryClient.invalidateQueries({ queryKey: ['pending-tasks'] }), queryClient.invalidateQueries({ queryKey: ['tasks'] })]
    if (captureId) work.unshift(queryClient.invalidateQueries({ queryKey: ['extracted-tasks', captureId] }))
    await Promise.all(work)
  }
  const taskAction = async (taskId: string, action: (captureId: string, taskId: string, csrfToken: string) => Promise<unknown>, success: string, fallback: string) => {
    const captureId = taskCaptureId(context, taskId)
    if (!captureId) return void context.notifyError('Task context is unavailable. Refresh and try again.')
    try { await action(captureId, taskId, requireCsrfToken(context.queries.session.data)); await refresh(captureId); context.notifySuccess(success) }
    catch (error) { context.notifyError(captureErrorMessage(error, fallback)) }
  }
  const captureAction = async (action: (captureId: string, csrfToken: string) => Promise<unknown>, success: string) => {
    if (!context.state.reviewCaptureId) return
    await action(context.state.reviewCaptureId, requireCsrfToken(context.queries.session.data)); await refresh(context.state.reviewCaptureId); context.notifySuccess(success)
  }
  const pendingAction = async (action: (captureId: string, csrfToken: string) => Promise<unknown>, success: string) => {
    if (!context.queries.visiblePending.length) return
    const csrf = requireCsrfToken(context.queries.session.data)
    await Promise.all(uniqueCaptureIds(context.queries.visiblePending).map((id) => action(id, csrf)))
    await refresh(null); context.notifySuccess(success)
  }
  return { refresh, approve: (id: string) => taskAction(id, approveExtractedTask, 'Task approved.', 'Failed to approve task.'), discard: (id: string) => taskAction(id, discardExtractedTask, 'Task discarded.', 'Failed to discard task.'), approveAll: () => captureAction(approveAllExtractedTasks, 'Approved all extracted tasks.'), discardAll: () => captureAction(discardAllExtractedTasks, 'Discarded all extracted tasks.'), approvePending: () => pendingAction(approveAllExtractedTasks, 'Approved all older pending tasks.'), discardPending: () => pendingAction(discardAllExtractedTasks, 'Discarded all older pending tasks.') }
}

export function useCaptureController() {
  const state = useCaptureState()
  const queries = useCaptureQueries(state.reviewCaptureId, state.showStaging)
  const { notifyError, notifySuccess } = useNotifications()
  const mutations = useCaptureMutations(state, queries.session)
  const retryAudio = useRef<RecordedAudio | null>(null)
  const onAudio = useCallback((audio: RecordedAudio) => {
    if (!audio.blob.size) return state.setTranscriptionError({ message: 'No audio was captured. Try again or use text capture.', requestId: null, canRetry: false })
    retryAudio.current = audio; mutations.voice.mutate(audio)
  }, [mutations.voice, state])
  const recorder = useCaptureRecorder(onAudio)
  const review = useCaptureReviewActions({ state, queries, notifyError, notifySuccess })
  const startRecording = async () => {
    state.setTranscriptionError(null); state.setTextCaptureError(null); state.setReviewCaptureId(null); state.setSummary(null); retryAudio.current = null
    const started = await recorder.start(); if (!started) state.setTextExpanded(true)
  }
  const retryVoice = () => { if (retryAudio.current) { state.setTranscriptionError(null); mutations.voice.mutate(retryAudio.current) } }
  const completeReview = async () => {
    if (!state.reviewCaptureId) return
    try { await completeCapture(state.reviewCaptureId, requireCsrfToken(queries.session.data)); state.setShowStaging(false); state.setReviewCaptureId(null); notifySuccess('Capture review completed.') }
    catch (error) { notifyError(captureErrorMessage(error, 'Failed to complete capture.')) }
  }
  return { state, queries, mutations, recorder, review, retryVoice, canRetry: !!retryAudio.current, startRecording, completeReview }
}
