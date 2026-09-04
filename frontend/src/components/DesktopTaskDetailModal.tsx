import { useEffect, useState, type ReactNode } from 'react'

import type { GroupSummary, SessionStatus, TaskDetail } from '../lib/api'
import { useDesktopTaskDetail } from '../hooks/useDesktopTaskDetail'
import { acquireTaskMutationLock, isTaskMutationLocked } from '../lib/taskMutationLocks'
import { useNotifications } from './Notifications'
import { TaskDetailFields, TaskDetailFooter, TaskDetailHeader, TaskDetailSubtasks } from './DesktopTaskDetailView'

type Props = { taskId: string | null; isOpen: boolean; onClose?: () => void; session: SessionStatus | undefined;
  groups: GroupSummary[]; mode?: 'modal' | 'page'; onComplete?: (task: TaskDetail) => void;
  onRestore?: (task: TaskDetail) => void; busyTaskIds?: string[] }

function TaskDetailEditor({ controller, groups, groupOpen, setGroupOpen, busyTaskIds, onComplete, onRestore }: {
  controller: ReturnType<typeof useDesktopTaskDetail>; groups: GroupSummary[]; groupOpen: boolean;
  setGroupOpen: (value: boolean) => void; busyTaskIds: string[]; onComplete?: (task: TaskDetail) => void;
  onRestore?: (task: TaskDetail) => void }) {
  const { notifyError } = useNotifications()
  const { query, draft, setDraft, pending } = controller
  if (query.isError) return <div className="rounded-card bg-red-950 p-4 text-red-100">Task detail could not be loaded.</div>
  if (query.isLoading || !draft || !query.data) return <div className="h-72 animate-pulse rounded-card bg-surface-container-high" aria-busy="true" />
  const busy = controller.save.isPending || controller.createSubtask.isPending || controller.updateSubtask.isPending || controller.deleteSubtask.isPending
  const task = query.data
  const save = () => {
    const release = acquireTaskMutationLock(task.id)
    if (release) controller.save.mutate(release); else notifyError('Task is already updating.')
  }
  const actionBusy = busyTaskIds.includes(task.id) || isTaskMutationLocked(task.id)
  return <><div className="grid gap-6 px-6 py-5 xl:grid-cols-[minmax(0,1.05fr)_minmax(24rem,0.95fr)]"><TaskDetailFields draft={draft} originalDueDate={task.due_date} groups={groups} groupOpen={groupOpen} setGroupOpen={setGroupOpen} disabled={busy || actionBusy} update={(updater) => setDraft(updater(draft))} /><TaskDetailSubtasks task={task} drafts={controller.subtaskDrafts} setDraft={(id, value) => controller.setSubtaskDrafts((current) => ({ ...current, [id]: value }))} newTitle={controller.newTitle} setNewTitle={controller.setNewTitle} create={() => controller.createSubtask.mutate()} disabled={busy || actionBusy} actions={{ pending: pending.has, mark: pending.mark, update: (payload) => controller.updateSubtask.mutate(payload), remove: (id) => controller.deleteSubtask.mutate(id) }} /></div><TaskDetailFooter task={task} title={draft.title} busy={busy || actionBusy} actionBusy={actionBusy} onComplete={onComplete} onRestore={onRestore} onSave={save} /></>
}

function TaskDetailSurface({ modal, children, onClose }: { modal: boolean; children: ReactNode; onClose?: () => void }) {
  if (!modal) return <section className="overflow-hidden rounded-soft bg-surface-container shadow-ambient">{children}</section>
  return <div className="fixed inset-0 z-[120] flex items-center justify-center bg-black/65 p-5 backdrop-blur-md" role="dialog" aria-modal="true" aria-labelledby="desktop-task-editor-title" onMouseDown={(event) => { if (event.target === event.currentTarget) onClose?.() }}><div className="max-h-[90dvh] w-full max-w-6xl overflow-y-auto rounded-[1.35rem] bg-surface-container shadow-ambient">{children}</div></div>
}

export function DesktopTaskDetailModal({ taskId, isOpen, onClose, session, groups, mode = 'modal', onComplete, onRestore, busyTaskIds = [] }: Props) {
  const [groupOpen, setGroupOpen] = useState(false)
  const controller = useDesktopTaskDetail(taskId, isOpen, session, groups)
  const modal = mode === 'modal'
  useEffect(() => {
    if (!isOpen || !modal) return undefined
    const close = (event: KeyboardEvent) => { if (event.key === 'Escape') onClose?.() }
    document.addEventListener('keydown', close); return () => document.removeEventListener('keydown', close)
  }, [isOpen, modal, onClose])
  if (!isOpen || !taskId) return null
  return <TaskDetailSurface modal={modal} onClose={onClose}><TaskDetailHeader taskId={taskId} task={controller.query.data} draft={controller.draft} modal={modal} onClose={onClose} /><TaskDetailEditor controller={controller} groups={groups} groupOpen={groupOpen} setGroupOpen={setGroupOpen} busyTaskIds={busyTaskIds} onComplete={onComplete} onRestore={onRestore} /></TaskDetailSurface>
}
