import { Link } from 'react-router-dom'
import { ArrowRight } from 'lucide-react'

import type { GroupSummary, SessionStatus, TaskSummary } from '../lib/api'
import { formatHeaderDate, formatRelativeDay } from '../lib/taskFormatters'
import { AllTasksView, TaskLoadError } from './AllTasksView'
import { useMobileShell } from './AppShellActions'
import { ScreenHeader } from './AppShellView'
import { GroupedOpenTaskList } from './GroupedOpenTaskList'
import { PullToRefresh } from './TaskScreenRefresh'
import { SessionGuard } from './SessionGuard'
import { TaskDeleteDialog } from './TaskDeleteDialog'
import { TaskGroupTabs } from './TaskGroupTabs'
import { TaskPreviewModal } from './TaskPreviewModal'
import { ReviewScan } from './ui/CaptureIcons'
import { WeekStrip } from './tasks/WeekStrip'

type TasksRouteViewProps = {
  session?: SessionStatus
  isSessionLoading: boolean
  isSessionError: boolean
  groups: GroupSummary[]
  effectiveGroupId: string
  isAllView: boolean
  tasks: TaskSummary[]
  isTasksLoading: boolean
  isTasksError: boolean
  hasTaskResult: boolean
  isRefreshing: boolean
  searchQuery: string
  requestSearchQuery: string
  isSearchActive: boolean
  isSearchPending: boolean
  pendingTaskIds: string[]
  selectedTaskId: string | null
  pendingDeleteTask: TaskSummary | null
  isDeleting: boolean
  todayIso: string
  selectedDay: string
  dueCounts: Record<string, number>
  refresh: () => Promise<void>
  retryTasks: () => void
  onSelectDay: (isoDate: string) => void
  onSelectGroup: (groupId: string) => void
  onSearchOpen: () => void
  onSearchChange: (value: string) => void
  onSearchClear: () => void
  onOpen: (taskId: string) => void
  onPrepareOpen: (taskId: string) => void
  onComplete: (task: TaskSummary) => void
  onDeleteRequest: (task: TaskSummary) => void
  onDeleteOccurrence: () => void
  onDeleteSeries: () => void
  onCloseDelete: () => void
  onClosePreview: () => void
  onPreviewComplete: (task: TaskSummary) => void
  onPreviewDelete: (task: TaskSummary) => void
}

function TasksList(props: Pick<TasksRouteViewProps, 'session' | 'isAllView' | 'tasks' | 'isTasksLoading' | 'isTasksError' | 'hasTaskResult' | 'isRefreshing' | 'searchQuery' | 'requestSearchQuery' | 'isSearchActive' | 'isSearchPending' | 'pendingTaskIds' | 'todayIso' | 'selectedDay' | 'refresh' | 'retryTasks' | 'onOpen' | 'onPrepareOpen' | 'onComplete' | 'onDeleteRequest'>) {
  const dayFilter = props.selectedDay === props.todayIso ? null : props.selectedDay
  if (props.isAllView) return <AllTasksView userTimezone={props.session?.timezone ?? null} dayFilter={dayFilter} searchQuery={props.searchQuery} requestSearchQuery={props.requestSearchQuery} isSearchActive={props.isSearchActive} isSearchDebouncing={props.isSearchPending} onTaskOpen={props.onOpen} onTaskComplete={props.onComplete} onTaskPrepareOpen={props.onPrepareOpen} onTaskDelete={props.onDeleteRequest} busyTaskIds={props.pendingTaskIds} />
  if (props.isTasksError) return <TaskLoadError searching={props.isSearchActive} onRetry={props.retryTasks} />
  return <PullToRefresh isRefreshing={props.isRefreshing} onRefresh={props.refresh}><GroupedOpenTaskList tasks={props.tasks} todayIso={props.todayIso} dayFilter={dayFilter} isLoading={props.isTasksLoading} hasResult={props.hasTaskResult} searchQuery={props.searchQuery} isSearchActive={props.isSearchActive} isSearchPending={props.isSearchPending} busyTaskIds={props.pendingTaskIds} onOpen={props.onOpen} onPrepareOpen={props.onPrepareOpen} onComplete={props.onComplete} onDelete={props.onDeleteRequest} /></PullToRefresh>
}

