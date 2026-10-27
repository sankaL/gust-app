import { useEffect, useRef, useState } from 'react'
import { ArrowRight, CheckCheck, Inbox, Keyboard, Mic, SearchX } from 'lucide-react'

import { Button } from '../../components/Button'
import { ExtractedTaskCard } from '../../components/ExtractedTaskCard'
import { useNotifications } from '../../components/Notifications'
import { BottomSheet, SheetHeader } from '../../components/ui/BottomSheet'
import { EmptyState, InlineNotice, SegmentedControl } from '../../components/ui/controls'
import type { ExtractedTask } from '../../lib/api'
import type { CaptureLaunchMode } from '../../hooks/useShellSheets'
import type { CaptureErrorState } from './captureModel'
import type { useCaptureController } from './useCaptureController'
import { useBulkAction } from './useBulkAction'
import { LiveBars, VoiceOrb } from './VoiceOrb'

type CaptureController = ReturnType<typeof useCaptureController>
type CapturePhase = 'compose' | 'recording' | 'processing' | 'review'

const PROCESSING_MESSAGES = ['Listening back to your note…', 'Pulling out action items…', 'Sorting tasks into groups…', 'Checking dates and reminders…', 'Almost there…']

function capturePhase(controller: CaptureController): CapturePhase {
  if (controller.recorder.isRecording) return 'recording'
  if (controller.mutations.voice.isPending || controller.mutations.text.isPending) return 'processing'
  if (controller.state.showStaging && controller.state.reviewCaptureId) return 'review'
  return 'compose'
}

export function ExtractedTaskList({ tasks, onApprove, onDiscard, onOpen }: { tasks: ExtractedTask[]; onApprove: (id: string) => Promise<void>; onDiscard: (id: string) => Promise<void>; onOpen: (task: ExtractedTask) => void }) {
  return (
    <ul className="space-y-3">
      {tasks.map((task, index) => (
        <li key={task.id} className="animate-rise-in" style={{ ['--stagger' as string]: Math.min(index, 8) }}>
          <ExtractedTaskCard task={task} onApprove={onApprove} onDiscard={onDiscard} onClick={onOpen} />
        </li>
      ))}
    </ul>
  )
}

export function BulkReviewFooter({ count, running, onApproveAll, onDiscardAll, extra }: { count: number; running: 'approve' | 'discard' | null; onApproveAll: () => void; onDiscardAll: () => void; extra?: React.ReactNode }) {
  const disabled = running !== null || count === 0
  return (
    <div className="flex items-center gap-2.5">
      <Button variant="secondary" size="lg" className="flex-1" disabled={disabled} onClick={onDiscardAll}>{running === 'discard' ? 'Discarding…' : 'Discard All'}</Button>
      <Button variant="primary" size="lg" className="flex-[1.4]" disabled={disabled} onClick={onApproveAll}>{running === 'approve' ? 'Approving…' : `Approve All${count > 1 ? ` (${count})` : ''}`}</Button>
      {extra}
    </div>
  )
}

