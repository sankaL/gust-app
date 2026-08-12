import { useMemo } from 'react'

import type { TaskSummary } from '../lib/api'
import { addDaysIso } from '../lib/desktopData'

type OpenTaskCardContentProps = {
  task: TaskSummary
  todayIso: string
  isExpanded: boolean
  isBusy: boolean
  showCollapsedGroupLabel: boolean
  onToggleExpanded: () => void
  onComplete: () => void
  onDelete?: () => void
}

function buildDuePresentation(dueDate: string | null, todayIso: string) {
  if (!dueDate) return { label: '--', tone: 'text-on-surface-variant/55' }
  if (dueDate < todayIso) return { label: 'Overdue', tone: 'text-error' }
  if (dueDate === todayIso) return { label: 'Today', tone: 'text-warning' }
  if (dueDate === addDaysIso(todayIso, 1)) return { label: 'Tomorrow', tone: 'text-primary' }
  return {
    label: new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(new Date(`${dueDate}T12:00:00`)),
    tone: 'text-primary',
  }
}

function formatReminder(reminderAt: string | null) {
  if (!reminderAt) return 'No reminder'
  return new Date(reminderAt).toLocaleDateString(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  })
}

function TaskBadges({
  task,
  todayIso,
  expanded,
  showGroup,
}: {
  task: TaskSummary
  todayIso: string
  expanded: boolean
  showGroup: boolean
}) {
  const due = useMemo(() => buildDuePresentation(task.due_date, todayIso), [task.due_date, todayIso])
  const recurrence = task.recurrence_frequency?.toUpperCase() ?? 'ONE-OFF'
  return (
    <div
      className={`flex w-full min-w-0 items-center ${
        expanded
          ? 'mt-2 flex-nowrap gap-1.5 overflow-hidden text-[0.62rem] tracking-[0.12em]'
          : 'flex-nowrap gap-1 overflow-hidden text-[0.58rem] tracking-[0.12em] sm:text-[0.6rem]'
      } uppercase`}
    >
      {showGroup && (
        <span
          className={
            expanded
              ? 'min-w-0 max-w-[44%] shrink truncate font-medium text-on-surface-variant/85'
              : 'min-w-0 max-w-[48%] shrink truncate rounded-pill bg-surface-dim px-2 py-0.5 font-body tracking-[0.14em] text-on-surface-variant/80 shadow-[inset_0_1px_1px_rgba(255,255,255,0.04)]'
          }
        >
          {task.group?.name || 'Inbox'}
        </span>
      )}
      <span className={`shrink-0 whitespace-nowrap font-bold ${due.tone}`}>Due: {due.label}</span>
      <span
        className="recurrence-badge shrink-0"
        title={task.recurrence_frequency ? `Recurring: ${task.recurrence_frequency}` : 'No recurrence'}
      >
        {recurrence}
      </span>
      {!expanded && <SubtaskBadge count={task.subtask_count ?? 0} />}
    </div>
  )
}

function SubtaskBadge({ count }: { count: number }) {
  return (
    <span className="subtask-badge shrink-0">
      <svg className="h-3 w-3 shrink-0 text-white" fill="none" stroke="currentColor" strokeWidth={2.25} viewBox="0 0 24 24" aria-hidden="true">
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 6h12" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 12h12" />
        <path strokeLinecap="round" strokeLinejoin="round" d="M4 18h12" />
        <path strokeLinecap="round" strokeLinejoin="round" d="m17 8 2 2 4-4" />
        <path strokeLinecap="round" strokeLinejoin="round" d="m17 14 2 2 4-4" />
      </svg>
      <span className="text-[0.65rem] font-bold text-white">{count}</span>
    </span>
  )
}

function ExpandedDetails({ task, todayIso }: { task: TaskSummary; todayIso: string }) {
  const count = task.subtask_count ?? 0
  return (
    <div className="flex flex-1 flex-col gap-3">
      <h3 className="min-w-0 whitespace-normal font-display text-base font-medium leading-tight text-on-surface">{task.title}</h3>
      {task.description && <p className="text-[0.78rem] leading-5 text-on-surface-variant">{task.description}</p>}
      {task.needs_review && (
        <div className="flex items-center gap-2">
          <span className="inline-block rounded-pill bg-warning/20 px-2 py-0.5 text-[0.65rem] font-bold uppercase tracking-widest text-warning">Needs Review</span>
        </div>
      )}
      <div className="flex min-w-0 flex-nowrap items-center gap-2 overflow-hidden text-[0.66rem] leading-4 text-on-surface-variant sm:text-[0.68rem]">
        <span className="shrink-0 font-medium text-on-surface-variant/85">{count} {count === 1 ? 'subtask' : 'subtasks'}</span>
        <span className="shrink-0 text-on-surface-variant/40">•</span>
        <span className="min-w-0 truncate text-on-surface-variant/85">Reminder: {formatReminder(task.reminder_at)}</span>
      </div>
      <TaskBadges task={task} todayIso={todayIso} expanded showGroup />
    </div>
  )
}

