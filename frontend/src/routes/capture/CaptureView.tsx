import { Link } from 'react-router-dom'
import { useState } from 'react'

import { AtmosphericWaveBackdrop } from '../../components/AtmosphericWaveBackdrop'
import { EditExtractedTaskModal } from '../../components/EditExtractedTaskModal'
import { ExtractingLoader } from '../../components/ExtractingLoader'
import { SaveConfirmationToast } from '../../components/SaveConfirmationToast'
import { SessionRequiredCard } from '../../components/SessionRequiredCard'
import { StagingTable } from '../../components/StagingTable'
import type { ExtractedTask, GroupSummary, SubmitCaptureResponse } from '../../lib/api'
import type { CaptureErrorState } from './captureModel'

export function CaptureSessionLoading() {
  return <section className="space-y-6" aria-busy="true"><div className="space-y-3"><p className="font-body text-sm uppercase tracking-[0.25em] text-on-surface-variant">Session check</p><h2 className="font-display text-3xl text-on-surface">Capture</h2><p className="max-w-sm font-body text-base leading-7 text-on-surface-variant">Verifying your session before starting capture.</p></div></section>
}

export function CaptureSessionRequired() {
  return <section className="space-y-6"><div className="space-y-3"><p className="font-body text-sm uppercase tracking-[0.25em] text-on-surface-variant">Voice-first launch</p><h2 className="font-display text-3xl text-on-surface">Capture</h2><p className="max-w-sm font-body text-base leading-7 text-on-surface-variant">Sign in to record, review, and extract tasks safely through the backend session.</p></div><SessionRequiredCard /></section>
}

function PenIcon({ className }: { className?: string }) {
  return (
    <svg
      className={className}
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={1.8}
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
    >
      <path d="M12 20h9" />
      <path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4Z" />
    </svg>
  )
}

type VoiceCardProps = {
  isRecording: boolean
  isBusy: boolean
  isTranscribing: boolean
  permissionError: string | null
  transcriptionError: CaptureErrorState | null
  canRetry: boolean
  onToggle: () => void
  onRetry: () => void
  onDismissError: () => void
}

export function VoiceCaptureCard(props: VoiceCardProps) {
  if (props.isTranscribing) return <ExtractingLoader variant="voice" />
  return (
    <div className="relative overflow-visible py-2 text-center">
      <div className="relative z-10 space-y-5">
        {props.isRecording ? (
          <div className="inline-flex items-center gap-2 py-1.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-rose-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-rose-500" />
            </span>
            <p className="font-body text-sm font-medium tracking-wide text-rose-200">
              Recording...
            </p>
          </div>
        ) : (
          <p className="font-body text-sm font-medium tracking-wide text-zinc-300/90">
            Tap to record
          </p>
        )}
        <div className="relative flex items-center justify-center">
          <AtmosphericWaveBackdrop mode={props.isRecording ? 'recording' : 'idle'} />
          <RecordButton
            isRecording={props.isRecording}
            disabled={props.isBusy && !props.isRecording}
            onClick={props.onToggle}
          />
        </div>
        <CaptureErrors
          permissionError={props.permissionError}
          transcriptionError={props.transcriptionError}
          canRetry={props.canRetry}
          onRetry={props.onRetry}
          onDismissError={props.onDismissError}
        />
      </div>
    </div>
  )
}

function RecordButton({ isRecording, disabled, onClick }: { isRecording: boolean; disabled: boolean; onClick: () => void }) {
  const classes = isRecording
    ? 'bg-[radial-gradient(circle_at_42%_32%,_#fda4af_0%,_#f43f5e_30%,_#e11d48_60%,_#9f1239_85%,_#881337_100%)] text-white shadow-[0_0_60px_rgba(244,63,94,0.7),_0_0_110px_rgba(225,29,72,0.4),_inset_0_1.5px_2px_rgba(255,255,255,0.8),_inset_0_-2px_6px_rgba(0,0,0,0.35)] border border-rose-300/40 animate-pulse'
    : 'bg-[radial-gradient(circle_at_42%_32%,_#d8b4fe_0%,_#a855f7_30%,_#8b5cf6_60%,_#6d28d9_85%,_#4c1d95_100%)] text-white shadow-[0_0_50px_rgba(168,85,247,0.6),_0_0_95px_rgba(139,92,246,0.3),_inset_0_1.5px_2px_rgba(255,255,255,0.7),_inset_0_-2px_6px_rgba(0,0,0,0.35)] border border-purple-300/30 hover:scale-105 active:scale-95'

  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`group relative z-10 mx-auto flex h-44 w-44 items-center justify-center rounded-full transition-all duration-300 outline-none select-none ${classes}`}
      aria-label={isRecording ? 'Stop recording' : 'Start recording'}
    >
      {isRecording ? (
        <svg className="h-14 w-14 text-white/95 drop-shadow-[0_2px_6px_rgba(0,0,0,0.4)]" fill="currentColor" viewBox="0 0 24 24">
          <rect x="6" y="6" width="12" height="12" rx="3" />
        </svg>
      ) : (
        <svg
          className="h-16 w-16 text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.3)] transition-transform duration-200 group-hover:scale-105"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth={1.8}
          strokeLinecap="round"
          strokeLinejoin="round"
        >
          <rect x="9" y="2" width="6" height="11" rx="3" />
          <path d="M5 10a7 7 0 0 0 14 0" />
          <line x1="12" y1="17" x2="12" y2="21" />
          <line x1="8" y1="21" x2="16" y2="21" />
        </svg>
      )}
    </button>
  )
}

