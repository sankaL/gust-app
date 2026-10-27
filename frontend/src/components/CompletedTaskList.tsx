import { CheckCheck, Folder, Repeat2, RotateCcw } from 'lucide-react'

import type { TaskSummary } from '../lib/api'
import { formatRecurrence } from '../lib/taskFormatters'
import { TaskListSkeleton } from './AllTasksView'
import { Chip, EmptyState } from './ui/controls'
import { groupTone } from './ui/chipStyles'

function completedLabel(task: TaskSummary) {
  if (!task.completed_at) return 'Completed'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(task.completed_at))
}

function completedColumn(task: TaskSummary) {
  if (!task.completed_at) return { top: '✓', bottom: 'Done' }
  const date = new Date(task.completed_at)
  return { top: String(date.getDate()), bottom: new Intl.DateTimeFormat(undefined, { month: 'short' }).format(date).toUpperCase() }
}

function CompletedTaskCard({
  task,
  isBusy,
  onOpen,
  onRestore,
}: {
  task: TaskSummary
  isBusy: boolean
  onOpen: () => void
  onRestore: () => void
}) {
  function handleKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    onOpen()
  }
  const column = completedColumn(task)
  return (
    <article role="button" tabIndex={0} onClick={onOpen} onKeyDown={handleKeyDown} className="group cursor-pointer rounded-[1.4rem] bg-surface-container-high p-4 shadow-card outline-none ring-1 ring-inset ring-outline/40 transition-all duration-200 focus-visible:ring-2 focus-visible:ring-primary/60 active:scale-[0.99] active:bg-surface-container-highest">
      <div className="flex gap-3.5">
        <div className="flex w-12 shrink-0 flex-col items-center pt-0.5" aria-hidden="true">
          <span className="font-display text-[1.02rem] font-extrabold leading-none text-on-surface-variant">{column.top}</span>
          <span className="mt-1.5 font-body text-[0.66rem] font-semibold uppercase tracking-[0.08em] text-on-surface-variant">{column.bottom}</span>
        </div>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-2">
            <h3 className="min-w-0 flex-1 truncate font-display text-[1.02rem] font-bold leading-snug text-on-surface/75 line-through decoration-on-surface-variant/40" title={task.title}>{task.title}</h3>
            <button
              type="button"
              onClick={(event) => { event.stopPropagation(); onRestore() }}
              disabled={isBusy}
              className="-my-1 flex h-9 w-9 shrink-0 items-center justify-center rounded-full text-on-surface-variant outline-none ring-1 ring-inset ring-outline/60 transition-all duration-200 hover:bg-chip-amber hover:text-chip-amber-ink hover:ring-transparent focus-visible:ring-2 focus-visible:ring-primary/60 active:scale-90 disabled:opacity-50"
              aria-label={`Restore ${task.title}`}
              title="Restore"
            >
              <RotateCcw className="h-4 w-4" strokeWidth={2.2} />
            </button>
          </div>
          <div className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <Chip tone={groupTone(task.group?.name)} icon={Folder}>{task.group?.name || 'Inbox'}</Chip>
            <Chip tone="green" icon={CheckCheck}>{completedLabel(task)}</Chip>
            {task.recurrence_frequency ? <Chip icon={Repeat2} title={`Recurring: ${task.recurrence_frequency}`}>{formatRecurrence(task.recurrence_frequency)}</Chip> : null}
          </div>
        </div>
      </div>
    </article>
  )
}

export function CompletedTaskList({
  tasks,
  isLoading,
  hasResult,
  pendingTaskIds,
  onOpen,
  onRestore,
}: {
  tasks: TaskSummary[]
  isLoading: boolean
  hasResult: boolean
  pendingTaskIds: string[]
  onOpen: (taskId: string) => void
  onRestore: (task: TaskSummary) => void
}) {
  return (
    <section className="space-y-3 pt-2">
      {isLoading ? <><span className="sr-only">Loading completed tasks.</span><TaskListSkeleton /></> : null}
      {hasResult && tasks.length === 0 ? <EmptyState icon={CheckCheck} title="No completed tasks here">Complete tasks from the open list, then review them here.</EmptyState> : null}
      {tasks.map((task, index) => (
        <div key={task.id} className="animate-rise-in" style={{ ['--stagger' as string]: Math.min(index, 8) }}>
          <CompletedTaskCard task={task} isBusy={pendingTaskIds.includes(task.id)} onOpen={() => onOpen(task.id)} onRestore={() => onRestore(task)} />
        </div>
      ))}
    </section>
  )
}
