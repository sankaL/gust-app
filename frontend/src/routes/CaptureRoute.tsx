import { useEffect, useRef } from 'react'
import { useSearchParams } from 'react-router-dom'

import { useAppShellActions } from '../components/AppShellActions'
import { ExtractingLoader } from '../components/ExtractingLoader'
import {
  CaptureEditModal,
  CaptureSessionLoading,
  CaptureSessionRequired,
  CaptureStaging,
  CaptureSummary,
  TextCapturePanel,
  VoiceCaptureCard,
} from './capture/CaptureView'
import { useCaptureController } from './capture/useCaptureController'

export function CaptureRoute() {
  const controller = useCaptureController()
  if (controller.queries.session.isLoading) return <CaptureSessionLoading />
  if (controller.queries.session.isError || !controller.queries.session.data?.signed_in) return <CaptureSessionRequired />
  return <SignedInCapture controller={controller} />
}

function SignedInCapture({ controller }: { controller: ReturnType<typeof useCaptureController> }) {
  const shellActions = useAppShellActions()
  const [searchParams, setSearchParams] = useSearchParams()
  const { state, queries, mutations, recorder, review } = controller
  const { setTextExpanded } = state
  const controllerRef = useRef(controller)
  controllerRef.current = controller

  const isRecording = recorder.isRecording
  const isBusy = recorder.isLoading || mutations.voice.isPending || mutations.text.isPending
  const isRecordingActionDisabled = !isRecording && isBusy
  useEffect(() => {
    shellActions?.setIsRecording?.(isRecording)
    shellActions?.setIsRecordingActionDisabled?.(isRecordingActionDisabled)
    shellActions?.setOnToggleRecording?.(() => () => toggleRecorder(controllerRef.current))
    return () => {
      shellActions?.setIsRecording?.(false)
      shellActions?.setIsRecordingActionDisabled?.(false)
      shellActions?.setOnToggleRecording?.(null)
    }
  }, [isRecording, isRecordingActionDisabled, shellActions])

  useEffect(() => {
    if (searchParams.get('compose') === '1') {
      setTextExpanded(true)
      const nextSearchParams = new URLSearchParams(searchParams)
      nextSearchParams.delete('compose')
      setSearchParams(nextSearchParams, { replace: true })
    }
    if (searchParams.get('record') === '1') {
      const nextSearchParams = new URLSearchParams(searchParams)
      nextSearchParams.delete('record')
      setSearchParams(nextSearchParams, { replace: true })
      if (!isRecordingActionDisabled) {
        void controller.startRecording()
      }
    }
  }, [searchParams, setSearchParams, setTextExpanded, isRecordingActionDisabled, controller])
  return (
    <section className="space-y-5">
      <VoiceCaptureCard
        isRecording={recorder.isRecording}
        isBusy={isBusy}
        isTranscribing={mutations.voice.isPending}
        permissionError={recorder.error}
        transcriptionError={state.transcriptionError}
        canRetry={controller.canRetry}
        onToggle={() => toggleRecorder(controller)}
        onRetry={controller.retryVoice}
        onDismissError={() => state.setTranscriptionError(null)}
      />
      <TextCapturePanel expanded={state.textExpanded} draft={state.textDraft} error={mutations.text.isError ? state.textCaptureError : null} isPending={mutations.text.isPending} onExpanded={state.setTextExpanded} onDraft={state.setTextDraft} onSubmit={() => mutations.text.mutate(state.textDraft)} />
      <MutationProgress text={mutations.text.isPending} />
      <CaptureSummary summary={state.summary} onReset={() => { state.setSummary(null); state.setTranscriptionError(null); recorder.setError(null); state.setTextCaptureError(null) }} />
      <LatestCaptureReview controller={controller} />
      <OlderPendingReview controller={controller} />
      <CaptureEditModal task={state.editTask} groups={queries.groups.data ?? []} csrfToken={queries.session.data?.csrf_token ?? null} onClose={() => state.setEditTask(null)} onSave={() => review.refresh(state.reviewCaptureId)} />
    </section>
  )
}

function toggleRecorder(controller: ReturnType<typeof useCaptureController>) {
  if (controller.recorder.isRecording) controller.recorder.stop()
  else if (!controller.recorder.isLoading && !controller.mutations.voice.isPending && !controller.mutations.text.isPending) void controller.startRecording()
}

function MutationProgress({ text }: { text: boolean }) {
  return text ? <ExtractingLoader variant="tasks" /> : null
}

function LatestCaptureReview({ controller }: { controller: ReturnType<typeof useCaptureController> }) {
  const { state, queries, review } = controller
  if (!state.showStaging || !state.reviewCaptureId) return null
  const loading = queries.extracted.isLoading || queries.extracted.isFetching
  const processing = loading && !queries.extracted.data?.length
  return <CaptureStaging tasks={queries.extracted.data ?? []} isLoading={loading} processing={processing} title="Newly extracted tasks" subtext="Review and approve tasks from your latest capture" onApprove={review.approve} onDiscard={review.discard} onApproveAll={review.approveAll} onDiscardAll={review.discardAll} onTaskClick={state.setEditTask} onDone={() => void controller.completeReview()} />
}

function OlderPendingReview({ controller }: { controller: ReturnType<typeof useCaptureController> }) {
  const { queries, review, state } = controller
  if (!queries.visiblePending.length) return null
  return <CaptureStaging tasks={queries.visiblePending} isLoading={queries.pending.isLoading || queries.pending.isFetching} title="Old pending tasks" subtext="Pending tasks from previous captures awaiting review" onApprove={review.approve} onDiscard={review.discard} onApproveAll={review.approvePending} onDiscardAll={review.discardPending} onTaskClick={state.setEditTask} />
}