type CaptureErrorsProps = {
  permissionError: string | null
  transcriptionError: CaptureErrorState | null
  canRetry: boolean
  onRetry: () => void
  onDismissError: () => void
}

function CaptureErrors(props: CaptureErrorsProps) {
  return <div className="space-y-2">{props.permissionError ? <div className="mx-auto max-w-xl rounded-card bg-[rgba(118,58,11,0.96)] px-4 py-3 text-left"><p className="font-body text-sm leading-6 text-amber-50/95">{props.permissionError}</p></div> : null}{props.transcriptionError ? <TranscriptionError error={props.transcriptionError} canRetry={props.canRetry} onRetry={props.onRetry} onDismiss={props.onDismissError} /> : null}</div>
}

function TranscriptionError({ error, canRetry, onRetry, onDismiss }: { error: CaptureErrorState; canRetry: boolean; onRetry: () => void; onDismiss: () => void }) {
  return <div className="space-y-3 rounded-card bg-[rgba(110,22,38,0.96)] px-4 py-3 text-left"><p className="font-body text-sm leading-6 text-red-50/95">{error.message}</p>{error.requestId ? <p className="font-body text-xs text-red-100/75">Support ID: {error.requestId}</p> : null}<div className="flex flex-wrap gap-2">{error.canRetry && canRetry ? <button type="button" onClick={onRetry} className="rounded-pill bg-red-100 px-3 py-1.5 text-sm font-semibold text-red-900">Retry Same Recording</button> : null}<button type="button" onClick={onDismiss} className="rounded-pill bg-black/25 px-3 py-1.5 text-sm text-red-100/95">Dismiss</button></div></div>
}

type TextPanelProps = { expanded: boolean; draft: string; error: string | null; isPending: boolean; onExpanded: (value: boolean) => void; onDraft: (value: string) => void; onSubmit: () => void }

export function TextCapturePanel(props: TextPanelProps) {
  if (!props.expanded) {
    return (
      <button
        type="button"
        onClick={() => props.onExpanded(true)}
        className="group flex w-full items-center justify-between rounded-2xl border border-purple-500/20 bg-[#0e0a1c]/70 px-5 py-4 text-purple-300 shadow-[0_8px_24px_rgba(0,0,0,0.4)] backdrop-blur-md transition-all duration-200 hover:border-purple-500/30 hover:bg-[#130d26]/80 active:scale-[0.99]"
      >
        <div className="flex items-center gap-2.5">
          <PenIcon className="h-5 w-5 text-purple-400" />
          <p className="font-display text-base font-medium tracking-wide text-purple-300">Write it instead</p>
        </div>
        <span className="font-body text-sm font-medium text-purple-300/50 transition-colors group-hover:text-purple-200">Expand</span>
      </button>
    )
  }

  return (
    <div className="rounded-2xl border border-purple-500/20 bg-[#0e0a1c]/70 px-5 pt-4 pb-5 shadow-[0_12px_32px_rgba(0,0,0,0.5),_0_0_20px_rgba(139,92,246,0.06)] backdrop-blur-md">
      <div className="flex items-center justify-between">
        <div className="flex items-center gap-2.5">
          <PenIcon className="h-5 w-5 text-purple-400" />
          <p className="font-display text-base font-medium tracking-wide text-purple-300">Write it instead</p>
        </div>
        <button
          type="button"
          onClick={() => props.onExpanded(false)}
          className="font-body text-sm font-medium text-purple-300/50 transition-colors hover:text-purple-200"
          aria-label="Collapse text input"
        >
          Hide
        </button>
      </div>

      <div className="mt-3.5">
        <textarea
          value={props.draft}
          onChange={(event) => props.onDraft(event.target.value)}
          rows={5}
          placeholder="Type or paste here..."
          className="w-full resize-none rounded-xl border border-purple-500/15 bg-black/40 p-4 font-body text-sm text-purple-100 placeholder-purple-300/30 outline-none transition-colors focus:border-purple-500/35 focus:ring-1 focus:ring-purple-500/20"
        />
      </div>

      {props.error ? (
        <p className="mt-2.5 rounded-xl bg-[rgba(80,18,18,0.92)] px-3 py-2 text-sm text-red-100">{props.error}</p>
      ) : null}

      <div className="mt-3.5 flex justify-end">
        <button
          type="button"
          onClick={props.onSubmit}
          disabled={props.isPending || !props.draft.trim()}
          className="rounded-full border border-purple-500/15 bg-[#1a1330]/80 px-5 py-2 font-body text-sm font-medium text-purple-200/60 shadow-sm transition-all duration-200 hover:bg-[#251b45] hover:text-purple-100 disabled:opacity-40 disabled:hover:bg-[#1a1330]/80 disabled:hover:text-purple-200/60"
        >
          {props.isPending ? 'Preparing...' : 'Review Text Capture'}
        </button>
      </div>
    </div>
  )
}

