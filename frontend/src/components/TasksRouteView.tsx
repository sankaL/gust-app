import { Link } from 'react-router-dom'

import type { GroupSummary, SessionStatus, TaskSummary } from '../lib/api'
import { AllTasksView } from './AllTasksView'
import { EditExtractedTaskModal } from './EditExtractedTaskModal'
import { GroupedOpenTaskList } from './GroupedOpenTaskList'
import { PullToRefresh } from './TaskScreenRefresh'
import { SessionGuard } from './SessionGuard'
import { TaskDeleteDialog } from './TaskDeleteDialog'
import { TaskGroupTabs } from './TaskGroupTabs'
import { TaskPreviewModal } from './TaskPreviewModal'

type TasksRouteViewProps = {
  session?: SessionStatus
  isSessionLoading: boolean
  isSessionError: boolean
  groups: GroupSummary[]
  effectiveGroupId: string
  resolvedGroupId: string | null
  isAllView: boolean
  tasks: TaskSummary[]
  isTasksLoading: boolean
  hasTaskResult: boolean
  isRefreshing: boolean
  pendingTaskIds: string[]
  selectedTaskId: string | null
  pendingDeleteTask: TaskSummary | null
  isDeleting: boolean
  isAddTaskOpen: boolean
  refresh: () => Promise<void>
  onSelectGroup: (groupId: string) => void
  onOpen: (taskId: string) => void
  onPrepareOpen: (taskId: string) => void
  onComplete: (task: TaskSummary) => void
  onDeleteRequest: (task: TaskSummary) => void
  onDeleteOccurrence: () => void
  onDeleteSeries: () => void
  onCloseDelete: () => void
  onOpenAdd: () => void
  onCloseAdd: () => void
  onClosePreview: () => void
  onPreviewComplete: (task: TaskSummary) => void
  onPreviewDelete: (task: TaskSummary) => void
}

function TasksList(props: Pick<TasksRouteViewProps, 'session' | 'isAllView' | 'tasks' | 'isTasksLoading' | 'hasTaskResult' | 'isRefreshing' | 'pendingTaskIds' | 'refresh' | 'onOpen' | 'onPrepareOpen' | 'onComplete' | 'onDeleteRequest'>) {
  if (props.isAllView) return <AllTasksView userTimezone={props.session?.timezone ?? null} onTaskOpen={props.onOpen} onTaskComplete={props.onComplete} onTaskPrepareOpen={props.onPrepareOpen} onTaskDelete={props.onDeleteRequest} busyTaskIds={props.pendingTaskIds} />
  return <PullToRefresh isRefreshing={props.isRefreshing} onRefresh={props.refresh}><GroupedOpenTaskList tasks={props.tasks} isLoading={props.isTasksLoading} hasResult={props.hasTaskResult} busyTaskIds={props.pendingTaskIds} onOpen={props.onOpen} onPrepareOpen={props.onPrepareOpen} onComplete={props.onComplete} onDelete={props.onDeleteRequest} /></PullToRefresh>
}

function TaskOverlays(props: Pick<TasksRouteViewProps, 'session' | 'groups' | 'resolvedGroupId' | 'selectedTaskId' | 'pendingTaskIds' | 'pendingDeleteTask' | 'isDeleting' | 'isAddTaskOpen' | 'refresh' | 'onDeleteOccurrence' | 'onDeleteSeries' | 'onCloseDelete' | 'onCloseAdd' | 'onClosePreview' | 'onPreviewComplete' | 'onPreviewDelete'>) {
  return (
    <>
      <EditExtractedTaskModal task={null} groups={props.groups} isOpen={props.isAddTaskOpen} onClose={props.onCloseAdd} onSave={props.refresh} csrfToken={props.session?.csrf_token ?? ''} defaultGroupId={props.resolvedGroupId ?? props.session?.inbox_group_id ?? undefined} />
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
      <button type="button" onClick={props.onOpenAdd} className="group fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-[radial-gradient(circle_at_top,_#c4b5fd_10%,_#7c3aed_90%)] text-white shadow-[0_8px_0_#4c1d95,_0_15px_20px_rgba(0,0,0,0.4),_inset_0_2px_3px_rgba(255,255,255,0.6)] transition-all duration-200 outline-none hover:-translate-y-[2px] active:translate-y-[8px]" aria-label="Add Task"><svg className="h-6 w-6 text-white/95" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" /></svg></button>
      <TaskOverlays {...props} />
    </SessionGuard>
  )
}
