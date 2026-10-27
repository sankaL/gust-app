import { ScreenHeader } from '../components/AppShellView'
import { SessionGuard } from '../components/SessionGuard'
import { InlineNotice } from '../components/ui/controls'
import { PullToRefresh } from '../components/TaskScreenRefresh'
import { TaskActionDock, TaskDetailLoaded } from './task-detail/TaskDetailView'
import { useTaskDetailController } from './task-detail/useTaskDetailController'

export function TaskDetailRoute() {
  const controller = useTaskDetailController()
  const task = controller.task.data
  const draft = controller.draft
  return (
    <SessionGuard session={controller.session.data} isLoading={controller.session.isLoading} isError={controller.session.isError} title="Task Detail" eyebrow="Focused editing" description="Refine the title, group, dates, reminders, and subtasks for a single task.">
      <PullToRefresh isRefreshing={controller.refreshing} onRefresh={controller.refresh}>
        <ScreenHeader eyebrow={controller.isEditMode ? 'Editing' : 'Task'} title="Details" />
        <section className="space-y-4 pt-3" style={{ paddingBottom: 'calc(4rem + var(--safe-area-bottom))' }}>
          {controller.task.isError ? <InlineNotice tone="error" role="alert">{controller.taskErrorMessage}</InlineNotice> : null}
          {controller.task.isLoading || (!controller.task.isError && (!task || !draft)) ? <div aria-busy="true"><span className="sr-only">Loading task detail.</span><div className="skeleton-shimmer h-64 rounded-[1.6rem]" /></div> : null}
          {task && draft ? <TaskDetailLoaded task={task} draft={draft} groups={controller.groups.data ?? []} isEditMode={controller.isEditMode} isBusy={controller.isBusy} isGroupDropdownOpen={controller.isGroupDropdownOpen} pendingSubtaskIds={controller.pendingSubtaskIds} subtaskDrafts={controller.subtaskDrafts} newSubtaskTitle={controller.newSubtaskTitle} pendingDelete={controller.pendingDelete !== null} isDeleting={controller.removeTask.isPending} onDraft={controller.updateDraft} onGroupDropdown={controller.setIsGroupDropdownOpen} onSubtaskDrafts={controller.setSubtaskDrafts} onNewSubtaskTitle={controller.setNewSubtaskTitle} onCreateSubtask={() => controller.create.mutate()} onUpdateSubtask={(change) => controller.update.mutate(change)} onDeleteSubtask={(id) => controller.removeSubtask.mutate(id)} onDeleteScope={(scope) => controller.removeTask.mutate(scope)} onCloseDelete={() => controller.setPendingDelete(null)} /> : null}
          {task && draft ? <TaskActionDock isEditMode={controller.isEditMode} isBusy={controller.isBusy} onBack={() => void controller.goBack(false)} onSave={() => controller.save.mutate()} onEdit={() => controller.setIsEditMode(true)} onDelete={() => controller.setPendingDelete({ scope: 'occurrence' })} /> : null}
        </section>
      </PullToRefresh>
    </SessionGuard>
  )
}
