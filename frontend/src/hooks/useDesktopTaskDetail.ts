import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { createSubtask, deleteSubtask, getTaskDetail, updateSubtask, updateTask,
  type GroupSummary, type SessionStatus, type TaskDetail } from '../lib/api'
import { dateTimeLocalToIso } from '../lib/dateTime'
import { buildTaskDetailDraft, type TaskDetailDraft } from '../lib/taskFormModel'
import { applyTaskListMutation, restoreQuerySnapshots, snapshotTaskQueries, updateTaskDetailCache } from '../lib/taskQueryCache'
import { refreshTaskScreenQueries, TASK_SCREEN_GC_TIME_MS, TASK_SCREEN_STALE_TIME_MS } from '../lib/taskScreenCache'
import { requireCsrfToken } from '../lib/sessionSecurity'
import { useNotifications } from '../components/Notifications'

function message(error: unknown, fallback: string) {
  return error instanceof Error ? error.message : fallback
}

function usePendingSubtasks() {
  const [, rerender] = useState(0)
  const pending = useRef(new Set<string>())
  const mark = useCallback((id: string, value: boolean) => {
    if (value) pending.current.add(id); else pending.current.delete(id)
    rerender((current) => current + 1)
  }, [])
  const has = useCallback((id: string) => pending.current.has(id), [])
  const clear = useCallback(() => pending.current.clear(), [])
  return useMemo(() => ({ mark, has, clear }), [clear, has, mark])
}

function syncCaches(queryClient: ReturnType<typeof useQueryClient>, task: TaskDetail) {
  applyTaskListMutation(queryClient, (current, status) =>
    current.id === task.id && (status === task.status || status === 'all') ? { ...current, ...task } : current)
  updateTaskDetailCache(queryClient, task)
}

async function refreshTask(queryClient: ReturnType<typeof useQueryClient>, task: TaskDetail, previousGroupId?: string) {
  await refreshTaskScreenQueries(queryClient, { taskId: task.id, groupIds: [task.group.id, previousGroupId],
    statuses: ['open', 'completed'], includeAllOpen: true, includeAllCompleted: true,
    includeGroupedTaskLists: true, includeTaskDetails: true })
}

type Shared = { taskId: string | null; task?: TaskDetail; session?: SessionStatus; draft: TaskDetailDraft | null;
  groups: GroupSummary[]; pending: ReturnType<typeof usePendingSubtasks>; refresh: (task: TaskDetail) => void }

function useSaveTask(shared: Shared, setDraft: (draft: TaskDetailDraft) => void) {
  const client = useQueryClient(); const { notifyError, notifySuccess } = useNotifications()
  return useMutation({
    onMutate: async () => {
      const { taskId, task, draft } = shared; if (!taskId || !task || !draft) return {}
      await Promise.all([client.cancelQueries({ queryKey: ['tasks'] }), client.cancelQueries({ queryKey: ['desktop', 'tasks'] }), client.cancelQueries({ queryKey: ['task-detail', taskId] })])
      const optimistic = { ...task, title: draft.title, description: draft.description || null,
        group: shared.groups.find((group) => group.id === draft.groupId) ?? task.group,
        due_date: draft.dueDate || null, reminder_at: dateTimeLocalToIso(draft.reminderAt, shared.session?.timezone),
        recurrence: draft.recurrence, recurrence_frequency: draft.recurrence?.frequency ?? null,
        needs_review: draft.groupId !== task.group.id ? false : task.needs_review }
      const snapshots = snapshotTaskQueries(client, taskId); syncCaches(client, optimistic); return { snapshots }
    },
    mutationFn: async (release: () => void) => { void release; const { taskId, draft } = shared
      if (!taskId || !draft) throw new Error('Task detail is not ready.')
      return updateTask(taskId, { title: draft.title, description: draft.description || null, group_id: draft.groupId,
        due_date: draft.dueDate || null, reminder_at: dateTimeLocalToIso(draft.reminderAt, shared.session?.timezone), recurrence: draft.recurrence }, requireCsrfToken(shared.session)) },
    onSuccess: (task) => { syncCaches(client, task); setDraft(buildTaskDetailDraft(task, shared.session?.timezone)); notifySuccess('Task saved.'); shared.refresh(task) },
    onError: (error, _release, context) => { if (context?.snapshots) restoreQuerySnapshots(client, context.snapshots); notifyError(message(error, 'Task changes could not be saved.')) },
    onSettled: (_data, _error, release) => release?.(),
  })
}

function useCreateSubtask(shared: Shared, title: string, setTitle: (value: string) => void) {
  const client = useQueryClient(); const { notifyError, notifySuccess } = useNotifications()
  return useMutation({
    onMutate: async () => { const { taskId, task } = shared; if (!taskId || !task || !title.trim()) return {}
      await client.cancelQueries({ queryKey: ['task-detail', taskId] }); const snapshots = snapshotTaskQueries(client, taskId)
      const optimisticId = `optimistic-${Date.now()}`; shared.pending.mark(optimisticId, true)
      updateTaskDetailCache(client, { ...task, subtasks: [...task.subtasks, { id: optimisticId, title: title.trim(), is_completed: false, completed_at: null }], subtask_count: task.subtask_count + 1 })
      applyTaskListMutation(client, (current) => current.id === taskId ? { ...current, subtask_count: current.subtask_count + 1 } : current)
      return { snapshots, optimisticId } },
    mutationFn: () => { if (!shared.taskId) throw new Error('Task detail is not ready.'); return createSubtask(shared.taskId, title, requireCsrfToken(shared.session)) },
    onSuccess: (_value, _vars, context) => { if (context?.optimisticId) shared.pending.mark(context.optimisticId, false); setTitle(''); notifySuccess('Subtask added.'); if (shared.task) shared.refresh(shared.task) },
    onError: (error, _vars, context) => { restoreCreateSubtaskFailure(client, shared, context); notifyError(message(error, 'Subtask could not be added.')) },
  })
}