function CollapsedDetails({ task, todayIso, showGroup }: { task: TaskSummary; todayIso: string; showGroup: boolean }) {
  return (
    <div className="flex flex-col gap-1.5">
      <h3 className="min-w-0 truncate pr-2 font-display text-[0.98rem] font-medium leading-tight text-on-surface" title={task.title}>{task.title}</h3>
      <TaskBadges task={task} todayIso={todayIso} expanded={false} showGroup={showGroup} />
    </div>
  )
}

function TaskActions({
  task,
  expanded,
  isBusy,
  onToggle,
  onComplete,
  onDelete,
}: {
  task: TaskSummary
  expanded: boolean
  isBusy: boolean
  onToggle: () => void
  onComplete: () => void
  onDelete?: () => void
}) {
  return (
    <div className={`flex shrink-0 flex-col ${expanded ? 'items-end justify-between gap-3 pt-0.5' : 'items-center gap-0 pt-0'}`}>
      <button type="button" aria-label={expanded ? `Collapse ${task.title}` : `Expand ${task.title}`} aria-expanded={expanded} onClick={(event) => { event.stopPropagation(); onToggle() }} className="flex h-6 w-6 shrink-0 self-end items-center justify-center rounded-full bg-surface-dim text-on-surface-variant transition-all duration-200 hover:bg-surface-container-highest hover:text-on-surface">
        <svg className={`h-3 w-3 transition-transform duration-200 ${expanded ? 'rotate-180' : ''}`} fill="none" stroke="currentColor" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.25} d="M19 9l-7 7-7-7" />
        </svg>
      </button>
      {expanded && <ExpandedActions task={task} isBusy={isBusy} onComplete={onComplete} onDelete={onDelete} />}
    </div>
  )
}

function ExpandedActions({ task, isBusy, onComplete, onDelete }: Pick<OpenTaskCardContentProps, 'isBusy' | 'onComplete' | 'onDelete'> & { task: TaskSummary }) {
  const buttonClass = "flex h-8 w-8 shrink-0 items-center justify-center rounded-full border border-white/10 bg-surface-dim shadow-[0_4px_12px_rgba(0,0,0,0.5),_inset_0_2px_4px_rgba(255,255,255,0.1)] transition-all duration-200 hover:-translate-y-0.5 hover:bg-surface-container-highest active:translate-y-0 active:scale-90 disabled:opacity-50 disabled:hover:-translate-y-0 disabled:active:scale-100"
  return (
    <div className="flex items-center gap-2 self-end">
      {onDelete && <button type="button" onClick={(event) => { event.stopPropagation(); onDelete() }} disabled={isBusy} className={`${buttonClass} text-tertiary`} aria-label={`Delete ${task.title}`}><svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg></button>}
      <button type="button" onClick={(event) => { event.stopPropagation(); onComplete() }} disabled={isBusy} className={`${buttonClass} text-primary`} aria-label={`Complete ${task.title}`}><svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg></button>
    </div>
  )
}

export function OpenTaskCardContent({ task, todayIso, isExpanded, isBusy, showCollapsedGroupLabel, onToggleExpanded, onComplete, onDelete }: OpenTaskCardContentProps) {
  return (
    <div className={`flex ${isExpanded ? 'items-stretch gap-3' : 'items-start gap-2'}`}>
      <div className={`min-w-0 flex-1 ${isExpanded ? 'flex flex-col' : ''}`}>
        {isExpanded ? <ExpandedDetails task={task} todayIso={todayIso} /> : <CollapsedDetails task={task} todayIso={todayIso} showGroup={showCollapsedGroupLabel} />}
      </div>
      <TaskActions task={task} expanded={isExpanded} isBusy={isBusy} onToggle={onToggleExpanded} onComplete={onComplete} onDelete={onDelete} />
    </div>
  )
}
