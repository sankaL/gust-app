import { useMutation, type QueryClient } from '@tanstack/react-query'
import { createSubtask, deleteSubtask, updateTask, type GroupSummary, type SessionStatus, type TaskDetail } from '../lib/api'
import { dateTimeLocalToIso } from '../lib/dateTime'
import { buildTaskDetailDraft, type TaskDetailDraft } from '../lib/taskFormModel'
import { adjustGroupOpenCount, applyTaskListMutation, prependTaskToMatchingLists, restoreQuerySnapshots, snapshotTaskQueries, updateTaskDetailCache } from '../lib/taskQueryCache'
import { requireCsrfToken } from '../lib/sessionSecurity'

type ErrorSetter = (message: string | null) => void
type SnapshotContext = { snapshots?: ReturnType<typeof snapshotTaskQueries> }
type SaveMutationArgs = { queryClient: QueryClient; taskId: string | null; task?: TaskDetail; draft: TaskDetailDraft | null; groups: GroupSummary[]; session?: SessionStatus; setDraft: (draft: TaskDetailDraft) => void; setDraftTaskId: (id: string) => void; setDirty: (dirty: boolean) => void; setError: ErrorSetter; setSaveNotice: (message: string | null) => void; friendlyError: (error: unknown, fallback: string) => string }

async function cancelPreviewQueries(queryClient: QueryClient, taskId: string, includeGroups = false) {
  const cancellations = [queryClient.cancelQueries({ queryKey: ['tasks'] }), queryClient.cancelQueries({ queryKey: ['task-detail', taskId] })]
  if (includeGroups) cancellations.push(queryClient.cancelQueries({ queryKey: ['groups'] }))
  await Promise.all(cancellations)
}

function rollback(queryClient: QueryClient, context: SnapshotContext | undefined) {
  if (context?.snapshots) restoreQuerySnapshots(queryClient, context.snapshots)
}

function readySave(taskId: string | null, draft: TaskDetailDraft | null, task?: TaskDetail) {
  if (!taskId) return null
  if (!draft) return null
  if (!task) return null
  return { taskId, draft, task }
}

function nullableText(value: string) {
  return value || null
}

function selectedGroup(groups: GroupSummary[], draft: TaskDetailDraft, task: TaskDetail) {
  return groups.find((group) => group.id === draft.groupId) ?? task.group
}

function optimisticReview(task: TaskDetail, draft: TaskDetailDraft) {
  return draft.groupId === task.group.id ? task.needs_review : false
}

function recurrenceFrequency(draft: TaskDetailDraft) {
  return draft.recurrence ? draft.recurrence.frequency : null
}

function buildOptimisticTask(task: TaskDetail, draft: TaskDetailDraft, groups: GroupSummary[], timezone?: string | null): TaskDetail {
  return { ...task, title: draft.title, description: nullableText(draft.description), group: selectedGroup(groups, draft, task), due_date: nullableText(draft.dueDate), reminder_at: dateTimeLocalToIso(draft.reminderAt, timezone), recurrence: draft.recurrence, recurrence_frequency: recurrenceFrequency(draft), needs_review: optimisticReview(task, draft) }
}

function applyOptimisticTask(queryClient: QueryClient, original: TaskDetail, optimistic: TaskDetail) {
  applyTaskListMutation(queryClient, (current, status) => current.id !== original.id ? current : status === original.status ? { ...current, ...optimistic } : null)
  prependTaskToMatchingLists(queryClient, optimistic, optimistic.status)
  updateTaskDetailCache(queryClient, optimistic)
}

function adjustOptimisticGroups(queryClient: QueryClient, original: TaskDetail, optimistic: TaskDetail) {
  if (original.group.id === optimistic.group.id || original.status !== 'open') return
  adjustGroupOpenCount(queryClient, original.group.id, -1)
  adjustGroupOpenCount(queryClient, optimistic.group.id, 1)
}

async function preparePreviewSave(args: SaveMutationArgs) {
  const ready = readySave(args.taskId, args.draft, args.task)
  if (!ready) return {}
  args.setError(null)
  await cancelPreviewQueries(args.queryClient, ready.taskId, true)
  const snapshots = snapshotTaskQueries(args.queryClient, ready.taskId)
  const optimistic = buildOptimisticTask(ready.task, ready.draft, args.groups, args.session?.timezone)
  applyOptimisticTask(args.queryClient, ready.task, optimistic)
  adjustOptimisticGroups(args.queryClient, ready.task, optimistic)
  return { snapshots }
}

function requireSave(taskId: string | null, draft: TaskDetailDraft | null) {
  if (!taskId) throw new Error('Task preview is not ready.')
  if (!draft) throw new Error('Task preview is not ready.')
  return { taskId, draft }
}

function savePayload(draft: TaskDetailDraft, timezone?: string | null) {
  return { title: draft.title.trim(), description: nullableText(draft.description.trim()), group_id: draft.groupId, due_date: nullableText(draft.dueDate), reminder_at: dateTimeLocalToIso(draft.reminderAt, timezone), recurrence: draft.recurrence }
}