function TaskOverlays(props: Pick<TasksRouteViewProps, 'session' | 'groups' | 'selectedTaskId' | 'pendingTaskIds' | 'pendingDeleteTask' | 'isDeleting' | 'onDeleteOccurrence' | 'onDeleteSeries' | 'onCloseDelete' | 'onClosePreview' | 'onPreviewComplete' | 'onPreviewDelete'>) {
  return (
    <>
      <TaskDeleteDialog isOpen={props.pendingDeleteTask !== null} taskTitle={props.pendingDeleteTask?.title ?? ''} isRecurring={Boolean(props.pendingDeleteTask?.series_id || props.pendingDeleteTask?.recurrence_frequency)} isDeleting={props.isDeleting} onDeleteOccurrence={props.onDeleteOccurrence} onDeleteSeries={props.onDeleteSeries} onClose={props.onCloseDelete} />
      <TaskPreviewModal taskId={props.selectedTaskId} isOpen={Boolean(props.selectedTaskId)} onClose={props.onClosePreview} onComplete={props.onPreviewComplete} onRequestDelete={props.onPreviewDelete} busyTaskIds={props.pendingTaskIds} session={props.session} groups={props.groups} />
    </>
  )
}

function dayEyebrow(selectedDay: string, todayIso: string) {
  const relative = formatRelativeDay(selectedDay, todayIso)
  if (['Today', 'Tomorrow', 'Yesterday'].includes(relative)) return relative
  return new Intl.DateTimeFormat(undefined, { weekday: 'long' }).format(new Date(`${selectedDay}T12:00:00`))
}

export function ReviewBanner() {
  const shell = useMobileShell()
  const count = shell?.pendingReviewCount ?? 0
  if (!shell || count === 0) return null
  return (
    <button
      type="button"
      onClick={() => shell.openSheet('review')}
      className="animate-rise-in group mt-1 flex w-full items-center gap-3.5 rounded-[1.4rem] bg-card-active p-3.5 text-left shadow-card outline-none ring-1 ring-inset ring-card-active-line/30 transition-transform duration-200 focus-visible:ring-2 focus-visible:ring-primary/60 active:scale-[0.99]"
    >
      <span className="flex h-11 w-11 shrink-0 items-center justify-center rounded-2xl bg-primary text-on-primary shadow-card">
        <ReviewScan className="h-6 w-6" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-display text-[0.98rem] font-bold text-on-surface">{count} {count === 1 ? 'task' : 'tasks'} waiting for review</span>
        <span className="block font-body text-xs text-on-surface-variant">Approve what Gust extracted from your captures</span>
      </span>
      <ArrowRight className="h-5 w-5 shrink-0 text-primary transition-transform duration-200 group-hover:translate-x-0.5" strokeWidth={2.3} aria-hidden="true" />
    </button>
  )
}

export function TasksRouteView(props: TasksRouteViewProps) {
  return (
    <SessionGuard session={props.session} isLoading={props.isSessionLoading} isError={props.isSessionError} title="Tasks" eyebrow="Focused task surface" description="Review, sort, and correct extracted tasks without leaving the protected backend session.">
      <ScreenHeader eyebrow={dayEyebrow(props.selectedDay, props.todayIso)} title={formatHeaderDate(props.selectedDay)} />
      <WeekStrip todayIso={props.todayIso} selectedIso={props.selectedDay} dueCounts={props.dueCounts} onSelect={props.onSelectDay} />
      <section className="space-y-3">
        <ReviewBanner />
        {props.groups.length > 0 && <TaskGroupTabs groups={props.groups} inboxGroupId={props.session?.inbox_group_id} selectedGroupId={props.effectiveGroupId} searchQuery={props.searchQuery} isSearchActive={props.isSearchActive} onSelectGroup={props.onSelectGroup} onSearchOpen={props.onSearchOpen} onSearchChange={props.onSearchChange} onSearchClear={props.onSearchClear} />}
      </section>
      <TasksList {...props} />
      <div className="mb-2 mt-8 flex justify-center">
        <Link to={{ pathname: '/tasks/completed', search: `?group=${props.effectiveGroupId}` }} className="inline-flex items-center gap-1.5 rounded-pill px-4 py-2 font-body text-sm font-semibold text-on-surface-variant transition-colors hover:bg-on-surface/[0.05] hover:text-on-surface">
          View Completed Tasks<ArrowRight className="h-4 w-4" strokeWidth={2.2} aria-hidden="true" />
        </Link>
      </div>
      <TaskOverlays {...props} />
    </SessionGuard>
  )
}