function useElapsedSeconds(active: boolean) {
  const [seconds, setSeconds] = useState(0)
  useEffect(() => {
    if (!active) { setSeconds(0); return undefined }
    const startedAt = Date.now()
    const intervalId = window.setInterval(() => setSeconds(Math.floor((Date.now() - startedAt) / 1000)), 250)
    return () => window.clearInterval(intervalId)
  }, [active])
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`
}

function useRotatingMessage(active: boolean) {
  const [index, setIndex] = useState(0)
  useEffect(() => {
    if (!active) { setIndex(0); return undefined }
    const intervalId = window.setInterval(() => setIndex((current) => (current + 1) % PROCESSING_MESSAGES.length), 2400)
    return () => window.clearInterval(intervalId)
  }, [active])
  return { index, message: PROCESSING_MESSAGES[index] }
}

function CaptureErrors({ permissionError, transcriptionError, canRetry, onRetry, onDismiss }: { permissionError: string | null; transcriptionError: CaptureErrorState | null; canRetry: boolean; onRetry: () => void; onDismiss: () => void }) {
  if (!permissionError && !transcriptionError) return null
  return (
    <div className="animate-rise-in space-y-2">
      {permissionError ? <InlineNotice tone="warning" role="alert">{permissionError}</InlineNotice> : null}
      {transcriptionError ? (
        <InlineNotice
          tone="error"
          role="alert"
          action={<>
            {transcriptionError.canRetry && canRetry ? <Button variant="primary" size="sm" onClick={onRetry}>Retry Same Recording</Button> : null}
            <Button variant="ghost" size="sm" onClick={onDismiss}>Dismiss</Button>
          </>}
        >
          <p>{transcriptionError.message}</p>
          {transcriptionError.requestId ? <p className="mt-1 text-xs opacity-75">Support ID: {transcriptionError.requestId}</p> : null}
        </InlineNotice>
      ) : null}
    </div>
  )
}

function ComposeView({ controller }: { controller: CaptureController }) {
  const { state, recorder, mutations } = controller
  const mode = state.textExpanded ? 'type' : 'speak'
  const textError = mutations.text.isError ? state.textCaptureError : null
  const textareaRef = useRef<HTMLTextAreaElement>(null)

  useEffect(() => { if (mode === 'type') textareaRef.current?.focus({ preventScroll: true }) }, [mode])

  return (
    <div className="flex min-h-full flex-col gap-5 pb-2">
      <SegmentedControl
        label="Capture mode"
        value={mode}
        onChange={(next) => state.setTextExpanded(next === 'type')}
        options={[{ value: 'speak', label: 'Speak', icon: Mic }, { value: 'type', label: 'Type', icon: Keyboard }]}
        className="w-full"
      />
      <CaptureErrors
        permissionError={recorder.error}
        transcriptionError={state.transcriptionError}
        canRetry={controller.canRetry}
        onRetry={controller.retryVoice}
        onDismiss={() => state.setTranscriptionError(null)}
      />
      {mode === 'speak' ? (
        <div key="speak" className="animate-fade-in flex flex-1 flex-col items-center justify-center gap-2 text-center">
          <VoiceOrb state={recorder.isLoading ? 'starting' : 'idle'} stream={null} disabled={recorder.isLoading} onClick={() => void controller.startRecording()} label="Start recording" />
          <p className="font-display text-lg font-bold text-on-surface">{recorder.isLoading ? 'Opening microphone…' : 'Tap to record'}</p>
          <p className="max-w-[17rem] font-body text-sm leading-6 text-on-surface-variant">Say it the way you&apos;d tell a friend. Gust turns it into tasks you can review.</p>
        </div>
      ) : (
        <div key="type" className="animate-fade-in flex flex-1 flex-col gap-3">
          <label htmlFor="capture-text" className="sr-only">Write it instead</label>
          <textarea
            id="capture-text"
            ref={textareaRef}
            value={state.textDraft}
            onChange={(event) => state.setTextDraft(event.target.value)}
            rows={7}
            placeholder="Call the dentist Friday, renew passport before March, buy milk on the way home…"
            className="min-h-[11rem] w-full flex-1 resize-none rounded-soft bg-surface-dim p-4 font-body text-[0.95rem] leading-6 text-on-surface outline-none ring-1 ring-inset ring-outline/50 transition-shadow placeholder:text-on-surface-variant/60 focus:ring-2 focus:ring-primary/60"
          />
          {textError ? <InlineNotice tone="error" role="alert">{textError}</InlineNotice> : null}
          <Button variant="primary" size="lg" fullWidth disabled={mutations.text.isPending || !state.textDraft.trim()} onClick={() => mutations.text.mutate(state.textDraft)}>
            {mutations.text.isPending ? 'Preparing...' : <>Review Text Capture<ArrowRight className="h-4 w-4" strokeWidth={2.4} /></>}
          </Button>
        </div>
      )}
    </div>
  )
}

function RecordingView({ controller }: { controller: CaptureController }) {
  const elapsed = useElapsedSeconds(true)
  return (
    <div className="animate-fade-in flex min-h-full flex-col items-center justify-center gap-3 pb-2 text-center">
      <VoiceOrb state="recording" stream={controller.recorder.stream} onClick={() => controller.recorder.stop()} label="Stop recording" />
      <div className="flex items-center gap-2.5" role="status" aria-live="polite">
        <LiveBars />
        <p className="font-display text-2xl font-extrabold tabular-nums tracking-[-0.02em] text-on-surface">{elapsed}</p>
      </div>
      <p className="font-body text-sm text-on-surface-variant">Recording… tap the orb when you&apos;re done</p>
      <div className="mt-3 flex items-center gap-2">
        <Button variant="ghost" size="sm" onClick={controller.cancelRecording}>Discard</Button>
        <Button variant="secondary" size="sm" onClick={() => { controller.cancelRecording(); controller.state.setTextExpanded(true) }}>
          <Keyboard className="h-4 w-4" strokeWidth={2.2} />Type instead
        </Button>
      </div>
    </div>
  )
}

function ProcessingView({ isVoice }: { isVoice: boolean }) {
  const { index, message } = useRotatingMessage(true)
  return (
    <div className="flex min-h-full flex-col items-center gap-4 pb-2 text-center" role="status" aria-label={isVoice ? 'Transcribing voice' : 'Extracting tasks'}>
      <VoiceOrb state="processing" stream={null} disabled label={isVoice ? 'Transcribing voice' : 'Extracting tasks'} />
      <p key={index} className="animate-word-swap font-display text-lg font-bold text-on-surface">{message}</p>
      <p className="-mt-2 max-w-[18rem] font-body text-xs leading-5 text-on-surface-variant">You can close this sheet. New tasks will wait for you in Review.</p>
      <div className="mt-2 w-full space-y-3" aria-hidden="true">
        {[0, 1].map((row) => (
          <div key={row} className="rounded-[1.35rem] bg-surface-container-high p-4 ring-1 ring-inset ring-outline/40">
            <div className="skeleton-shimmer h-4 w-3/5 rounded-pill" />
            <div className="skeleton-shimmer mt-2.5 h-3 w-4/5 rounded-pill" />
            <div className="mt-3 flex gap-1.5"><div className="skeleton-shimmer h-6 w-16 rounded-pill" /><div className="skeleton-shimmer h-6 w-12 rounded-pill" /></div>
          </div>
        ))}
      </div>
    </div>
  )
}

function ReviewView({ controller, tasks, handledCount, isLoading, olderPendingCount, onOpenReview, onFinish }: { controller: CaptureController; tasks: ExtractedTask[]; handledCount: number; isLoading: boolean; olderPendingCount: number; onOpenReview: () => void; onFinish: () => void }) {
  return (
    <div className="space-y-4">
      {isLoading && tasks.length === 0 ? <p className="py-6 text-center font-body text-sm text-on-surface-variant">Loading extracted tasks...</p> : null}
      {!isLoading && tasks.length === 0 && handledCount > 0 ? (
        <EmptyState icon={CheckCheck} title="Everything reviewed" action={<Button variant="primary" onClick={onFinish}>Done</Button>}>
          {handledCount === 1 ? 'That task is' : `All ${handledCount} tasks are`} sorted. Approved tasks are already on your list.
        </EmptyState>
      ) : null}
      {!isLoading && tasks.length === 0 && handledCount === 0 ? (
        <EmptyState icon={SearchX} title="No newly captured tasks to review" action={<Button variant="soft" onClick={() => void controller.completeReview()}>Capture something else</Button>}>
          Gust didn&apos;t find anything actionable. Try again with a little more detail.
        </EmptyState>
      ) : null}
      <ExtractedTaskList tasks={tasks} onApprove={controller.review.approve} onDiscard={controller.review.discard} onOpen={controller.state.setEditTask} />
      {olderPendingCount > 0 ? (
        <button type="button" onClick={onOpenReview} className="flex w-full items-center gap-3 rounded-card bg-chip-amber/70 px-4 py-3 text-left font-body text-sm font-semibold text-chip-amber-ink outline-none transition-transform active:scale-[0.99]">
          <Inbox className="h-4 w-4 shrink-0" strokeWidth={2.2} />
          <span className="flex-1">{olderPendingCount} more {olderPendingCount === 1 ? 'task' : 'tasks'} from earlier captures</span>
          <ArrowRight className="h-4 w-4" strokeWidth={2.4} />
        </button>
      ) : null}
    </div>
  )
}

const HEADERS: Record<CapturePhase, { eyebrow: string; title: string }> = {
  compose: { eyebrow: 'New capture', title: "What's on your mind?" },
  recording: { eyebrow: 'Listening', title: 'Go ahead, I’m all ears' },
  processing: { eyebrow: 'Working', title: 'Finding your tasks' },
  review: { eyebrow: 'Review', title: 'Newly extracted tasks' },
}

function useLaunchMode({ open, launchMode, controller, onConsumeLaunchMode }: { open: boolean; launchMode: CaptureLaunchMode | null; controller: CaptureController; onConsumeLaunchMode: () => void }) {
  const controllerRef = useRef(controller)
  controllerRef.current = controller
  useEffect(() => {
    if (!open || !launchMode) return
    onConsumeLaunchMode()
    const current = controllerRef.current
    if (launchMode === 'type') { current.state.setTextExpanded(true); return }
    if (current.recorder.isRecording || current.mutations.voice.isPending || current.mutations.text.isPending) return
    // A failed capture is still on screen: show it (with Retry) instead of starting over and dropping the retry audio.
    if (current.state.transcriptionError || (current.mutations.text.isError && current.state.textCaptureError)) return
    current.state.setTextExpanded(false)
    void current.startRecording()
  }, [launchMode, onConsumeLaunchMode, open])
}

/** When extraction finishes or fails after the sheet was swiped away, offer a one-tap path back. */
function useBackgroundCompletionNotice(open: boolean, phase: CapturePhase, count: number, failed: boolean, onReopen: () => void) {
  const { showNotification } = useNotifications()
  const previousPhase = useRef(phase)
  useEffect(() => {
    const wasProcessing = previousPhase.current === 'processing'
    previousPhase.current = phase
    if (open || !wasProcessing) return
    if (phase === 'review') {
      showNotification({ type: 'success', message: count > 0 ? `${count} ${count === 1 ? 'task is' : 'tasks are'} ready to review.` : 'Capture finished.', actionLabel: 'Review', onAction: onReopen })
    } else if (phase === 'compose' && failed) {
      showNotification({ type: 'error', message: 'Your capture could not be processed.', actionLabel: 'Open', onAction: onReopen })
    }
  }, [count, failed, onReopen, open, phase, showNotification])
}

/** The sheet blocks swipe and close while recording, but the back gesture can still hide it; never leave the mic on unseen. */
function useStopRecordingWhenHidden(open: boolean, controller: CaptureController) {
  const recorderRef = useRef(controller.recorder)
  recorderRef.current = controller.recorder
  useEffect(() => {
    // Submits rather than discards, so a long note is not lost; the background notice above reports the result.
    if (!open && recorderRef.current.isRecording) recorderRef.current.stop()
  }, [open])
}

export function CaptureSheet({ controller, open, launchMode, onConsumeLaunchMode, onClose, onReopen, onOpenReview }: {
  controller: CaptureController
  open: boolean
  launchMode: CaptureLaunchMode | null
  onConsumeLaunchMode: () => void
  onClose: () => void
  onReopen: () => void
  onOpenReview: () => void
}) {
  const phase = capturePhase(controller)
  const { queries, review } = controller
  const reviewTasks = queries.extractedTasks.filter((task) => task.status === 'pending')
  const bulk = useBulkAction()
  useLaunchMode({ open, launchMode, controller, onConsumeLaunchMode })
  const captureFailed = Boolean(controller.state.transcriptionError || (controller.mutations.text.isError && controller.state.textCaptureError))
  useBackgroundCompletionNotice(open, phase, reviewTasks.length, captureFailed, onReopen)
  useStopRecordingWhenHidden(open, controller)

  const header = HEADERS[phase]
  const reviewTitle = reviewTasks.length > 0 ? `${reviewTasks.length} new ${reviewTasks.length === 1 ? 'task' : 'tasks'}` : header.title
  const isReviewLoading = queries.extracted.isLoading || queries.extracted.isFetching

  async function finishReview() {
    await controller.completeReview()
    onClose()
  }

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      dismissible={phase !== 'recording'}
      labelledBy="capture-sheet-title"
      header={(
        <SheetHeader
          eyebrow={header.eyebrow}
          title={phase === 'review' ? reviewTitle : header.title}
          titleId="capture-sheet-title"
          centered
          onClose={phase === 'recording' ? undefined : onClose}
          closeLabel="Close capture"
          actions={phase === 'review' ? <Button variant="soft" size="sm" onClick={() => void finishReview()}>Done</Button> : undefined}
        />
      )}
      footer={phase === 'review' && reviewTasks.length > 0 ? (
        <BulkReviewFooter
          count={reviewTasks.length}
          running={bulk.running}
          onApproveAll={() => void bulk.run('approve', review.approveAll)}
          onDiscardAll={() => void bulk.run('discard', review.discardAll)}
        />
      ) : undefined}
      bodyClassName="overflow-y-auto px-5 pb-6 pt-1"
    >
      {phase === 'compose' ? <ComposeView controller={controller} /> : null}
      {phase === 'recording' ? <RecordingView controller={controller} /> : null}
      {phase === 'processing' ? <ProcessingView isVoice={controller.mutations.voice.isPending} /> : null}
      {phase === 'review' ? <ReviewView controller={controller} tasks={reviewTasks} handledCount={queries.extractedTasks.length - reviewTasks.length} isLoading={isReviewLoading} olderPendingCount={queries.visiblePending.length} onOpenReview={onOpenReview} onFinish={() => void finishReview()} /> : null}
    </BottomSheet>
  )
}