function usePreviewSaveMutation(args: SaveMutationArgs) {
  const { queryClient, taskId, draft, session, setDraft, setDraftTaskId, setDirty, setError, setSaveNotice, friendlyError } = args
  return useMutation({
    onMutate: () => preparePreviewSave(args),
    mutationFn: async (release: () => void) => {
      void release
      const ready = requireSave(taskId, draft)
      return updateTask(ready.taskId, savePayload(ready.draft, session?.timezone), requireCsrfToken(session))
    },
    onSuccess: (updated) => {
      setDraft(buildTaskDetailDraft(updated, session?.timezone)); setDraftTaskId(updated.id); setDirty(false)
      setSaveNotice('Changes saved')
      updateTaskDetailCache(queryClient, updated)
      void queryClient.invalidateQueries({ queryKey: ['tasks'] }); void queryClient.invalidateQueries({ queryKey: ['groups'] })
    },
    onError: (error, _variables, context) => { rollback(queryClient, context); setError(friendlyError(error, 'Task changes could not be saved.')) },
    onSettled: (_data, _error, release) => release?.(),
  })
}

function usePreviewCreateSubtaskMutation({ queryClient, taskId, task, title, session, setTitle, setError, friendlyError }: { queryClient: QueryClient; taskId: string | null; task?: TaskDetail; title: string; session?: SessionStatus; setTitle: (title: string) => void; setError: ErrorSetter; friendlyError: (error: unknown, fallback: string) => string }) {
  return useMutation({
    onMutate: async () => {
      if (!taskId || !task || !title.trim()) return {}
      setError(null); await cancelPreviewQueries(queryClient, taskId)
      const snapshots = snapshotTaskQueries(queryClient, taskId)
      updateTaskDetailCache(queryClient, { ...task, subtasks: [...task.subtasks, { id: `optimistic-${Date.now()}`, title: title.trim(), is_completed: false, completed_at: null }], subtask_count: task.subtask_count + 1 })
      applyTaskListMutation(queryClient, (current) => current.id === taskId ? { ...current, subtask_count: current.subtask_count + 1 } : current)
      return { snapshots }
    },
    mutationFn: async (release: () => void) => { void release; if (!taskId || !title.trim()) throw new Error('Subtask title is required.'); return createSubtask(taskId, title.trim(), requireCsrfToken(session)) },
    onSuccess: () => { setTitle(''); void queryClient.invalidateQueries({ queryKey: ['task-detail', taskId] }); void queryClient.invalidateQueries({ queryKey: ['tasks'] }) },
    onError: (error, _variables, context) => { rollback(queryClient, context); setError(friendlyError(error, 'Subtask could not be added.')) },
    onSettled: (_data, _error, release) => release?.(),
  })
}

function usePreviewDeleteSubtaskMutation({ queryClient, taskId, task, session, setError, friendlyError }: { queryClient: QueryClient; taskId: string | null; task?: TaskDetail; session?: SessionStatus; setError: ErrorSetter; friendlyError: (error: unknown, fallback: string) => string }) {
  return useMutation({
    onMutate: async ({ subtaskId }: { subtaskId: string; release: () => void }) => {
      if (!taskId || !task) return {}
      setError(null); await cancelPreviewQueries(queryClient, taskId)
      const snapshots = snapshotTaskQueries(queryClient, taskId)
      updateTaskDetailCache(queryClient, { ...task, subtasks: task.subtasks.filter((subtask) => subtask.id !== subtaskId), subtask_count: Math.max(0, task.subtask_count - 1) })
      applyTaskListMutation(queryClient, (current) => current.id === taskId ? { ...current, subtask_count: Math.max(0, current.subtask_count - 1) } : current)
      return { snapshots }
    },
    mutationFn: async ({ subtaskId }: { subtaskId: string; release: () => void }) => { if (!taskId) throw new Error('Task preview is not ready.'); return deleteSubtask(taskId, subtaskId, requireCsrfToken(session)) },
    onSuccess: () => { void queryClient.invalidateQueries({ queryKey: ['task-detail', taskId] }); void queryClient.invalidateQueries({ queryKey: ['tasks'] }) },
    onError: (error, _variables, context) => { rollback(queryClient, context); setError(friendlyError(error, 'Subtask could not be deleted.')) },
    onSettled: (_data, _error, variables) => variables?.release?.(),
  })
}

export function useTaskPreviewMutations(args: { queryClient: QueryClient; taskId: string | null; task?: TaskDetail; draft: TaskDetailDraft | null; groups: GroupSummary[]; session?: SessionStatus; title: string; setDraft: (draft: TaskDetailDraft) => void; setDraftTaskId: (id: string) => void; setDirty: (dirty: boolean) => void; setTitle: (title: string) => void; setError: ErrorSetter; setSaveNotice: (message: string | null) => void; friendlyError: (error: unknown, fallback: string) => string }) {
  const save = usePreviewSaveMutation(args)
  const create = usePreviewCreateSubtaskMutation(args)
  const remove = usePreviewDeleteSubtaskMutation(args)
  return { save, create, remove }
}
