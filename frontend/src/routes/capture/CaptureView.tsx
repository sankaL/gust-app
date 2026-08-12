import { Link } from 'react-router-dom'

import { EditExtractedTaskModal } from '../../components/EditExtractedTaskModal'
import { ExtractingLoader } from '../../components/ExtractingLoader'
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
  return <div className="rounded-soft bg-[radial-gradient(circle_at_top,_rgba(186,158,255,0.24),_rgba(16,16,16,0.94)_58%)] px-4 py-5 shadow-ambient"><div className="space-y-6 text-center"><p className="font-body text-sm font-medium text-on-surface">{props.isRecording ? 'Recording...' : 'Tap to record'}</p><RecordButton isRecording={props.isRecording} disabled={props.isBusy && !props.isRecording} onClick={props.onToggle} /><CaptureErrors permissionError={props.permissionError} transcriptionError={props.transcriptionError} canRetry={props.canRetry} onRetry={props.onRetry} onDismissError={props.onDismissError} /></div></div>
}

function RecordButton({ isRecording, disabled, onClick }: { isRecording: boolean; disabled: boolean; onClick: () => void }) {
  const classes = isRecording
    ? 'translate-y-[8px] bg-[radial-gradient(circle_at_top,_#fb7185_10%,_#be123c_90%)] text-white shadow-[inset_0_6px_12px_rgba(0,0,0,0.4),_0_2px_4px_rgba(0,0,0,0.4)]'
    : 'bg-[radial-gradient(circle_at_top,_#c4b5fd_10%,_#7c3aed_90%)] text-white shadow-[0_8px_0_#4c1d95,_0_15px_20px_rgba(0,0,0,0.4),_inset_0_2px_3px_rgba(255,255,255,0.6)] hover:-translate-y-[2px] active:translate-y-[8px]'
  return <button type="button" onClick={onClick} disabled={disabled} className={`group relative mx-auto flex h-36 w-36 items-center justify-center rounded-full transition-all duration-200 outline-none select-none ${classes}`} aria-label={isRecording ? 'Stop recording' : 'Start recording'}>{isRecording ? <svg className="h-10 w-10 animate-pulse text-white/90" fill="currentColor" viewBox="0 0 24 24"><rect x="6" y="6" width="12" height="12" rx="2" /></svg> : <svg className="h-14 w-14 text-white/95" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={1.5} d="M19 11a7 7 0 01-7 7m0 0a7 7 0 01-7-7m7 7v4m0 0H8m4 0h4m-4-8a3 3 0 01-3-3V5a3 3 0 116 0v6a3 3 0 01-3 3z" /></svg>}</button>
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
  if (!props.expanded) return <button type="button" onClick={() => props.onExpanded(true)} className="group relative flex w-full items-center justify-between rounded-card bg-[radial-gradient(circle_at_top_left,_#5b21b6_0%,_#2e1065_100%)] px-5 py-4 text-white shadow-[0_6px_0_#171033]"><p className="font-display text-base font-medium tracking-wide">Write it instead</p><span className="font-body text-sm text-white/60">Expand</span></button>
  return <div className="space-y-4 rounded-card bg-[radial-gradient(circle_at_top_left,_#5b21b6_0%,_#2e1065_100%)] px-5 py-4 text-white"><div className="flex items-center justify-between"><p className="font-display text-base font-medium tracking-wide">Write it instead</p><button onClick={() => props.onExpanded(false)} className="rounded-full px-3 py-1.5 text-sm text-white/70" aria-label="Collapse text input">Hide</button></div><textarea value={props.draft} onChange={(event) => props.onDraft(event.target.value)} rows={5} placeholder="Type or paste here..." className="w-full resize-none rounded-card bg-black/40 px-4 py-3 font-body text-sm text-white outline-none" />{props.error ? <p className="rounded-card bg-[rgba(80,18,18,0.92)] px-3 py-2 text-sm text-red-100">{props.error}</p> : null}<div className="flex justify-end"><button type="button" onClick={props.onSubmit} disabled={props.isPending || !props.draft.trim()} className="rounded-pill bg-white/10 px-5 py-2 text-sm font-semibold disabled:opacity-50">{props.isPending ? 'Preparing...' : 'Review Text Capture'}</button></div></div>
}

export function CaptureSummary({ summary, onReset }: { summary: SubmitCaptureResponse | null; onReset: () => void }) {
  if (!summary) return null
  return <div className="space-y-3 rounded-card bg-[rgba(22,22,22,0.94)] p-4"><h3 className="font-display text-xl text-on-surface">{summary.zero_actionable ? 'No actionable tasks found' : 'Capture completed'}</h3><div className="grid grid-cols-3 gap-2"><SummaryMetric label="Created" value={summary.tasks_created_count} /><SummaryMetric label="Review" value={summary.tasks_flagged_for_review_count} /><SummaryMetric label="Skipped" value={summary.tasks_skipped_count} /></div>{summary.skipped_items.length ? <ul className="space-y-1 rounded-card bg-surface-dim p-3">{summary.skipped_items.map((item, index) => <li key={`${item.code}-${index}`} className="text-xs text-on-surface">{(item.title ? `${item.title}: ` : '') + item.message}</li>)}</ul> : null}<div className="flex gap-2"><button type="button" onClick={onReset} className="rounded-pill bg-primary px-3 py-1.5 text-sm text-surface">Start Another Capture</button><Link to="/tasks" className="rounded-pill border border-outline px-3 py-1.5 text-sm text-on-surface-variant">View Tasks</Link></div></div>
}

function SummaryMetric({ label, value }: { label: string; value: number }) {
  return <div className="rounded-card bg-surface-dim px-4 py-4 text-center"><p className="font-display text-2xl text-on-surface">{value}</p><p className="text-xs uppercase text-on-surface-variant">{label}</p></div>
}

type StagingProps = { tasks: ExtractedTask[]; isLoading: boolean; title: string; subtext: string; onApprove: (id: string) => Promise<void>; onDiscard: (id: string) => Promise<void>; onApproveAll: () => Promise<void>; onDiscardAll: () => Promise<void>; onTaskClick: (task: ExtractedTask) => void; processing?: boolean; onDone?: () => void }

export function CaptureStaging(props: StagingProps) {
  if (props.processing) return <div className="mt-4"><ExtractingLoader variant="tasks" /></div>
  return <div className="mt-4 space-y-4"><StagingTable tasks={props.tasks} isLoading={props.isLoading} title={props.title} subtext={props.subtext} onApprove={props.onApprove} onDiscard={props.onDiscard} onApproveAll={props.onApproveAll} onDiscardAll={props.onDiscardAll} onTaskClick={props.onTaskClick} emptyMessage="No newly captured tasks to review" />{props.onDone ? <div className="flex justify-end"><button type="button" onClick={props.onDone} className="rounded-pill border border-outline px-3 py-1.5 text-sm text-on-surface-variant">Done</button></div> : null}</div>
}

export function CaptureEditModal({ task, groups, csrfToken, onClose, onSave }: { task: ExtractedTask | null; groups: GroupSummary[]; csrfToken: string | null; onClose: () => void; onSave: () => Promise<void> }) {
  if (!task || !csrfToken) return null
  return <EditExtractedTaskModal task={task} groups={groups} isOpen onClose={onClose} onSave={onSave} csrfToken={csrfToken} />
}
