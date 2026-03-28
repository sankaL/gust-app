import { useRef, useState } from 'react'

import { type TaskSummary } from '../lib/api'
import { Card } from './Card'

type OpenTaskCardProps = {
  task: TaskSummary
  onOpen: (taskId: string) => void
  onPrepareOpen?: (taskId: string) => void
  onComplete: (task: TaskSummary) => void
  onDelete?: (task: TaskSummary) => void
  isBusy: boolean
  enableSwipe?: boolean
}

function buildDueLabel(task: TaskSummary) {
  if (!task.due_date) {
    return '--'
  }

  const today = new Date()
  const due = new Date(`${task.due_date}T00:00:00`)
  const todayDay = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) / 86400000
  const dueDay = Date.UTC(due.getFullYear(), due.getMonth(), due.getDate()) / 86400000
  const diffDays = dueDay - todayDay

  if (diffDays < 0) return 'Overdue'
  if (diffDays === 0) return 'Today'
  if (diffDays === 1) return 'Tomorrow'

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric'
  }).format(due)
}

function buildDueTone(task: TaskSummary) {
  if (!task.due_date) return 'text-on-surface-variant/55'

  const today = new Date()
  const due = new Date(`${task.due_date}T00:00:00`)
  const todayDay = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) / 86400000
  const dueDay = Date.UTC(due.getFullYear(), due.getMonth(), due.getDate()) / 86400000
  const diffDays = dueDay - todayDay

  if (diffDays < 0) return 'text-error'
  if (diffDays === 0) return 'text-warning'
  return 'text-primary'
}

function formatRecurrenceLabel(recurrence: TaskSummary['recurrence_frequency']) {
  return recurrence ? recurrence.toUpperCase() : 'ONE-OFF'
}

function formatReminder(reminderAt: string | null) {
  if (!reminderAt) return 'No reminder'

  return new Date(reminderAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  })
}

function formatSubtaskLabel(subtaskCount: number | undefined) {
  const count = subtaskCount ?? 0
  return `${count} ${count === 1 ? 'subtask' : 'subtasks'}`
}