function restoreSnapshotsIfPresent(client: ReturnType<typeof useQueryClient>, snapshots?: ReturnType<typeof snapshotTaskQueries>) {
  if (snapshots) restoreQuerySnapshots(client, snapshots)
}

function clearOptimisticSubtaskIfPresent(shared: Shared, optimisticId?: string) {
  if (optimisticId) shared.pending.mark(optimisticId, false)
}

function restoreCreateSubtaskFailure(client: ReturnType<typeof useQueryClient>, shared: Shared, context: { snapshots?: ReturnType<typeof snapshotTaskQueries>; optimisticId?: string } | undefined) {
  restoreSnapshotsIfPresent(client, context?.snapshots)
  clearOptimisticSubtaskIfPresent(shared, context?.optimisticId)
}

function useUpdateSubtask(shared: Shared) {
  const client = useQueryClient(); const { notifyError, notifySuccess } = useNotifications()
  type Payload = { subtaskId: string; title?: string; is_completed?: boolean }
  return useMutation({
    onMutate: async (payload: Payload) => { if (!shared.taskId || !shared.task) return {}; shared.pending.mark(payload.subtaskId, true)
      await client.cancelQueries({ queryKey: ['task-detail', shared.taskId] }); const snapshots = snapshotTaskQueries(client, shared.taskId)
      const subtasks = shared.task.subtasks.map((subtask) => subtask.id !== payload.subtaskId ? subtask : { ...subtask,
        title: payload.title ?? subtask.title, is_completed: payload.is_completed ?? subtask.is_completed,
        completed_at: payload.is_completed === undefined ? subtask.completed_at : payload.is_completed ? new Date().toISOString() : null })
      updateTaskDetailCache(client, { ...shared.task, subtasks }); return { snapshots } },
    mutationFn: (payload: Payload) => { if (!shared.taskId) throw new Error('Task detail is not ready.'); return updateSubtask(shared.taskId, payload.subtaskId, payload, requireCsrfToken(shared.session)) },
    onSuccess: (_value, payload) => { shared.pending.mark(payload.subtaskId, false); notifySuccess('Subtask updated.'); if (shared.task) shared.refresh(shared.task) },
    onError: (error, payload, context) => { if (context?.snapshots) restoreQuerySnapshots(client, context.snapshots); shared.pending.mark(payload.subtaskId, false); notifyError(message(error, 'Subtask could not be updated.')) },
  })
}

function useDeleteSubtask(shared: Shared) {
  const client = useQueryClient(); const { notifyError, notifySuccess } = useNotifications()
  return useMutation({
    onMutate: async (id: string) => { if (!shared.taskId || !shared.task) return {}; shared.pending.mark(id, true)
      await client.cancelQueries({ queryKey: ['task-detail', shared.taskId] }); const snapshots = snapshotTaskQueries(client, shared.taskId)
      updateTaskDetailCache(client, { ...shared.task, subtasks: shared.task.subtasks.filter((item) => item.id !== id), subtask_count: Math.max(0, shared.task.subtask_count - 1) })
      applyTaskListMutation(client, (current) => current.id === shared.taskId ? { ...current, subtask_count: Math.max(0, current.subtask_count - 1) } : current)
      return { snapshots } },
    mutationFn: (id: string) => { if (!shared.taskId) throw new Error('Task detail is not ready.'); return deleteSubtask(shared.taskId, id, requireCsrfToken(shared.session)) },
    onSuccess: (_value, id) => { shared.pending.mark(id, false); notifySuccess('Subtask deleted.'); if (shared.task) shared.refresh(shared.task) },
    onError: (error, id, context) => { if (context?.snapshots) restoreQuerySnapshots(client, context.snapshots); shared.pending.mark(id, false); notifyError(message(error, 'Subtask could not be deleted.')) },
  })
}

export function useDesktopTaskDetail(taskId: string | null, isOpen: boolean, session: SessionStatus | undefined, groups: GroupSummary[]) {
  const client = useQueryClient(); const pending = usePendingSubtasks()
  const [draft, setDraft] = useState<TaskDetailDraft | null>(null); const [newTitle, setNewTitle] = useState('')
  const [subtaskDrafts, setSubtaskDrafts] = useState<Record<string, string>>({})
  const query = useQuery({ queryKey: ['task-detail', taskId], queryFn: () => getTaskDetail(taskId as string), enabled: isOpen && Boolean(taskId), staleTime: TASK_SCREEN_STALE_TIME_MS, gcTime: TASK_SCREEN_GC_TIME_MS })
  useEffect(() => { setDraft(null); setNewTitle(''); setSubtaskDrafts({}); pending.clear() }, [pending, taskId])
  useEffect(() => { if (!query.data) return; setDraft((current) => current ?? buildTaskDetailDraft(query.data, session?.timezone)); setSubtaskDrafts((current) => Object.fromEntries(query.data.subtasks.map((item) => [item.id, current[item.id] ?? item.title]))) }, [query.data, session?.timezone])
  const shared: Shared = { taskId, task: query.data, session, draft, groups, pending,
    refresh: (task) => { void refreshTask(client, task, draft?.groupId) } }
  return { query, draft, setDraft, newTitle, setNewTitle, subtaskDrafts, setSubtaskDrafts, pending,
    save: useSaveTask(shared, setDraft), createSubtask: useCreateSubtask(shared, newTitle, setNewTitle),
    updateSubtask: useUpdateSubtask(shared), deleteSubtask: useDeleteSubtask(shared) }
}
