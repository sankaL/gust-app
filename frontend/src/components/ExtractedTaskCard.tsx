import { useState } from 'react'
import { AlertTriangle, CalendarDays, Folder, ListChecks, Repeat2, X } from 'lucide-react'

import type { ExtractedTask } from '../lib/api'
import { formatRecurrence, formatShortDate } from '../lib/taskFormatters'
import { CheckCircle, Chip } from './ui/controls'
import { chipClass, groupTone } from './ui/chipStyles'

type Props = {
  task: ExtractedTask
  onApprove: (taskId: string) => Promise<void>
  onDiscard: (taskId: string) => Promise<void>
  onClick: (task: ExtractedTask) => void
  variant?: 'mobile' | 'desktop'
}

type ViewProps = {
  task: ExtractedTask
  isApproving: boolean
  isDiscarding: boolean
  onOpen: () => void
  onApprove: (event: React.MouseEvent) => void
  onDiscard: (event: React.MouseEvent) => void
}

export function ExtractedTaskCard({ task, onApprove, onDiscard, onClick, variant = 'mobile' }: Props) {
  const [pendingAction, setPendingAction] = useState<'approve' | 'discard' | null>(null)
  async function runAction(event: React.MouseEvent, action: 'approve' | 'discard') {
    event.stopPropagation()
    setPendingAction(action)
    try {
      await (action === 'approve' ? onApprove : onDiscard)(task.id)
    } finally {
      setPendingAction(null)
    }
  }
  const viewProps: ViewProps = {
    task,
    isApproving: pendingAction === 'approve',
    isDiscarding: pendingAction === 'discard',
    onOpen: () => onClick(task),
    onApprove: (event) => { void runAction(event, 'approve') },
    onDiscard: (event) => { void runAction(event, 'discard') },
  }
  return variant === 'desktop' ? <DesktopCard {...viewProps} /> : <MobileCard {...viewProps} />
}

function DesktopCard(props: ViewProps) {
  return (
    <article onClick={props.onOpen} className="group flex cursor-pointer items-center justify-between gap-4 rounded-soft bg-surface-container p-3.5 transition-all hover:-translate-y-[1px] hover:bg-surface-container-high hover:shadow-ambient active:translate-y-0">
      <div className="min-w-0 flex-1 space-y-2">
        <h3 className="truncate font-display text-[0.95rem] font-medium leading-tight text-on-surface transition-colors group-hover:text-primary">{props.task.title}</h3>
        <TaskBadges task={props.task} compact />
      </div>
      <TaskActions {...props} desktop />
    </article>
  )
}

function MobileCard(props: ViewProps) {
  const { task } = props
  const busy = props.isApproving || props.isDiscarding
  const recurrence = task.recurrence_frequency && task.recurrence_frequency !== 'none' ? task.recurrence_frequency : null
  const subtaskCount = task.subtask_titles.length
  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    props.onOpen()
  }
  return (
    <article
      role="button"
      tabIndex={0}
      onClick={props.onOpen}
      onKeyDown={handleKeyDown}
      aria-busy={busy || undefined}
      className={`group relative cursor-pointer rounded-[1.35rem] bg-surface-container-high p-4 text-left shadow-card outline-none ring-1 ring-inset ring-outline/40 transition-all duration-300 ease-out-expo hover:-translate-y-px focus-visible:ring-2 focus-visible:ring-primary/60 active:scale-[0.99] ${busy ? 'opacity-60' : ''}`}
    >
      <div className="flex items-start gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="line-clamp-2 font-display text-[1.02rem] font-bold leading-snug tracking-[-0.01em] text-on-surface">{task.title}</h3>
          {task.description ? <p className="mt-1 line-clamp-2 font-body text-[0.83rem] leading-5 text-on-surface-variant">{task.description}</p> : null}
        </div>
        <TaskActions {...props} />
      </div>
      <div className="mt-3 flex flex-wrap items-center gap-1.5">
        <Chip tone={groupTone(task.group_name)} icon={Folder}>{task.group_name || 'Inbox'}</Chip>
        {task.due_date ? <Chip tone={isPastDate(task.due_date) ? 'rose' : 'neutral'} icon={CalendarDays}>{formatShortDate(task.due_date)}</Chip> : null}
        {recurrence ? <Chip icon={Repeat2} title={`Recurring: ${recurrence}`}>{formatRecurrence(recurrence)}</Chip> : null}
        {subtaskCount > 0 ? <Chip icon={ListChecks} title={`${subtaskCount} subtasks`}>{subtaskCount}</Chip> : null}
        {task.needs_review ? <NeedsReview /> : null}
        <ConfidenceBadge confidence={task.top_confidence} />
      </div>
    </article>
  )
}

