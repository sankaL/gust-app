import { useCallback, useEffect, useRef, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { ApiError, getTaskDetail, type GroupSummary, type SessionStatus, type TaskDetail } from '../lib/api'
import { useTaskPreviewMutations } from '../hooks/useTaskPreviewMutations'
import { buildTaskDetailDraft, type TaskDetailDraft } from '../lib/taskFormModel'
import { TASK_SCREEN_GC_TIME_MS, TASK_SCREEN_STALE_TIME_MS } from '../lib/taskScreenCache'
import { TaskPreviewView } from './TaskPreviewView'

type TaskPreviewModalProps = {
  taskId: string | null
  isOpen: boolean
  onClose: () => void
  onComplete?: (task: TaskDetail) => void
  onRestore?: (task: TaskDetail) => void
  onRequestDelete?: (task: TaskDetail) => void
  busyTaskIds?: string[]
  session?: SessionStatus
  groups?: GroupSummary[]
}

function buildFriendlyMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError || error instanceof Error) return error.message
  return fallback
}

function useLocalMutationLock(setError: (message: string) => void) {
  const lockRef = useRef(false)
  const [isLocked, setIsLocked] = useState(false)
  const acquire = useCallback(() => {
    if (lockRef.current) { setError('Task is already updating.'); return null }
    lockRef.current = true; setIsLocked(true)
    return () => { lockRef.current = false; setIsLocked(false) }
  }, [setError])
  return { isLocked, acquire }
}

function usePreviewDraftSync({ isOpen, task, timezone, draftTaskId, isDirty, setDraft, setDraftTaskId, setDirty, setTitle, setError }: { isOpen: boolean; task?: TaskDetail; timezone?: string; draftTaskId: string | null; isDirty: boolean; setDraft: (draft: TaskDetailDraft | null) => void; setDraftTaskId: (id: string | null) => void; setDirty: (dirty: boolean) => void; setTitle: (title: string) => void; setError: (error: string | null) => void }) {
  useEffect(() => {
    if (!isOpen) { setDraft(null); setDraftTaskId(null); setDirty(false); setTitle(''); setError(null); return }
    if (task && (draftTaskId !== task.id || !isDirty)) { setDraft(buildTaskDetailDraft(task, timezone)); setDraftTaskId(task.id); setDirty(false); setError(null) }
  }, [draftTaskId, isDirty, isOpen, setDirty, setDraft, setDraftTaskId, setError, setTitle, task, timezone])
}

