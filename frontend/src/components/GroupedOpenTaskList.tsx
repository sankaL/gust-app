import type { TaskSummary } from '../lib/api'
import { OpenTaskCard } from './OpenTaskCard'

const sections = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'due_soon', label: 'Due Soon' },
  { key: 'no_date', label: 'No Date' },
] as const

function TaskSection({
  label,
  tasks,
  busyTaskIds,
  onOpen,
  onPrepareOpen,
  onComplete,
  onDelete,
}: {
  label: string
  tasks: TaskSummary[]
  busyTaskIds: string[]
  onOpen: (taskId: string) => void
  onPrepareOpen: (taskId: string) => void
  onComplete: (task: TaskSummary) => void
  onDelete: (task: TaskSummary) => void
}) {
  if (tasks.length === 0) return null
  return (
    <section className="space-y-3">
      <div className="flex items-center justify-between"><h3 className="font-display text-xl text-on-surface">{label}</h3><span className="font-body text-xs uppercase tracking-[0.1em] text-on-surface-variant">{tasks.length} tasks</span></div>
      <div className="space-y-3">{tasks.map((task) => <OpenTaskCard key={task.id} task={task} isBusy={busyTaskIds.includes(task.id)} onPrepareOpen={onPrepareOpen} onOpen={onOpen} onComplete={onComplete} onDelete={onDelete} enableSwipe />)}</div>
    </section>
  )
}

export function GroupedOpenTaskList({
  tasks,
  isLoading,
  hasResult,
  busyTaskIds,
  onOpen,
  onPrepareOpen,
  onComplete,
  onDelete,
}: {
  tasks: TaskSummary[]
  isLoading: boolean
  hasResult: boolean
  busyTaskIds: string[]
  onOpen: (taskId: string) => void
  onPrepareOpen: (taskId: string) => void
  onComplete: (task: TaskSummary) => void
  onDelete: (task: TaskSummary) => void
}) {
  return (
    <div className="space-y-3">
      {isLoading && <div className="rounded-card bg-surface-container p-6 text-sm text-on-surface-variant">Loading open tasks.</div>}
      {hasResult && tasks.length === 0 && <div className="rounded-soft bg-surface-container p-6 shadow-ambient"><p className="font-display text-2xl text-on-surface">No open tasks here</p><p className="mt-3 font-body text-sm leading-6 text-on-surface-variant">Capture a voice note or move tasks into this group from detail editing.</p></div>}
      <div className="space-y-4">{sections.map((section) => <TaskSection key={section.key} label={section.label} tasks={tasks.filter((task) => task.due_bucket === section.key)} busyTaskIds={busyTaskIds} onOpen={onOpen} onPrepareOpen={onPrepareOpen} onComplete={onComplete} onDelete={onDelete} />)}</div>
    </div>
  )
}
