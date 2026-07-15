import { RotateCcw } from 'lucide-react'

import type { TaskSummary } from '../lib/api'

function completedLabel(task: TaskSummary) {
  if (!task.completed_at) return 'Completed'
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(new Date(task.completed_at))
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
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    onOpen()
  }
  return (
    <article key={task.id} role="button" tabIndex={0} onClick={onOpen} onKeyDown={handleKeyDown} className="rounded-card bg-surface-container-high px-3 py-2.5 transition hover:bg-surface-container-highest/80 active:scale-[0.99]">
      <div className="flex min-w-0 items-center gap-3">
        <div className="min-w-0 flex-1">
          <h3 className="min-w-0 truncate pr-1 font-display text-[0.98rem] font-medium leading-tight text-on-surface" title={task.title}>{task.title}</h3>
          <div className="mt-1 flex min-w-0 flex-nowrap items-center gap-1.5 overflow-hidden font-body text-[0.62rem] uppercase tracking-[0.12em] text-on-surface-variant">
            <span className="min-w-0 max-w-[36%] shrink truncate font-medium text-on-surface-variant/85">{task.group?.name || 'Inbox'}</span>
            <span className="shrink-0 text-on-surface-variant/35">•</span>
            <span className="min-w-0 shrink truncate font-bold text-tertiary">{completedLabel(task)}</span>
            {task.recurrence_frequency && <span className="recurrence-badge shrink-0" title={`Recurring: ${task.recurrence_frequency}`}>{task.recurrence_frequency.toUpperCase()}</span>}
          </div>
        </div>
        <button type="button" onClick={(event) => { event.stopPropagation(); onRestore() }} disabled={isBusy} className="flex h-11 w-11 shrink-0 items-center justify-center rounded-full bg-surface-dim text-on-surface-variant shadow-[0_4px_12px_rgba(0,0,0,0.5),_inset_0_2px_4px_rgba(255,255,255,0.1)] transition-all hover:-translate-y-0.5 hover:bg-surface-container-highest hover:text-on-surface active:translate-y-0 active:scale-95 disabled:opacity-50 disabled:hover:-translate-y-0 disabled:active:scale-100" aria-label={`Restore ${task.title}`} title="Restore"><RotateCcw className="h-4 w-4" strokeWidth={2} /></button>
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
    <section className="space-y-4">
      {isLoading && <div className="rounded-card bg-surface-container p-6 text-sm text-on-surface-variant">Loading completed tasks.</div>}
      {hasResult && tasks.length === 0 && <div className="rounded-soft bg-surface-container p-6 shadow-ambient"><p className="font-display text-2xl text-on-surface">No completed tasks here</p><p className="mt-3 font-body text-sm leading-6 text-on-surface-variant">Complete tasks from the open list, then review them here.</p></div>}
      <div className="space-y-2">{tasks.map((task) => <CompletedTaskCard key={task.id} task={task} isBusy={pendingTaskIds.includes(task.id)} onOpen={() => onOpen(task.id)} onRestore={() => onRestore(task)} />)}</div>
    </section>
  )
}