function isPastDate(dueDate: string) {
  const today = new Date()
  const todayIso = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}-${String(today.getDate()).padStart(2, '0')}`
  return dueDate < todayIso
}

function TaskBadges({ task, compact = false }: { task: ExtractedTask; compact?: boolean }) {
  const recurrence = task.recurrence_frequency && task.recurrence_frequency !== 'none' ? task.recurrence_frequency : null
  const details = `${task.group_name || 'Inbox'} · Due: ${formatDueDate(task.due_date)} · ${recurrence ? recurrence.toUpperCase() : 'One-off'}`
  return (
    <div className={compact ? 'flex flex-wrap items-center gap-1.5' : 'flex min-w-0 flex-1 items-center gap-1 text-[0.58rem] uppercase tracking-[0.1em]'}>
      {compact && task.needs_review ? <NeedsReview /> : null}
      {compact ? <ConfidenceBadge confidence={task.top_confidence} /> : null}
      <span className="max-w-[42%] shrink truncate rounded-pill bg-chip-neutral px-2 py-0.5 text-chip-neutral-ink">{task.group_name || 'Inbox'}</span>
      {task.due_date || !compact ? <span className={`shrink-0 whitespace-nowrap rounded-pill bg-chip-neutral px-2 py-0.5 font-bold ${dueDateColor(task.due_date)}`}>Due: {formatDueDate(task.due_date)}</span> : null}
      {!compact && <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-chip-neutral font-body text-sm leading-none text-on-surface-variant" title={details} aria-label={`More task details: ${details}`}>…</span>}
      {compact && <span className="recurrence-badge shrink-0" title={recurrence ? `Recurring: ${recurrence}` : 'No recurrence'}>{recurrence ? recurrence.toUpperCase() : 'ONE-OFF'}</span>}
    </div>
  )
}

function TaskActions(props: ViewProps & { desktop?: boolean }) {
  const disabled = props.isApproving || props.isDiscarding
  return (
    <div className="flex shrink-0 items-center gap-2" onClick={(event) => event.stopPropagation()}>
      <button
        type="button"
        onClick={props.onDiscard}
        disabled={disabled}
        aria-label="Discard"
        title="Discard"
        className="flex h-9 w-9 items-center justify-center rounded-full text-on-surface-variant outline-none ring-2 ring-inset ring-on-surface-variant/20 transition-all duration-200 hover:bg-chip-rose hover:text-chip-rose-ink hover:ring-transparent focus-visible:ring-primary/60 active:scale-90 disabled:opacity-45"
      >
        {props.isDiscarding ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" /> : <X className="h-[1.1rem] w-[1.1rem]" strokeWidth={2.4} />}
      </button>
      <CheckCircle mode="action" size="lg" label="Approve" checked={false} pending={props.isApproving} disabled={disabled} onClick={props.onApprove} />
    </div>
  )
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const label = confidence >= 0.8 ? 'High' : confidence >= 0.7 ? 'Medium' : 'Low'
  const color = confidence >= 0.8 ? 'bg-success' : confidence >= 0.7 ? 'bg-warning' : 'bg-tertiary'
  return (
    <span className={chipClass('neutral')} title={`Confidence Score: ${label}`}>
      <span aria-hidden="true" className={`h-1.5 w-1.5 rounded-full ${color}`} />
      <span>{label}</span>
    </span>
  )
}

function NeedsReview() {
  return <Chip tone="amber" icon={AlertTriangle}>Needs Review</Chip>
}

function formatDueDate(dueDate: string | null): string {
  return dueDate ? new Date(`${dueDate}T00:00:00`).toLocaleDateString() : '--'
}

function dueDateColor(dueDate: string | null): string {
  if (!dueDate) return 'text-on-surface-variant/50'
  const today = new Date()
  const due = new Date(`${dueDate}T00:00:00`)
  const difference = Date.UTC(due.getFullYear(), due.getMonth(), due.getDate()) - Date.UTC(today.getFullYear(), today.getMonth(), today.getDate())
  return difference < 0 ? 'text-error' : difference === 0 ? 'text-warning' : 'text-primary'
}