function useEscapeClose(isOpen: boolean, requestClose: () => void) {
  useEffect(() => {
    if (!isOpen) return undefined
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') requestClose() }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, requestClose])
}

function usePreviewRequests({ draft, task, isBusy, mutationPending, isDirty, title, acquire, onClose, onComplete, onRestore, onDelete, save, create, remove }: { draft: TaskDetailDraft | null; task?: TaskDetail; isBusy: boolean; mutationPending: boolean; isDirty: boolean; title: string; acquire: () => (() => void) | null; onClose: () => void; onComplete?: (task: TaskDetail) => void; onRestore?: (task: TaskDetail) => void; onDelete?: (task: TaskDetail) => void; save: (release: () => void) => void; create: (release: () => void) => void; remove: (variables: { subtaskId: string; release: () => void }) => void }) {
  const close = useCallback(() => { if (!mutationPending && (!isDirty || window.confirm('Discard unsaved task changes?'))) onClose() }, [isDirty, mutationPending, onClose])
  function run(action: (() => void) | undefined) { if (!isBusy && action && (!isDirty || window.confirm('Discard unsaved task changes?'))) action() }
  function saveTask() { if (!isBusy && draft?.title.trim()) { const release = acquire(); if (release) save(release) } }
  function createSubtask() { if (!isBusy && title.trim()) { const release = acquire(); if (release) create(release) } }
  function deleteSubtask(subtaskId: string) { if (!isBusy) { const release = acquire(); if (release) remove({ subtaskId, release }) } }
  return { close, saveTask, createSubtask, deleteSubtask, complete: task && onComplete ? () => run(() => onComplete(task)) : undefined, restore: task && onRestore ? () => run(() => onRestore(task)) : undefined, deleteTask: task && onDelete ? () => run(() => onDelete(task)) : undefined }
}

function usePreviewState() {
  const [draft, setDraft] = useState<TaskDetailDraft | null>(null)
  const [draftTaskId, setDraftTaskId] = useState<string | null>(null)
  const [isDraftDirty, setIsDraftDirty] = useState(false)
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('')
  const [saveError, setSaveError] = useState<string | null>(null)
  const [saveNotice, setSaveNotice] = useState<string | null>(null)
  return { draft, setDraft, draftTaskId, setDraftTaskId, isDraftDirty, setIsDraftDirty, newSubtaskTitle, setNewSubtaskTitle, saveError, setSaveError, saveNotice, setSaveNotice }
}

export function TaskPreviewModal(props: TaskPreviewModalProps) {
  const controller = useTaskPreviewController(props)
  return controller.visible ? <TaskPreviewView {...controller.view} /> : null
}

function useTaskPreviewController({ taskId, isOpen, onClose, onComplete, onRestore, onRequestDelete, busyTaskIds = [], session, groups = [] }: TaskPreviewModalProps) {
  const queryClient = useQueryClient()
  const { draft, setDraft, draftTaskId, setDraftTaskId, isDraftDirty, setIsDraftDirty, newSubtaskTitle, setNewSubtaskTitle, saveError, setSaveError, saveNotice, setSaveNotice } = usePreviewState()
  const { isLocked, acquire } = useLocalMutationLock(setSaveError)
  const taskQuery = useQuery({ queryKey: ['task-detail', taskId], queryFn: () => getTaskDetail(taskId as string), enabled: isOpen && Boolean(taskId), staleTime: TASK_SCREEN_STALE_TIME_MS, gcTime: TASK_SCREEN_GC_TIME_MS })
  const task = taskQuery.data
  const mutations = useTaskPreviewMutations({ queryClient, taskId, task, draft, groups, session, title: newSubtaskTitle, setDraft, setDraftTaskId, setDirty: setIsDraftDirty, setTitle: setNewSubtaskTitle, setError: setSaveError, setSaveNotice, friendlyError: buildFriendlyMessage })
  const { save: saveMutation, create: createMutation, remove: deleteMutation } = mutations
  const mutationPending = isLocked || saveMutation.isPending || createMutation.isPending || deleteMutation.isPending
  const isBusy = Boolean(task && busyTaskIds.includes(task.id)) || mutationPending
  const isEditable = Boolean(task && draft && session && groups.length)

  function updateDraft(updater: (current: TaskDetailDraft) => TaskDetailDraft) {
    setIsDraftDirty(true); setDraft((current) => current ? updater(current) : current)
  }
  const requests = usePreviewRequests({ draft, task, isBusy, mutationPending, isDirty: isDraftDirty, title: newSubtaskTitle, acquire, onClose, onComplete, onRestore, onDelete: onRequestDelete, save: saveMutation.mutate, create: createMutation.mutate, remove: deleteMutation.mutate })

  usePreviewDraftSync({ isOpen, task, timezone: session?.timezone ?? undefined, draftTaskId, isDirty: isDraftDirty, setDraft, setDraftTaskId, setDirty: setIsDraftDirty, setTitle: setNewSubtaskTitle, setError: setSaveError })
  useEscapeClose(isOpen, requests.close)
  return { visible: Boolean(isOpen && taskId), view: { task, draft, groups, isLoading: taskQuery.isLoading, error: taskQuery.error, isEditable, isBusy, isDirty: isDraftDirty, saveError, saveNotice, newSubtaskTitle, onDraftChange: updateDraft, onNewSubtaskTitleChange: setNewSubtaskTitle, onDismissSaveNotice: () => setSaveNotice(null), onClose: requests.close, onSave: requests.saveTask, onCreateSubtask: requests.createSubtask, onDeleteSubtask: requests.deleteSubtask, onComplete: requests.complete, onRestore: requests.restore, onDelete: requests.deleteTask, friendlyError: buildFriendlyMessage } }
}
