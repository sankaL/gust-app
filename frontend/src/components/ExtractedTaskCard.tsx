import { useState } from 'react'
import { CheckCircle2, Trash2 } from 'lucide-react'

import type { ExtractedTask } from '../lib/api'
import { Card } from './Card'

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
  return (
    <Card interactive onClick={props.onOpen} className="bg-surface-container-high">
      <div className="space-y-3">
        <div className="flex items-start justify-between gap-3">
          <h3 className="line-clamp-2 min-w-0 flex-1 font-display text-base font-medium leading-tight text-on-surface">{props.task.title}</h3>
          <ConfidenceBadge confidence={props.task.top_confidence} />
        </div>
        {props.task.description ? <p className="line-clamp-2 text-[0.78rem] leading-5 text-on-surface-variant">{props.task.description}</p> : null}
        {props.task.needs_review ? <NeedsReview /> : null}
        <div className="flex items-end justify-between gap-3">
          <TaskBadges task={props.task} />
          <TaskActions {...props} />
        </div>
      </div>
    </Card>
  )
}

function TaskBadges({ task, compact = false }: { task: ExtractedTask; compact?: boolean }) {
  const recurrence = task.recurrence_frequency && task.recurrence_frequency !== 'none' ? task.recurrence_frequency : null
  return (
    <div className={compact ? 'flex flex-wrap items-center gap-1.5' : 'flex min-w-0 flex-1 flex-nowrap items-center gap-1.5 overflow-hidden text-[0.62rem] uppercase tracking-[0.12em]'}>
      {compact && task.needs_review ? <NeedsReview /> : null}
      {compact ? <ConfidenceBadge confidence={task.top_confidence} /> : null}
      <span className="max-w-[44%] shrink truncate rounded-pill bg-black/20 px-2 py-0.5 text-on-surface-variant">{task.group_name || 'Inbox'}</span>
      {task.due_date || !compact ? <span className={`shrink-0 rounded-pill bg-black/20 px-2 py-0.5 font-bold ${dueDateColor(task.due_date)}`}>Due: {formatDueDate(task.due_date)}</span> : null}
      <span className="recurrence-badge shrink-0" title={recurrence ? `Recurring: ${recurrence}` : 'No recurrence'}>{recurrence ? recurrence.toUpperCase() : 'ONE-OFF'}</span>
    </div>
  )
}

function TaskActions(props: ViewProps & { desktop?: boolean }) {
  const disabled = props.isApproving || props.isDiscarding
  const size = props.desktop ? 'h-9 w-9' : 'h-8 w-8'
  return (
    <div className="flex shrink-0 items-center gap-2" onClick={(event) => event.stopPropagation()}>
      <ActionButton label="Approve" className={`${size} text-primary`} pending={props.isApproving} disabled={disabled} onClick={props.onApprove}><CheckCircle2 className="h-5 w-5" strokeWidth={2} /></ActionButton>
      <ActionButton label="Discard" className={`${size} text-tertiary`} pending={props.isDiscarding} disabled={disabled} onClick={props.onDiscard}><Trash2 className="h-4 w-4" strokeWidth={2} /></ActionButton>
    </div>
  )
}

function ActionButton({ label, pending, disabled, onClick, className, children }: { label: string; pending: boolean; disabled: boolean; onClick: (event: React.MouseEvent) => void; className: string; children: React.ReactNode }) {
  return <button type="button" onClick={onClick} disabled={disabled} className={`flex items-center justify-center rounded-full bg-surface-dim transition-all hover:bg-surface-container-highest active:scale-95 disabled:opacity-50 ${className}`} aria-label={label}>{pending ? <span className="h-4 w-4 animate-spin rounded-full border-2 border-current border-r-transparent" /> : children}</button>
}

function ConfidenceBadge({ confidence }: { confidence: number }) {
  const label = confidence >= 0.8 ? 'High' : confidence >= 0.7 ? 'Medium' : 'Low'
  const color = confidence >= 0.8 ? 'text-primary' : confidence >= 0.7 ? 'text-warning' : 'text-tertiary'
  return <span className="shrink-0 rounded-pill bg-black/20 px-2 py-0.5 font-body text-[0.62rem] uppercase tracking-widest text-on-surface-variant" title={`Confidence Score: ${label}`}><span className={color}>●</span> {label}</span>
}

function NeedsReview() {
  return <span className="rounded-pill bg-warning/20 px-2 py-0.5 text-[0.62rem] font-bold uppercase tracking-widest text-warning">Needs Review</span>
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
