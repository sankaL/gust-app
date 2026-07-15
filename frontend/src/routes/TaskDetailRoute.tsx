import { SessionGuard } from '../components/SessionGuard'
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
        <section className="space-y-5" style={{ paddingBottom: 'calc(12.5rem + var(--safe-area-bottom))' }}>
          {controller.task.isError ? <div className="rounded-card bg-[rgba(80,18,18,0.92)] p-6 text-sm text-red-100">{controller.taskErrorMessage}</div> : null}
          {controller.task.isLoading || (!controller.task.isError && (!task || !draft)) ? <div className="rounded-card bg-surface-container p-6 text-sm text-on-surface-variant">Loading task detail.</div> : null}
          {task && draft ? <TaskDetailLoaded task={task} draft={draft} groups={controller.groups.data ?? []} isEditMode={controller.isEditMode} isBusy={controller.isBusy} isGroupDropdownOpen={controller.isGroupDropdownOpen} pendingSubtaskIds={controller.pendingSubtaskIds} subtaskDrafts={controller.subtaskDrafts} newSubtaskTitle={controller.newSubtaskTitle} pendingDelete={controller.pendingDelete !== null} isDeleting={controller.removeTask.isPending} onDraft={controller.updateDraft} onGroupDropdown={controller.setIsGroupDropdownOpen} onSubtaskDrafts={controller.setSubtaskDrafts} onNewSubtaskTitle={controller.setNewSubtaskTitle} onCreateSubtask={() => controller.create.mutate()} onUpdateSubtask={(change) => controller.update.mutate(change)} onDeleteSubtask={(id) => controller.removeSubtask.mutate(id)} onDeleteScope={(scope) => controller.removeTask.mutate(scope)} onCloseDelete={() => controller.setPendingDelete(null)} /> : null}
          {task && draft ? <TaskActionDock isEditMode={controller.isEditMode} isBusy={controller.isBusy} onBack={() => void controller.goBack(false)} onSave={() => controller.save.mutate()} onEdit={() => controller.setIsEditMode(true)} onDelete={() => controller.setPendingDelete({ scope: 'occurrence' })} /> : null}
        </section>
      </PullToRefresh>
    </SessionGuard>
  )
}
