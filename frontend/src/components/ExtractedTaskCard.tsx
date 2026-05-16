import { useState } from 'react'
import { ExtractedTask } from '../lib/api'
import { CheckCircle2, Trash2 } from 'lucide-react'
import { Card } from './Card'

const getDueDateColor = (dueDate: string | null): string => {
  if (!dueDate) return 'text-on-surface-variant/50'
  const today = new Date()
  const due = new Date(`${dueDate}T00:00:00`)
  const todayDay = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) / 86400000
  const dueDay = Date.UTC(due.getFullYear(), due.getMonth(), due.getDate()) / 86400000
  const diff = dueDay - todayDay
  if (diff < 0) return 'text-error'
  if (diff === 0) return 'text-warning'
  return 'text-primary'
}

interface ExtractedTaskCardProps {
  task: ExtractedTask
  onApprove: (taskId: string) => Promise<void>
  onDiscard: (taskId: string) => Promise<void>
  onClick: (task: ExtractedTask) => void
  variant?: 'mobile' | 'desktop'
}

export function ExtractedTaskCard({
  task,
  onApprove,
  onDiscard,
  onClick,
  variant = 'mobile'
}: ExtractedTaskCardProps) {
  const [isApproving, setIsApproving] = useState(false)
  const [isDiscarding, setIsDiscarding] = useState(false)

  const clampTwoLines = {
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical' as const,
    WebkitLineClamp: 2,
    overflow: 'hidden'
  }

  const handleApprove = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setIsApproving(true)
    try {
      await onApprove(task.id)
    } finally {
      setIsApproving(false)
    }
  }

  const handleDiscard = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setIsDiscarding(true)
    try {
      await onDiscard(task.id)
    } finally {
      setIsDiscarding(false)
    }
  }

  const handleCardClick = () => {
    onClick(task)
  }

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return 'text-primary'
    if (confidence >= 0.7) return 'text-warning'
    return 'text-tertiary'
  }

  const getConfidenceLabel = (confidence: number) => {
    if (confidence >= 0.8) return 'High'
    if (confidence >= 0.7) return 'Medium'
    return 'Low'
  }

  if (variant === 'desktop') {
    return (
      <article
        onClick={() => onClick(task)}
        className="group flex cursor-pointer items-center justify-between gap-4 rounded-soft bg-surface-container p-3.5 transition-all hover:-translate-y-[1px] hover:bg-surface-container-high hover:shadow-ambient active:translate-y-0"
      >
        <div className="flex min-w-0 flex-1 flex-col justify-center gap-2">
          <h3 className="truncate font-display text-[0.95rem] font-medium leading-tight text-on-surface group-hover:text-primary transition-colors">
            {task.title}
          </h3>

          <div className="flex flex-wrap items-center gap-1.5">
            {task.needs_review ? (
              <span className="rounded-pill bg-warning/20 px-2 py-0.5 font-body text-[0.62rem] font-bold uppercase tracking-widest text-warning">
                Needs Review
              </span>
            ) : null}

            <div
              className="flex items-center gap-1 rounded-pill bg-[rgba(30,30,30,0.5)] px-2 py-0.5"
              title={`Confidence Score: ${getConfidenceLabel(task.top_confidence)}`}
            >
              <span className={`text-[0.55rem] ${getConfidenceColor(task.top_confidence)}`}>●</span>
              <span className="font-body text-[0.62rem] uppercase tracking-widest text-on-surface-variant">
                {getConfidenceLabel(task.top_confidence)}
              </span>
            </div>

            <span className="rounded-pill bg-[rgba(30,30,30,0.5)] px-2 py-0.5 font-body text-[0.62rem] uppercase tracking-widest text-on-surface-variant">
              {task.group_name || 'Inbox'}
            </span>

            {task.due_date ? (
              <span className={`rounded-pill bg-[rgba(30,30,30,0.5)] px-2 py-0.5 font-body text-[0.62rem] font-bold uppercase tracking-widest ${getDueDateColor(task.due_date)}`}>
                Due: {new Date(task.due_date + 'T00:00:00').toLocaleDateString()}
              </span>
            ) : null}

            <span className="rounded-pill bg-[rgba(30,30,30,0.5)] px-2 py-0.5 font-body text-[0.62rem] uppercase tracking-widest text-on-surface-variant">
              {task.recurrence_frequency && task.recurrence_frequency !== 'none'
                ? task.recurrence_frequency
                : 'One-off'}
            </span>
          </div>
        </div>

        <div className="flex shrink-0 items-center gap-2" onClick={(e) => e.stopPropagation()}>
          <button
            onClick={(event) => void handleApprove(event)}
            disabled={isApproving || isDiscarding}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-dim text-primary transition-all hover:scale-105 hover:bg-surface-container-highest active:scale-95 disabled:opacity-50 disabled:hover:scale-100"
            aria-label="Approve"
          >
            {isApproving ? (
              <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <CheckCircle2 className="h-5 w-5" strokeWidth={2} />
            )}
          </button>

          <button
            onClick={(event) => void handleDiscard(event)}
            disabled={isApproving || isDiscarding}
            className="flex h-9 w-9 items-center justify-center rounded-full bg-surface-dim text-tertiary transition-all hover:scale-105 hover:bg-surface-container-highest active:scale-95 disabled:opacity-50 disabled:hover:scale-100"
            aria-label="Discard"
          >
            {isDiscarding ? (
              <svg className="h-4 w-4 animate-spin" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" />
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
              </svg>
            ) : (
              <Trash2 className="h-4.5 w-4.5" strokeWidth={2} />
            )}
          </button>
        </div>
      </article>
    )
  }

  // Mobile Variant (Original)
  return (
    <Card 
      interactive 
      onClick={handleCardClick}
      className="bg-surface-container-high"
    >
      <div className="flex flex-col gap-3">
        <div className="flex items-start justify-between gap-3">
          <h3
            className="min-w-0 flex-1 font-display text-base font-medium leading-tight text-on-surface"
            style={clampTwoLines}
          >
            {task.title}
          </h3>

          <div
            className="flex shrink-0 items-center gap-1 rounded-pill bg-surface-dim px-2 py-0.5 cursor-help"
            title={`Confidence Score: ${getConfidenceLabel(task.top_confidence)}`}
          >
            <span className={`text-[0.65rem] ${getConfidenceColor(task.top_confidence)}`}>●</span>
            <span className="font-body text-[0.65rem] uppercase tracking-widest text-on-surface-variant">
              {getConfidenceLabel(task.top_confidence)}
            </span>
          </div>
        </div>

        {task.description ? (
          <p className="text-[0.78rem] leading-5 text-on-surface-variant" style={clampTwoLines}>
            {task.description}
          </p>
        ) : null}

        {task.needs_review ? (
          <div className="flex items-center gap-2">
            <span className="inline-block rounded-pill bg-warning/20 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-widest text-warning">
              Needs Review
            </span>
          </div>
        ) : null}

        <div className="flex items-end justify-between gap-3">
          <div className="flex min-w-0 flex-1 flex-nowrap items-center gap-1.5 overflow-hidden text-[0.62rem] uppercase tracking-[0.12em] sm:text-[0.64rem]">
            <span className="min-w-0 max-w-[44%] shrink truncate font-medium text-on-surface-variant/85">
              {task.group_name || 'Inbox'}
            </span>
            <span className={`shrink-0 ${getDueDateColor(task.due_date)} font-bold`}>
              Due: {task.due_date ? new Date(task.due_date + 'T00:00:00').toLocaleDateString() : '--'}
            </span>
            <span
              className="recurrence-badge shrink-0"
              title={
                task.recurrence_frequency && task.recurrence_frequency !== 'none'
                  ? `Recurring: ${task.recurrence_frequency}`
                  : 'No recurrence'
              }
            >
              {task.recurrence_frequency && task.recurrence_frequency !== 'none'
                ? task.recurrence_frequency.toUpperCase()
                : 'ONE-OFF'}
            </span>
          </div>

          <div
            className="flex items-center gap-3 shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
              <button
                onClick={(e) => {
                  void handleApprove(e)
                }}
                disabled={isApproving || isDiscarding}
                className="flex items-center justify-center w-8 h-8 rounded-full bg-surface-dim border border-white/10 shadow-[0_4px_12px_rgba(0,0,0,0.5),_inset_0_2px_4px_rgba(255,255,255,0.1)] text-primary hover:bg-surface-container-highest hover:-translate-y-0.5 transition-all duration-200 active:scale-90 active:translate-y-0 disabled:opacity-50 disabled:hover:-translate-y-0 disabled:active:scale-100"
                aria-label="Approve"
              >
                {isApproving ? (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                )}
              </button>
            <button
              onClick={(e) => {
                void handleDiscard(e)
              }}
              disabled={isApproving || isDiscarding}
              className="flex items-center justify-center w-8 h-8 rounded-full bg-surface-dim border border-white/10 shadow-[0_4px_12px_rgba(0,0,0,0.5),_inset_0_2px_4px_rgba(255,255,255,0.1)] text-tertiary hover:bg-surface-container-highest hover:-translate-y-0.5 transition-all duration-200 active:scale-90 active:translate-y-0 disabled:opacity-50 disabled:hover:-translate-y-0 disabled:active:scale-100"
              aria-label="Discard"
            >
              {isDiscarding ? (
                <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
              ) : (
                <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
              )}
            </button>
          </div>
        </div>
      </div>
    </Card>
  )
}