export function CaptureSummary({ summary, onReset }: { summary: SubmitCaptureResponse | null; onReset: () => void }) {
  if (!summary) return null
  return <div className="space-y-3 rounded-card bg-[rgba(22,22,22,0.94)] p-4"><h3 className="font-display text-xl text-on-surface">{summary.zero_actionable ? 'No actionable tasks found' : 'Capture completed'}</h3><div className="grid grid-cols-3 gap-2"><SummaryMetric label="Created" value={summary.tasks_created_count} /><SummaryMetric label="Review" value={summary.tasks_flagged_for_review_count} /><SummaryMetric label="Skipped" value={summary.tasks_skipped_count} /></div>{summary.skipped_items.length ? <ul className="space-y-1 rounded-card bg-surface-dim p-3">{summary.skipped_items.map((item, index) => <li key={`${item.code}-${index}`} className="text-xs text-on-surface">{(item.title ? `${item.title}: ` : '') + item.message}</li>)}</ul> : null}<div className="flex gap-2"><button type="button" onClick={onReset} className="rounded-pill bg-primary px-3 py-1.5 text-sm text-surface">Start Another Capture</button><Link to="/tasks" className="rounded-pill border border-outline px-3 py-1.5 text-sm text-on-surface-variant">View Tasks</Link></div></div>
}

function SummaryMetric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-card bg-surface-dim px-4 py-4 text-center"><p className="font-display text-2xl text-on-surface">{value}</p><p className="text-xs uppercase text-on-surface-variant">{label}</p></div>
}

type StagingProps = { tasks: ExtractedTask[]; isLoading: boolean; title: string; subtext?: string; onApprove: (id: string) => Promise<void>; onDiscard: (id: string) => Promise<void>; onApproveAll: () => Promise<void>; onDiscardAll: () => Promise<void>; onTaskClick: (task: ExtractedTask) => void; processing?: boolean; onDone?: () => void }

export function CaptureStaging(props: StagingProps) {
  if (props.processing) return <div className="mt-4"><ExtractingLoader variant="tasks" /></div>
  return <div className="mt-4 space-y-4"><StagingTable tasks={props.tasks} isLoading={props.isLoading} title={props.title} subtext={props.subtext} onApprove={props.onApprove} onDiscard={props.onDiscard} onApproveAll={props.onApproveAll} onDiscardAll={props.onDiscardAll} onTaskClick={props.onTaskClick} emptyMessage="No newly captured tasks to review" />{props.onDone ? <div className="flex justify-end"><button type="button" onClick={props.onDone} className="rounded-pill border border-outline px-3 py-1.5 text-sm text-on-surface-variant">Done</button></div> : null}</div>
}

export function CaptureEditModal({ task, groups, csrfToken, onClose, onSave }: { task: ExtractedTask | null; groups: GroupSummary[]; csrfToken: string | null; onClose: () => void; onSave: () => Promise<void> }) {
  const [saveNotice, setSaveNotice] = useState<string | null>(null)

  return <>
    {task && csrfToken ? <EditExtractedTaskModal task={task} groups={groups} isOpen onClose={onClose} onSave={onSave} onSaved={() => setSaveNotice('Changes saved')} csrfToken={csrfToken} /> : null}
    <SaveConfirmationToast message={saveNotice} onDismiss={() => setSaveNotice(null)} />
  </>
}
