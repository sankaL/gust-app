import { AlarmClock, AlertTriangle, CalendarDays, Folder, ListChecks, Repeat2, Trash2 } from 'lucide-react'

import type { TaskSummary } from '../lib/api'
import { formatRecurrence, formatShortDate, formatTimeParts } from '../lib/taskFormatters'
import { CheckCircle, Chip } from './ui/controls'
import { groupTone } from './ui/chipStyles'

type OpenTaskCardContentProps = {
  task: TaskSummary
  todayIso: string
  isBusy: boolean
  isCompleting: boolean
  showGroup: boolean
  onComplete: () => void
  onDelete?: () => void
}

function timeColumn(task: TaskSummary, todayIso: string) {
  const reminder = task.reminder_at ? formatTimeParts(task.reminder_at) : null
  if (reminder) return { top: reminder.time, bottom: reminder.period, label: `Reminder at ${reminder.time} ${reminder.period}` }
  if (task.due_date) {
    const date = new Date(`${task.due_date}T12:00:00`)
    const isToday = task.due_date === todayIso
    return {
      top: isToday ? 'Today' : String(date.getDate()),
      bottom: isToday ? 'Due' : new Intl.DateTimeFormat(undefined, { month: 'short' }).format(date).toUpperCase(),
      label: `Due ${formatShortDate(task.due_date)}`,
    }
  }
  return { top: '—', bottom: 'Any', label: 'No due date' }
}

function TimeColumn({ task, todayIso }: { task: TaskSummary; todayIso: string }) {
  const { top, bottom, label } = timeColumn(task, todayIso)
  const overdue = Boolean(task.due_date && task.due_date < todayIso)
  return (
    <div className="flex w-12 shrink-0 flex-col items-center pt-0.5" aria-label={label}>
      <span className={`font-display font-extrabold leading-none tracking-[-0.02em] ${top.length > 4 ? 'text-[0.85rem]' : 'text-[1.02rem]'} ${overdue ? 'text-tertiary' : 'text-on-surface'}`}>{top}</span>
      <span className="mt-1.5 font-body text-[0.66rem] font-semibold uppercase tracking-[0.08em] text-on-surface-variant">{bottom}</span>
      <span aria-hidden="true" className="mt-2.5 w-px flex-1 rounded-full bg-gradient-to-b from-outline to-transparent" />
    </div>
  )
}

function TaskChips({ task, todayIso, showGroup }: { task: TaskSummary; todayIso: string; showGroup: boolean }) {
  const overdue = Boolean(task.due_date && task.due_date < todayIso)
  const showsTime = Boolean(task.reminder_at)
  const count = task.subtask_count ?? 0
  return (
    <div className="mt-3 flex flex-wrap items-center gap-1.5">
      {showGroup ? <Chip tone={groupTone(task.group?.name)} icon={Folder}>{task.group?.name || 'Inbox'}</Chip> : null}
      {overdue && task.due_date ? <Chip tone="rose" icon={AlarmClock}>Overdue · {formatShortDate(task.due_date)}</Chip> : null}
      {!overdue && showsTime && task.due_date && task.due_date !== todayIso ? <Chip icon={CalendarDays}>{formatShortDate(task.due_date)}</Chip> : null}
      {task.recurrence_frequency ? <Chip icon={Repeat2} title={`Recurring: ${task.recurrence_frequency}`}>{formatRecurrence(task.recurrence_frequency)}</Chip> : null}
      {count > 0 ? <Chip tone="blue" icon={ListChecks} title={`${count} ${count === 1 ? 'subtask' : 'subtasks'}`}>{count}</Chip> : null}
      {task.needs_review ? <Chip tone="amber" icon={AlertTriangle}>Needs Review</Chip> : null}
    </div>
  )
}

export function OpenTaskCardContent({ task, todayIso, isBusy, isCompleting, showGroup, onComplete, onDelete }: OpenTaskCardContentProps) {
  return (
    <div className="flex gap-3.5">
      <TimeColumn task={task} todayIso={todayIso} />
      <div className="min-w-0 flex-1 pb-0.5">
        <div className="flex items-start gap-2">
          <h3
            className={`min-w-0 flex-1 font-display text-[1.04rem] font-bold leading-snug tracking-[-0.01em] transition-colors duration-300 ${isCompleting ? 'text-on-surface-variant line-through decoration-2' : 'text-on-surface'}`}
            title={task.title}
          >
            {task.title}
          </h3>
          {onDelete ? (
            <button
              type="button"
              onClick={(event) => { event.stopPropagation(); onDelete() }}
              onPointerDown={(event) => event.stopPropagation()}
              disabled={isBusy}
              aria-label={`Delete ${task.title}`}
              title="Delete"
              className="-my-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-on-surface-variant opacity-0 outline-none transition-all duration-200 hover:bg-chip-rose hover:text-chip-rose-ink focus-visible:opacity-100 group-hover:opacity-100 disabled:opacity-0 [@media(hover:none)]:hidden"
            >
              <Trash2 className="h-4 w-4" strokeWidth={2.2} />
            </button>
          ) : null}
          <span onPointerDown={(event) => event.stopPropagation()} className="-my-0.5">
            <CheckCircle
              mode="action"
              label={`Complete ${task.title}`}
              checked={isCompleting}
              pending={isBusy && !isCompleting}
              disabled={isBusy || isCompleting}
              onClick={(event) => { event.stopPropagation(); onComplete() }}
            />
          </span>
        </div>
        {task.description ? <p className="mt-1 line-clamp-2 font-body text-[0.84rem] leading-5 text-on-surface-variant">{task.description}</p> : null}
        <TaskChips task={task} todayIso={todayIso} showGroup={showGroup} />
      </div>
    </div>
  )
}