export function OpenTaskCard({
  task,
  onOpen,
  onPrepareOpen,
  onComplete,
  onDelete,
  isBusy,
  enableSwipe = false
}: OpenTaskCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const [offsetX, setOffsetX] = useState(0)
  const startXRef = useRef<number | null>(null)
  const pointerIdRef = useRef<number | null>(null)
  const offsetRef = useRef(0)
  const suppressClickRef = useRef(false)

  const dueLabel = buildDueLabel(task)
  const dueTone = buildDueTone(task)
  const recurrenceLabel = formatRecurrenceLabel(task.recurrence_frequency ?? null)
  const subtaskLabel = formatSubtaskLabel(task.subtask_count)
  const recurrenceBadgeClass = task.recurrence_frequency
    ? 'bg-[radial-gradient(circle_at_top,_#a855f7_8%,_#7e22ce_55%,_#581c87_100%)] text-white shadow-[0_3px_10px_rgba(126,34,206,0.28),_inset_0_1px_1px_rgba(255,255,255,0.14)]'
    : 'bg-surface-dim text-on-surface-variant/75 shadow-[inset_0_1px_1px_rgba(255,255,255,0.04)]'

  function resetSwipe() {
    startXRef.current = null
    pointerIdRef.current = null
    offsetRef.current = 0
    setOffsetX(0)
  }

  function handlePointerDown(event: React.PointerEvent<HTMLElement>) {
    if (!enableSwipe || isBusy) {
      return
    }

    startXRef.current = event.clientX
    pointerIdRef.current = event.pointerId
  }

  function handlePointerMove(event: React.PointerEvent<HTMLElement>) {
    if (!enableSwipe || startXRef.current === null || pointerIdRef.current !== event.pointerId) {
      return
    }

    const delta = event.clientX - startXRef.current
    const clamped = Math.max(-120, Math.min(120, delta))
    offsetRef.current = clamped
    setOffsetX(clamped)
  }

  function handlePointerEnd() {
    if (!enableSwipe) {
      return
    }

    if (offsetRef.current >= 90) {
      suppressClickRef.current = true
      onComplete(task)
    }

    resetSwipe()
  }

  function handleCardActivate() {
    if (suppressClickRef.current) {
      suppressClickRef.current = false
      return
    }

    if (isExpanded) {
      onOpen(task.id)
      return
    }

    onPrepareOpen?.(task.id)
    setIsExpanded(true)
  }

  return (
    <Card
      padding="none"
      className={`relative overflow-hidden bg-surface-container-high ${!task.due_date ? 'opacity-70' : ''}`}
    >
      {enableSwipe ? (
        <div className="absolute inset-0 flex items-center justify-start px-6 text-[0.65rem] font-bold uppercase tracking-[0.15em] text-on-surface-variant">
          <span>Swipe right to complete</span>
        </div>
      ) : null}

      <div
        role="button"
        tabIndex={0}
        onClick={handleCardActivate}
        onKeyDown={(event) => {
          if (event.key === 'Enter' || event.key === ' ') {
            event.preventDefault()
            handleCardActivate()
          }
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={resetSwipe}
        className="relative z-10 w-full touch-pan-y bg-surface-container-high p-4 text-left transition-transform duration-200"
        style={{ transform: `translateX(${offsetX}px)` }}
      >
        <div className={`flex ${isExpanded ? 'items-stretch gap-3' : 'items-start gap-2'}`}>
          <div className={`min-w-0 flex-1 ${isExpanded ? 'flex flex-col' : ''}`}>
            <div className={`flex ${isExpanded ? 'flex-1 flex-col gap-3' : 'flex-col gap-1.5'}`}>
              <h3
                className={`min-w-0 font-display font-medium leading-tight text-on-surface ${
                  isExpanded ? 'text-base whitespace-normal' : 'truncate pr-2 text-[0.98rem]'
                }`}
                title={!isExpanded ? task.title : undefined}
              >
                {task.title}
              </h3>

              {isExpanded && task.description ? (
                <p className="text-[0.78rem] leading-5 text-on-surface-variant">
                  {task.description}
                </p>
              ) : null}

              {isExpanded && task.needs_review ? (
                <div className="flex items-center gap-2">
                  <span className="inline-block rounded-pill bg-warning/20 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-widest text-warning">
                    Needs Review
                  </span>
                </div>
              ) : null}

              {isExpanded ? (
                <div className="flex min-w-0 flex-nowrap items-center gap-2 overflow-hidden text-[0.66rem] leading-4 text-on-surface-variant sm:text-[0.68rem]">
                  <span className="shrink-0 font-medium text-on-surface-variant/85">{subtaskLabel}</span>
                  <span className="shrink-0 text-on-surface-variant/40">•</span>
                  <span className="min-w-0 truncate text-on-surface-variant/85">
                    Reminder: {formatReminder(task.reminder_at)}
                  </span>
                </div>
              ) : null}

              <div
                className={`flex min-w-0 items-center ${
                  isExpanded
                    ? 'mt-2 flex-nowrap gap-1.5 overflow-hidden text-[0.62rem] tracking-[0.12em]'
                    : 'flex-wrap gap-1.5 text-[0.6rem] tracking-[0.14em]'
                } uppercase`}
              >
                {isExpanded ? (
                  <span className="min-w-0 max-w-[44%] shrink truncate font-medium text-on-surface-variant/85">
                    {task.group?.name || 'Inbox'}
                  </span>
                ) : null}

                <span className={`shrink-0 font-bold ${dueTone}`}>Due: {dueLabel}</span>

                <span
                  className={`shrink-0 rounded-pill px-2 py-0.5 font-body tracking-[0.16em] ${recurrenceBadgeClass}`}
                  title={task.recurrence_frequency ? `Recurring: ${task.recurrence_frequency}` : 'No recurrence'}
                >
                  {recurrenceLabel}
                </span>

                {!isExpanded ? (
                  <span className="rounded-pill bg-surface-dim px-2 py-0.5 font-body tracking-[0.16em] text-on-surface-variant/75 shadow-[inset_0_1px_1px_rgba(255,255,255,0.04)]">
                    {subtaskLabel}
                  </span>
                ) : null}
              </div>
            </div>
          </div>

          <div className={`flex shrink-0 flex-col ${isExpanded ? 'items-end justify-between gap-3 pt-0.5' : 'items-center gap-0 pt-0'}`}>
            <button
              type="button"
              aria-label={isExpanded ? `Collapse ${task.title}` : `Expand ${task.title}`}
              aria-expanded={isExpanded}
              onClick={(event) => {
                event.stopPropagation()
                setIsExpanded((current) => !current)
              }}
              className="flex h-6 w-6 shrink-0 self-end items-center justify-center rounded-full bg-surface-dim text-on-surface-variant transition-all duration-200 hover:bg-surface-container-highest hover:text-on-surface"
            >
              <svg
                className={`h-3 w-3 transition-transform duration-200 ${isExpanded ? 'rotate-180' : ''}`}
                fill="none"
                stroke="currentColor"
                viewBox="0 0 24 24"
              >
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.25} d="M19 9l-7 7-7-7" />
              </svg>
            </button>

            {isExpanded ? (
              <div className="flex items-center gap-2 self-end">
                {onDelete ? (
                  <button
                    type="button"
                    onClick={(event) => {
                      event.stopPropagation()
                      onDelete?.(task)
                    }}
                    disabled={isBusy}
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-dim border border-white/10 shadow-[0_4px_12px_rgba(0,0,0,0.5),_inset_0_2px_4px_rgba(255,255,255,0.1)] text-tertiary transition-all duration-200 hover:-translate-y-0.5 hover:bg-surface-container-highest active:translate-y-0 active:scale-90 disabled:opacity-50 disabled:hover:-translate-y-0 disabled:active:scale-100"
                    aria-label={`Delete ${task.title}`}
                  >
                    <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                ) : null}

                <button
                  type="button"
                  onClick={(event) => {
                    event.stopPropagation()
                    onComplete(task)
                  }}
                  disabled={isBusy}
                  className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-dim border border-white/10 shadow-[0_4px_12px_rgba(0,0,0,0.5),_inset_0_2px_4px_rgba(255,255,255,0.1)] text-primary transition-all duration-200 hover:-translate-y-0.5 hover:bg-surface-container-highest active:translate-y-0 active:scale-90 disabled:opacity-50 disabled:hover:-translate-y-0 disabled:active:scale-100"
                  aria-label={`Complete ${task.title}`}
                >
                  <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" />
                  </svg>
                </button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
    </Card>
  )
}
