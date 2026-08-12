import { Link } from 'react-router-dom'

import type { GroupSummary, SessionStatus, TaskSummary } from '../lib/api'
import { AllTasksView } from './AllTasksView'
import { GroupedOpenTaskList } from './GroupedOpenTaskList'
import { PullToRefresh } from './TaskScreenRefresh'
import { SessionGuard } from './SessionGuard'
import { TaskDeleteDialog } from './TaskDeleteDialog'
import { TaskGroupTabs } from './TaskGroupTabs'
import { TaskPreviewModal } from './TaskPreviewModal'
import { getTodayIsoDate } from '../lib/desktopData'

type TasksRouteViewProps = {
  session?: SessionStatus
  isSessionLoading: boolean
  isSessionError: boolean
  groups: GroupSummary[]
  effectiveGroupId: string
  isAllView: boolean
  tasks: TaskSummary[]
  isTasksLoading: boolean
  hasTaskResult: boolean
  isRefreshing: boolean
  pendingTaskIds: string[]
  selectedTaskId: string | null
  pendingDeleteTask: TaskSummary | null
  isDeleting: boolean
  refresh: () => Promise<void>
  onSelectGroup: (groupId: string) => void
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

function TasksList(props: Pick<TasksRouteViewProps, 'session' | 'isAllView' | 'tasks' | 'isTasksLoading' | 'hasTaskResult' | 'isRefreshing' | 'pendingTaskIds' | 'refresh' | 'onOpen' | 'onPrepareOpen' | 'onComplete' | 'onDeleteRequest'>) {
  if (props.isAllView) return <AllTasksView userTimezone={props.session?.timezone ?? null} onTaskOpen={props.onOpen} onTaskComplete={props.onComplete} onTaskPrepareOpen={props.onPrepareOpen} onTaskDelete={props.onDeleteRequest} busyTaskIds={props.pendingTaskIds} />
  const todayIso = getTodayIsoDate(props.session?.timezone ?? null)
  return <PullToRefresh isRefreshing={props.isRefreshing} onRefresh={props.refresh}><GroupedOpenTaskList tasks={props.tasks} todayIso={todayIso} isLoading={props.isTasksLoading} hasResult={props.hasTaskResult} busyTaskIds={props.pendingTaskIds} onOpen={props.onOpen} onPrepareOpen={props.onPrepareOpen} onComplete={props.onComplete} onDelete={props.onDeleteRequest} /></PullToRefresh>
}

function TaskOverlays(props: Pick<TasksRouteViewProps, 'session' | 'groups' | 'selectedTaskId' | 'pendingTaskIds' | 'pendingDeleteTask' | 'isDeleting' | 'onDeleteOccurrence' | 'onDeleteSeries' | 'onCloseDelete' | 'onClosePreview' | 'onPreviewComplete' | 'onPreviewDelete'>) {
  return (
    <>
      <TaskDeleteDialog isOpen={props.pendingDeleteTask !== null} taskTitle={props.pendingDeleteTask?.title ?? ''} isRecurring={Boolean(props.pendingDeleteTask?.series_id || props.pendingDeleteTask?.recurrence_frequency)} isDeleting={props.isDeleting} onDeleteOccurrence={props.onDeleteOccurrence} onDeleteSeries={props.onDeleteSeries} onClose={props.onCloseDelete} />
      <TaskPreviewModal taskId={props.selectedTaskId} isOpen={Boolean(props.selectedTaskId)} onClose={props.onClosePreview} onComplete={props.onPreviewComplete} onRequestDelete={props.onPreviewDelete} busyTaskIds={props.pendingTaskIds} session={props.session} groups={props.groups} />
    </>
  )
}

export function TasksRouteView(props: TasksRouteViewProps) {
  return (
    <SessionGuard session={props.session} isLoading={props.isSessionLoading} isError={props.isSessionError} title="Tasks" eyebrow="Focused task surface" description="Review, sort, and correct extracted tasks without leaving the protected backend session.">
      <section className="space-y-4">
        {props.groups.length > 0 && <TaskGroupTabs groups={props.groups} inboxGroupId={props.session?.inbox_group_id} selectedGroupId={props.effectiveGroupId} onSelectGroup={props.onSelectGroup} />}
        <TasksList {...props} />
        <div className="mb-20 mt-8 flex justify-center pb-8"><Link to={{ pathname: '/tasks/completed', search: `?group=${props.effectiveGroupId}` }} className="inline-flex items-center gap-2 rounded-pill border border-outline/20 bg-surface-container px-4 py-2 text-sm font-medium text-on-surface-variant transition-all hover:bg-surface-container-high hover:text-on-surface hover:shadow-ambient">View Completed Tasks</Link></div>
      </section>
      <TaskOverlays {...props} />
    </SessionGuard>
  )
}
