import { Coffee, SearchX, Sparkles } from 'lucide-react'

import type { TaskSummary } from '../lib/api'
import { formatRelativeDay } from '../lib/taskFormatters'
import { TaskListSkeleton } from './AllTasksView'
import { OpenTaskCard } from './OpenTaskCard'
import { EmptyState, SectionLabel } from './ui/controls'
import { SECTION_ICONS } from '../lib/taskSections'

const sections = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'due_soon', label: 'Due Soon' },
  { key: 'no_date', label: 'No Date' },
] as const

type TaskActions = {
  todayIso: string
  busyTaskIds: string[]
  onOpen: (taskId: string) => void
  onPrepareOpen: (taskId: string) => void
  onComplete: (task: TaskSummary) => void
  onDelete: (task: TaskSummary) => void
}

function TaskSection({ sectionKey, label, tasks, ...actions }: TaskActions & { sectionKey: string; label: string; tasks: TaskSummary[] }) {
  if (tasks.length === 0) return null
  return (
    <section className="space-y-3 pt-4">
      <SectionLabel icon={SECTION_ICONS[sectionKey]} count={tasks.length} tone={sectionKey === 'overdue' ? 'alert' : 'default'}>{label}</SectionLabel>
      <div className="space-y-3">
        {tasks.map((task, index) => (
          <div key={task.id} className="animate-rise-in" style={{ ['--stagger' as string]: Math.min(index, 8) }}>
            <OpenTaskCard task={task} todayIso={actions.todayIso} isBusy={actions.busyTaskIds.includes(task.id)} onPrepareOpen={actions.onPrepareOpen} onOpen={actions.onOpen} onComplete={actions.onComplete} onDelete={actions.onDelete} enableSwipe />
          </div>
        ))}
      </div>
    </section>
  )
}

export function GroupedOpenTaskList({
  tasks,
  todayIso,
  dayFilter = null,
  isLoading,
  hasResult,
  searchQuery,
  isSearchActive,
  isSearchPending,
  ...actions
}: Omit<TaskActions, 'todayIso'> & {
  tasks: TaskSummary[]
  todayIso: string
  dayFilter?: string | null
  isLoading: boolean
  hasResult: boolean
  searchQuery: string
  isSearchActive: boolean
  isSearchPending: boolean
}) {
  const hasSearchQuery = isSearchActive && Boolean(searchQuery.trim())
  const isDayFiltered = Boolean(dayFilter && dayFilter !== todayIso)
  const visibleTasks = isDayFiltered ? tasks.filter((task) => task.due_date === dayFilter) : tasks
  return (
    <div aria-busy={isSearchPending} className={`transition-opacity duration-200 motion-reduce:transition-none ${isSearchPending ? 'opacity-55' : 'opacity-100'}`}>
      {isLoading ? <><span className="sr-only">{hasSearchQuery ? 'Searching tasks.' : 'Loading open tasks.'}</span><TaskListSkeleton /></> : null}
      {hasResult && visibleTasks.length === 0 ? (
        <div className="pt-4">
          {hasSearchQuery
            ? <EmptyState icon={SearchX} title={`No tasks match "${searchQuery.trim()}"`}>Try a different task title or detail.</EmptyState>
            : isDayFiltered
              ? <EmptyState icon={Coffee} title="Nothing due this day">Nothing in this group is due then.</EmptyState>
              : <EmptyState icon={Sparkles} title="No open tasks here">Capture a voice note or move tasks into this group from detail editing.</EmptyState>}
        </div>
      ) : null}
      {isDayFiltered && dayFilter
        ? <TaskSection sectionKey={dayFilter < todayIso ? 'overdue' : 'due_soon'} label={formatRelativeDay(dayFilter, todayIso)} tasks={visibleTasks} todayIso={todayIso} {...actions} />
        : sections.map((section) => <TaskSection key={section.key} sectionKey={section.key} label={section.label} tasks={visibleTasks.filter((task) => task.due_bucket === section.key)} todayIso={todayIso} {...actions} />)}
    </div>
  )
}
