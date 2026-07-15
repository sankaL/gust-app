import type { GroupSummary, SessionStatus, TaskSummary } from '../lib/api'
import { CompletedTaskList } from './CompletedTaskList'
import { PullToRefresh } from './TaskScreenRefresh'
import { SessionGuard } from './SessionGuard'
import { TaskPreviewModal } from './TaskPreviewModal'
import { TaskRestoreDialog } from './TaskRestoreDialog'

function completedDescription(allGroups: boolean) {
  return allGroups
    ? 'Review completed tasks across every group and move them back to To-do when needed.'
    : 'Review completed tasks and move them back to To-do when needed.'
}

function CompletedTaskOverlays({
  session,
  groups,
  selectedTaskId,
  pendingTaskIds,
  restoreCandidate,
  isRestoring,
  onClosePreview,
  onRequestRestore,
  onConfirmRestore,
  onCancelRestore,
}: {
  session?: SessionStatus
  groups: GroupSummary[]
  selectedTaskId: string | null
  pendingTaskIds: string[]
  restoreCandidate: TaskSummary | null
  isRestoring: boolean
  onClosePreview: () => void
  onRequestRestore: (task: TaskSummary) => void
  onConfirmRestore: () => void
  onCancelRestore: () => void
}) {
  function restoreFromPreview(task: TaskSummary) {
    onRequestRestore(task)
    onClosePreview()
  }
  return <><TaskPreviewModal taskId={selectedTaskId} isOpen={Boolean(selectedTaskId)} onClose={onClosePreview} onRestore={restoreFromPreview} busyTaskIds={pendingTaskIds} session={session} groups={groups} /><TaskRestoreDialog isOpen={restoreCandidate !== null} taskTitle={restoreCandidate?.title ?? ''} isRestoring={isRestoring} onRestore={onConfirmRestore} onClose={onCancelRestore} /></>
}

export function CompletedTasksRouteView({
  session,
  groups,
  tasks,
  selectedTaskId,
  pendingTaskIds,
  restoreCandidate,
  isSessionLoading,
  isSessionError,
  isAllGroupsView,
  isTasksLoading,
  hasTaskResult,
  isRefreshing,
  isRestoring,
  refresh,
  onOpen,
  onClosePreview,
  onRequestRestore,
  onConfirmRestore,
  onCancelRestore,
}: {
  session?: SessionStatus
  groups: GroupSummary[]
  tasks: TaskSummary[]
  selectedTaskId: string | null
  pendingTaskIds: string[]
  restoreCandidate: TaskSummary | null
  isSessionLoading: boolean
  isSessionError: boolean
  isAllGroupsView: boolean
  isTasksLoading: boolean
  hasTaskResult: boolean
  isRefreshing: boolean
  isRestoring: boolean
  refresh: () => Promise<void>
  onOpen: (taskId: string) => void
  onClosePreview: () => void
  onRequestRestore: (task: TaskSummary) => void
  onConfirmRestore: () => void
  onCancelRestore: () => void
}) {
  return (
    <SessionGuard session={session} isLoading={isSessionLoading} isError={isSessionError} title="Completed Tasks" eyebrow="Completed history" description={completedDescription(isAllGroupsView)}>
      <PullToRefresh isRefreshing={isRefreshing} onRefresh={refresh}><CompletedTaskList tasks={tasks} isLoading={isTasksLoading} hasResult={hasTaskResult} pendingTaskIds={pendingTaskIds} onOpen={onOpen} onRestore={onRequestRestore} /></PullToRefresh>
      <CompletedTaskOverlays session={session} groups={groups} selectedTaskId={selectedTaskId} pendingTaskIds={pendingTaskIds} restoreCandidate={restoreCandidate} isRestoring={isRestoring} onClosePreview={onClosePreview} onRequestRestore={onRequestRestore} onConfirmRestore={onConfirmRestore} onCancelRestore={onCancelRestore} />
    </SessionGuard>
  )
}
