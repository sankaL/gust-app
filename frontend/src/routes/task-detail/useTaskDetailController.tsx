import { useCallback, useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useLocation, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { useAppShellActions } from '../../components/AppShellActions'
import { useNotifications } from '../../components/Notifications'
import { TaskScreenRefreshButton } from '../../components/TaskScreenRefresh'
import { ApiError, createSubtask, deleteSubtask, deleteTask, getSessionStatus, getTaskDetail, listGroups, restoreTask, updateSubtask, updateTask, type TaskDeleteScope, type TaskDetail } from '../../lib/api'
import { adjustGroupOpenCount, applyTaskListMutation, prependTaskToMatchingLists, restoreQuerySnapshots, snapshotTaskQueries, updateTaskDetailCache } from '../../lib/taskQueryCache'
import { refreshTaskScreenQueries, TASK_SCREEN_GC_TIME_MS, TASK_SCREEN_STALE_TIME_MS } from '../../lib/taskScreenCache'
import { requireCsrfToken } from '../../lib/sessionSecurity'
import type { SubtaskChange, TaskDetailDraft } from './TaskDetailView'

function friendly(error: unknown, fallback: string) {
  return error instanceof ApiError ? error.message : fallback
}

function localDateTime(value: string | null) {
  if (!value) return ''
  const date = new Date(value)
  return new Date(date.getTime() - date.getTimezoneOffset() * 60000).toISOString().slice(0, 16)
}

function buildDraft(task: TaskDetail): TaskDetailDraft {
  return { title: task.title, description: task.description ?? '', groupId: task.group.id, dueDate: task.due_date ?? '', reminderAt: localDateTime(task.reminder_at), recurrence: task.recurrence }
}

function returnPath(pathname: string, search: URLSearchParams) {
  if (pathname.startsWith('/desktop/')) return '/desktop/tasks'
  const group = search.get('group')
  return group ? `/tasks?${new URLSearchParams({ group })}` : '/tasks'
}

function canLoadTask(signedIn: boolean | undefined, taskId: string | undefined) {
  return signedIn === true && Boolean(taskId)
}

function canLoadGroups(signedIn: boolean | undefined, editMode: boolean, needsReview: boolean | undefined) {
  return signedIn === true && (editMode || Boolean(needsReview))
}

function queriesAreRefreshing(task: { isFetching: boolean; isLoading: boolean }, groups: { isFetching: boolean; isLoading: boolean }) {
  return (task.isFetching && !task.isLoading) || (groups.isFetching && !groups.isLoading)
}

function useTaskRouteNavigation() {
  const { taskId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  const [search] = useSearchParams()
  const goBack = useCallback((replace = false) => navigate(returnPath(location.pathname, search), { replace }), [location.pathname, navigate, search])
  return { taskId, goBack }
}

function useSessionTask(taskId: string | undefined) {
  const session = useQuery({ queryKey: ['session-status'], queryFn: getSessionStatus, retry: false })
  const task = useQuery({ queryKey: ['task-detail', taskId], queryFn: () => getTaskDetail(taskId!), enabled: canLoadTask(session.data?.signed_in, taskId), staleTime: TASK_SCREEN_STALE_TIME_MS, gcTime: TASK_SCREEN_GC_TIME_MS })
  return { session, task }
}

function preserveDraft(current: TaskDetailDraft | null, task: TaskDetail) {
  return current ?? buildDraft(task)
}

function mergeSubtaskDrafts(current: Record<string, string>, task: TaskDetail) {
  return Object.fromEntries(task.subtasks.map((item) => [item.id, current[item.id] ?? item.title]))
}

function useTaskDetailState(taskId: string | undefined, task: TaskDetail | undefined) {
  const [draft, setDraft] = useState<TaskDetailDraft | null>(null); const [isEditMode, setIsEditMode] = useState(false)
  const [newSubtaskTitle, setNewSubtaskTitle] = useState(''); const [subtaskDrafts, setSubtaskDrafts] = useState<Record<string, string>>({})
  const [pendingSubtaskIds, setPendingSubtaskIds] = useState<string[]>([]); const [isGroupDropdownOpen, setIsGroupDropdownOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<{ scope: TaskDeleteScope } | null>(null)
  useEffect(() => { setDraft(null); setSubtaskDrafts({}); setNewSubtaskTitle(''); setIsEditMode(false); setIsGroupDropdownOpen(false) }, [taskId])
  useEffect(() => {
    if (!task) return
    setDraft((current) => preserveDraft(current, task))
    setSubtaskDrafts((current) => mergeSubtaskDrafts(current, task))
    setIsEditMode((current) => current || task.needs_review)
  }, [task])
  return { draft, setDraft, isEditMode, setIsEditMode, newSubtaskTitle, setNewSubtaskTitle, subtaskDrafts, setSubtaskDrafts, pendingSubtaskIds, setPendingSubtaskIds, isGroupDropdownOpen, setIsGroupDropdownOpen, pendingDelete, setPendingDelete }
}

function useTaskGroups(signedIn: boolean | undefined, editMode: boolean, needsReview: boolean | undefined) {
  return useQuery({ queryKey: ['groups'], queryFn: listGroups, enabled: canLoadGroups(signedIn, editMode, needsReview), staleTime: TASK_SCREEN_STALE_TIME_MS, gcTime: TASK_SCREEN_GC_TIME_MS })
}

function useTaskRefresh(taskId: string | undefined, groupId: string | undefined, task: { isFetching: boolean; isLoading: boolean }, groups: { isFetching: boolean; isLoading: boolean }) {
  const queryClient = useQueryClient()
  const shell = useAppShellActions()
  const refresh = useCallback((groupIds: Array<string | null | undefined> = [groupId]) => refreshTaskScreenQueries(queryClient, { taskId, groupIds, statuses: ['open', 'completed'], includeAllOpen: true, includeAllCompleted: true }), [groupId, queryClient, taskId])
  const refreshing = queriesAreRefreshing(task, groups)
  useEffect(() => { shell?.setTopBarAction(<TaskScreenRefreshButton isRefreshing={refreshing} label="Refresh task" onRefresh={refresh} />); return () => shell?.setTopBarAction(null) }, [refresh, refreshing, shell])
  return { queryClient, refresh, refreshing }
}

function useTaskDetailBase() {
  const route = useTaskRouteNavigation()
  const queries = useSessionTask(route.taskId)
  const state = useTaskDetailState(route.taskId, queries.task.data)
  const groups = useTaskGroups(queries.session.data?.signed_in, state.isEditMode, queries.task.data?.needs_review)
  const refresh = useTaskRefresh(route.taskId, queries.task.data?.group.id, queries.task, groups)
  return { taskId: route.taskId, goBack: route.goBack, session: queries.session, task: queries.task, groups, ...state, ...refresh }
}

type Base = ReturnType<typeof useTaskDetailBase>

function markPending(base: Base, id: string, pending: boolean) {
  base.setPendingSubtaskIds((current) => pending ? (current.includes(id) ? current : [...current, id]) : current.filter((value) => value !== id))
}

function syncCaches(base: Base, task: TaskDetail) {
  applyTaskListMutation(base.queryClient, (current, status) => current.id !== task.id ? current : status === task.status ? { ...current, ...task } : null)
  prependTaskToMatchingLists(base.queryClient, task, task.status); updateTaskDetailCache(base.queryClient, task)
}

function adjustMovedGroupCounts(base: Base, previous: TaskDetail, optimistic: TaskDetail) {
  if (previous.group.id === optimistic.group.id || previous.status !== 'open') return
  adjustGroupOpenCount(base.queryClient, previous.group.id, -1)
  adjustGroupOpenCount(base.queryClient, optimistic.group.id, 1)
}

type TaskQuerySnapshots = ReturnType<typeof snapshotTaskQueries>
type CreateSubtaskContext = { snapshots?: TaskQuerySnapshots; optimisticId?: string }

function restoreSnapshots(base: Base, snapshots: TaskQuerySnapshots | undefined) {
  if (snapshots) restoreQuerySnapshots(base.queryClient, snapshots)
}

function clearOptimisticPending(base: Base, optimisticId: string | undefined) {
  if (optimisticId) markPending(base, optimisticId, false)
}

function rollbackCreateSubtask(base: Base, context: CreateSubtaskContext | undefined) {
  if (!context) return
  restoreSnapshots(base, context.snapshots)
  clearOptimisticPending(base, context.optimisticId)
}

function nextCompletedAt(item: TaskDetail['subtasks'][number], change: SubtaskChange) {
  if (change.is_completed === undefined) return item.completed_at
  return change.is_completed ? new Date().toISOString() : null
}

function applySubtaskChange(item: TaskDetail['subtasks'][number], change: SubtaskChange) {
  if (item.id !== change.subtaskId) return item
  return {
    ...item,
    title: change.title ?? item.title,
    is_completed: change.is_completed ?? item.is_completed,
    completed_at: nextCompletedAt(item, change),
  }
}

function nullable(value: string) {
  return value || null
}

function reminderIso(value: string) {
  if (!value) return null
  return new Date(value).toISOString()
}

function readyTaskDraft(base: Base) {
  if (!base.taskId) throw new Error('Task detail is not ready.')
  if (!base.draft) throw new Error('Task detail is not ready.')
  return { taskId: base.taskId, draft: base.draft }
}

function saveTask(base: Base) {
  const { taskId, draft } = readyTaskDraft(base)
  const payload = { title: draft.title, description: nullable(draft.description), group_id: draft.groupId, due_date: nullable(draft.dueDate), reminder_at: reminderIso(draft.reminderAt), recurrence: draft.recurrence }
  return updateTask(taskId, payload, requireCsrfToken(base.session.data))
}

function useSaveTask(base: Base, notices: ReturnType<typeof useNotifications>) {
  return useMutation({
    mutationFn: () => saveTask(base),
    onSuccess: async (task) => { const previous = base.task.data; if (previous) adjustMovedGroupCounts(base, previous, task); syncCaches(base, task); notices.notifySuccess('Task saved.'); await base.goBack(true); void base.refresh([previous?.group.id, task.group.id]) },
    onError: (error) => notices.notifyError(friendly(error, 'Task changes could not be saved.')),
  })
}

function useCreateSubtask(base: Base, notices: ReturnType<typeof useNotifications>) {
  return useMutation({
    onMutate: async () => {
      if (!base.taskId || !base.task.data || !base.newSubtaskTitle.trim()) return {}
      await base.queryClient.cancelQueries({ queryKey: ['task-detail', base.taskId] }); const snapshots = snapshotTaskQueries(base.queryClient, base.taskId); const optimisticId = `optimistic-${Date.now()}`
      markPending(base, optimisticId, true); updateTaskDetailCache(base.queryClient, { ...base.task.data, subtasks: [...base.task.data.subtasks, { id: optimisticId, title: base.newSubtaskTitle.trim(), is_completed: false, completed_at: null }] })
      applyTaskListMutation(base.queryClient, (task) => task.id === base.taskId ? { ...task, subtask_count: task.subtask_count + 1 } : task)
      return { snapshots, optimisticId }
    },
    mutationFn: () => { if (!base.taskId) throw new Error('Task detail is not ready.'); return createSubtask(base.taskId, base.newSubtaskTitle, requireCsrfToken(base.session.data)) },
    onSuccess: (_item, _value, context) => { if (context?.optimisticId) markPending(base, context.optimisticId, false); base.setNewSubtaskTitle(''); notices.notifySuccess('Subtask added.'); void base.refresh() },
    onError: (error, _value, context) => { rollbackCreateSubtask(base, context); notices.notifyError(friendly(error, 'Subtask could not be added.')) },
  })
}

function useUpdateSubtask(base: Base, notices: ReturnType<typeof useNotifications>) {
  return useMutation({
    onMutate: async (change: SubtaskChange) => {
      if (!base.taskId || !base.task.data) return {}
      markPending(base, change.subtaskId, true); await base.queryClient.cancelQueries({ queryKey: ['task-detail', base.taskId] }); const snapshots = snapshotTaskQueries(base.queryClient, base.taskId)
      const subtasks = base.task.data.subtasks.map((item) => applySubtaskChange(item, change))
      updateTaskDetailCache(base.queryClient, { ...base.task.data, subtasks }); return { snapshots }
    },
    mutationFn: (change: SubtaskChange) => { if (!base.taskId) throw new Error('Task detail is not ready.'); return updateSubtask(base.taskId, change.subtaskId, change, requireCsrfToken(base.session.data)) },
    onSuccess: (_item, change) => { markPending(base, change.subtaskId, false); notices.notifySuccess('Subtask updated.'); void base.refresh() },
    onError: (error, change, context) => { if (context?.snapshots) restoreQuerySnapshots(base.queryClient, context.snapshots); markPending(base, change.subtaskId, false); notices.notifyError(friendly(error, 'Subtask could not be updated.')) },
  })
}

function useDeleteSubtask(base: Base, notices: ReturnType<typeof useNotifications>) {
  return useMutation({
    onMutate: async (id: string) => {
      if (!base.taskId || !base.task.data) return {}
      markPending(base, id, true); await base.queryClient.cancelQueries({ queryKey: ['task-detail', base.taskId] }); const snapshots = snapshotTaskQueries(base.queryClient, base.taskId)
      updateTaskDetailCache(base.queryClient, { ...base.task.data, subtasks: base.task.data.subtasks.filter((item) => item.id !== id) })
      applyTaskListMutation(base.queryClient, (task) => task.id === base.taskId ? { ...task, subtask_count: Math.max(0, task.subtask_count - 1) } : task); return { snapshots }
    },
    mutationFn: (id: string) => { if (!base.taskId) throw new Error('Task detail is not ready.'); return deleteSubtask(base.taskId, id, requireCsrfToken(base.session.data)) },
    onSuccess: (_item, id) => { markPending(base, id, false); notices.notifySuccess('Subtask deleted.'); void base.refresh() },
    onError: (error, id, context) => { if (context?.snapshots) restoreQuerySnapshots(base.queryClient, context.snapshots); markPending(base, id, false); notices.notifyError(friendly(error, 'Subtask could not be deleted.')) },
  })
}

function useDeleteTask(base: Base, notices: ReturnType<typeof useNotifications>) {
  const restoreDeleted = async (id: string, title: string, notificationId: string, csrf: string) => {
    notices.updateNotification(notificationId, { type: 'loading', message: `Restoring ${title}...`, actionLabel: undefined, onAction: undefined, dismissible: false, durationMs: null })
    try { const task = await restoreTask(id, csrf); adjustGroupOpenCount(base.queryClient, task.group.id, 1); syncCaches(base, task); notices.dismissNotification(notificationId); notices.notifySuccess(`Restored ${title}.`); await base.refresh([task.group.id]) }
    catch (error) { notices.updateNotification(notificationId, { type: 'error', message: friendly(error, 'Task could not be restored.'), dismissible: true, durationMs: 3000 }) }
  }
  return useMutation({
    onMutate: async (scope: TaskDeleteScope) => {
      if (!base.taskId || !base.task.data) return { scope }
      await Promise.all([base.queryClient.cancelQueries({ queryKey: ['tasks'] }), base.queryClient.cancelQueries({ queryKey: ['groups'] }), base.queryClient.cancelQueries({ queryKey: ['task-detail', base.taskId] })]); const snapshots = snapshotTaskQueries(base.queryClient, base.taskId)
      applyTaskListMutation(base.queryClient, (task) => task.id === base.taskId ? null : task); if (base.task.data.status === 'open') adjustGroupOpenCount(base.queryClient, base.task.data.group.id, -1)
      updateTaskDetailCache(base.queryClient, { ...base.task.data, deleted_at: new Date().toISOString() }); return { snapshots, scope }
    },
    mutationFn: (scope: TaskDeleteScope) => { if (!base.taskId) throw new Error('Task detail is not ready.'); return deleteTask(base.taskId, requireCsrfToken(base.session.data), scope) },
    onSuccess: async () => {
      base.setPendingDelete(null); const title = base.task.data?.title ?? 'task'; const id = base.taskId!; const csrf = requireCsrfToken(base.session.data)
      const notificationId = notices.showNotification({ type: 'warning', message: `Deleted ${title}`, actionLabel: 'Undo', onAction: () => restoreDeleted(id, title, notificationId, csrf) })
      await base.refresh(); await base.goBack(true)
    },
    onError: (error, _scope, context) => { if (context?.snapshots) restoreQuerySnapshots(base.queryClient, context.snapshots); notices.notifyError(friendly(error, 'Task could not be deleted.')); base.setPendingDelete(null) },
  })
}

export function useTaskDetailController() {
  const base = useTaskDetailBase(); const notices = useNotifications()
  const save = useSaveTask(base, notices); const create = useCreateSubtask(base, notices); const update = useUpdateSubtask(base, notices); const removeSubtask = useDeleteSubtask(base, notices); const removeTask = useDeleteTask(base, notices)
  const isBusy = save.isPending || create.isPending || update.isPending || removeSubtask.isPending || removeTask.isPending
  const updateDraft = (change: Partial<TaskDetailDraft>) => base.setDraft((current) => current ? { ...current, ...change } : current)
  return { ...base, save, create, update, removeSubtask, removeTask, isBusy, updateDraft, taskErrorMessage: friendly(base.task.error, 'Task detail could not be loaded.') }
}
