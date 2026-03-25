import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import {
  ApiError,
  completeTask,
  deleteTask,
  getSessionStatus,
  listGroups,
  listTasks,
  reopenTask,
  restoreTask,
  type TaskDeleteScope,
  type SessionStatus,
  type TaskSummary
} from '../lib/api'
import { EditExtractedTaskModal } from '../components/EditExtractedTaskModal'
import { SessionGuard } from '../components/SessionGuard'

type UndoState =
  | {
      kind: 'complete'
      taskId: string
      title: string
    }
  | {
      kind: 'delete'
      taskId: string
      title: string
    }
  | null

type SwipeTaskCardProps = {
  task: TaskSummary
  onOpen: (taskId: string) => void
  onComplete: (taskId: string) => void
  onDelete: (taskId: string) => void
  isBusy: boolean
}

type DeleteMutationInput = {
  task: TaskSummary
  scope: TaskDeleteScope
}

function buildFriendlyMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message
  }

  return fallback
}

function buildDueBadge(task: TaskSummary) {
  if (!task.due_date) {
    return null
  }

  const today = new Date()
  const due = new Date(`${task.due_date}T00:00:00`)
  const todayDay = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) / 86400000
  const dueDay = Date.UTC(due.getFullYear(), due.getMonth(), due.getDate()) / 86400000
  const diffDays = dueDay - todayDay

  if (diffDays < 0) {
    return { label: 'Overdue', tone: 'bg-tertiary text-surface' }
  }
  if (diffDays === 0) {
    return { label: 'Today', tone: 'bg-primary text-surface' }
  }
  if (diffDays === 1) {
    return { label: 'Tomorrow', tone: 'bg-primary/20 text-on-surface' }
  }
  if (diffDays <= 7) {
    return {
      label: new Intl.DateTimeFormat(undefined, {
        month: 'short',
        day: 'numeric'
      }).format(due),
      tone: 'bg-amber-500/20 text-amber-300 border border-amber-500/30'
    }
  }
  return {
    label: new Intl.DateTimeFormat(undefined, {
      month: 'short',
      day: 'numeric'
    }).format(due),
    tone: 'bg-surface-container-high text-on-surface-variant'
  }
}

function SwipeTaskCard({ task, onOpen, onComplete, onDelete, isBusy }: SwipeTaskCardProps) {
  const startXRef = useRef<number | null>(null)
  const pointerIdRef = useRef<number | null>(null)
  const offsetRef = useRef(0)
  const [offsetX, setOffsetX] = useState(0)
  const badge = buildDueBadge(task)

  function resetSwipe() {
    startXRef.current = null
    pointerIdRef.current = null
    offsetRef.current = 0
    setOffsetX(0)
  }

  function handlePointerDown(event: React.PointerEvent<HTMLElement>) {
    if (isBusy) {
      return
    }
    startXRef.current = event.clientX
    pointerIdRef.current = event.pointerId
  }

  function handlePointerMove(event: React.PointerEvent<HTMLElement>) {
    if (startXRef.current === null || pointerIdRef.current !== event.pointerId) {
      return
    }
    const delta = event.clientX - startXRef.current
    const clamped = Math.max(-120, Math.min(120, delta))
    offsetRef.current = clamped
    setOffsetX(clamped)
  }

  function handlePointerEnd() {
    if (offsetRef.current >= 90) {
      onComplete(task.id)
    } else if (offsetRef.current <= -90) {
      onDelete(task.id)
    }
    resetSwipe()
  }

  return (
    <article className={`relative overflow-hidden rounded-card shadow-ambient ${!task.due_date ? 'bg-surface-container/50 opacity-70' : 'bg-surface-container'}`}>
      <div className="absolute inset-0 flex items-center justify-between px-3 text-xs uppercase tracking-[0.1em] text-on-surface-variant">
        <span>Swipe right to complete</span>
        <span>Swipe left to delete</span>
      </div>
      <div
        role="button"
        tabIndex={0}
        onClick={() => onOpen(task.id)}
        onKeyDown={(e) => {
          if (e.key === 'Enter' || e.key === ' ') {
            e.preventDefault()
            onOpen(task.id)
          }
        }}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={resetSwipe}
        className="relative z-10 w-full touch-pan-y rounded-card bg-surface-container p-3 text-left transition"
        style={{ transform: `translateX(${offsetX}px)` }}
      >
        <div className="flex items-start justify-between gap-3">
          <div className="min-w-0 flex-1 space-y-1">
            <div className="flex flex-wrap items-center gap-1.5">
              {task.needs_review ? (
                <span className="inline-flex rounded-pill bg-primary/20 px-2 py-0.5 text-xs uppercase tracking-[0.1em] text-primary">
                  Needs review
                </span>
              ) : null}
              {badge ? (
                <span className={`inline-flex rounded-pill px-2 py-0.5 text-xs uppercase tracking-[0.1em] ${badge.tone}`}>
                  {badge.label}
                </span>
              ) : null}
            </div>
            <p className="truncate font-display text-base text-on-surface">{task.title}</p>
            <p className="truncate font-body text-xs text-on-surface-variant">{task.group.name}</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            {!task.due_date ? (
              <div className="flex items-center gap-1 rounded-pill bg-surface-container-high px-2 py-1 text-xs text-on-surface-variant">
                <svg className="h-3 w-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M8 7V3m8 4V3m-9 8h10M5 21h14a2 2 0 002-2V7a2 2 0 00-2-2H5a2 2 0 00-2 2v12a2 2 0 002 2z" />
                </svg>
                <span>Add date</span>
              </div>
            ) : (
              <div className="rounded-pill bg-surface-container-high px-2 py-1 text-xs uppercase tracking-[0.1em] text-on-surface-variant">
                {task.due_bucket.replace('_', ' ')}
              </div>
            )}
            <div className="flex gap-1">
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onComplete(task.id)
                }}
                disabled={isBusy}
                className="rounded-full bg-primary/20 p-1.5 text-primary disabled:opacity-50"
                aria-label={`Complete ${task.title}`}
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
                </svg>
              </button>
              <button
                type="button"
                onClick={(e) => {
                  e.stopPropagation()
                  onDelete(task.id)
                }}
                disabled={isBusy}
                className="rounded-full bg-surface-container-high p-1.5 text-on-surface-variant disabled:opacity-50"
                aria-label={`Delete ${task.title}`}
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>
          </div>
        </div>
      </div>
    </article>
  )
}

export function TasksRoute() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [undoState, setUndoState] = useState<UndoState>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [isAddTaskModalOpen, setIsAddTaskModalOpen] = useState(false)
  const [pendingRecurringDelete, setPendingRecurringDelete] = useState<TaskSummary | null>(null)

  // Clear pending recurring delete modal state on navigation away
  useEffect(() => {
    return () => setPendingRecurringDelete(null)
  }, [])

  const sessionQuery = useQuery({
    queryKey: ['session-status'],
    queryFn: getSessionStatus
  })

  const groupsQuery = useQuery({
    queryKey: ['groups'],
    queryFn: listGroups,
    enabled: sessionQuery.data?.signed_in === true
  })

  const selectedGroupId = searchParams.get('group')
  const resolvedGroupId =
    selectedGroupId ??
    sessionQuery.data?.inbox_group_id ??
    groupsQuery.data?.[0]?.id ??
    null

  useEffect(() => {
    if (!sessionQuery.data?.signed_in || !groupsQuery.data?.length || selectedGroupId) {
      return
    }

    const nextGroupId = sessionQuery.data.inbox_group_id ?? groupsQuery.data[0].id
    setSearchParams({ group: nextGroupId }, { replace: true })
  }, [groupsQuery.data, selectedGroupId, sessionQuery.data, setSearchParams])

  const tasksQuery = useQuery({
    queryKey: ['tasks', resolvedGroupId, 'open'],
    queryFn: () => listTasks(resolvedGroupId as string),
    enabled: sessionQuery.data?.signed_in === true && Boolean(resolvedGroupId)
  })

  function requireCsrf(session: SessionStatus | undefined) {
    const csrfToken = session?.csrf_token
    if (!csrfToken) {
      throw new ApiError('Your session is missing a CSRF token.', 'csrf_missing', 403)
    }
    return csrfToken
  }

  async function refreshTaskData() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['groups'] }),
      queryClient.invalidateQueries({ queryKey: ['tasks'] }),
      queryClient.invalidateQueries({ queryKey: ['task-detail'] })
    ])
  }

  const completeMutation = useMutation({
    mutationFn: async (task: TaskSummary) => {
      const csrfToken = requireCsrf(sessionQuery.data)
      return completeTask(task.id, csrfToken)
    },
    onSuccess: (task) => {
      setUndoState({ kind: 'complete', taskId: task.id, title: task.title })
      setActionError(null)
      void refreshTaskData()
    },
    onError: (error) => {
      setActionError(buildFriendlyMessage(error, 'Task could not be completed.'))
    }
  })

  const deleteMutation = useMutation({
    mutationFn: async ({ task, scope }: DeleteMutationInput) => {
      const csrfToken = requireCsrf(sessionQuery.data)
      return deleteTask(task.id, csrfToken, scope)
    },
    onSuccess: (task, variables) => {
      if (variables.scope === 'occurrence') {
        setUndoState({ kind: 'delete', taskId: task.id, title: task.title })
      } else {
        setUndoState(null)
      }
      setPendingRecurringDelete(null)
      setActionError(null)
      void refreshTaskData()
    },
    onError: (error) => {
      setPendingRecurringDelete(null)
      setActionError(buildFriendlyMessage(error, 'Task could not be deleted.'))
    }
  })

  const undoMutation = useMutation({
    mutationFn: async (undo: Exclude<UndoState, null>) => {
      const csrfToken = requireCsrf(sessionQuery.data)
      if (undo.kind === 'complete') {
        return reopenTask(undo.taskId, csrfToken)
      }
      return restoreTask(undo.taskId, csrfToken)
    },
    onSuccess: () => {
      setUndoState(null)
      setActionError(null)
      void refreshTaskData()
    },
    onError: (error) => {
      setActionError(buildFriendlyMessage(error, 'Undo failed.'))
    }
  })

  const isBusy =
    completeMutation.isPending || deleteMutation.isPending || undoMutation.isPending

  function handleDeleteTask(task: TaskSummary) {
    if (task.series_id) {
      setPendingRecurringDelete(task)
      return
    }
    deleteMutation.mutate({ task, scope: 'occurrence' })
  }

  const bucketSections = [
    { key: 'overdue', label: 'Overdue' },
    { key: 'due_soon', label: 'Due Soon' },
    { key: 'no_date', label: 'No Date' }
  ] as const

  const selectedGroup =
    groupsQuery.data?.find((group) => group.id === resolvedGroupId) ?? groupsQuery.data?.[0] ?? null

  return (
    <SessionGuard
      session={sessionQuery.data}
      isLoading={sessionQuery.isLoading}
      isError={sessionQuery.isError}
      title="Tasks"
      eyebrow="Focused task surface"
      description="Review, sort, and correct extracted tasks without leaving the protected backend session."
    >
      <section className="space-y-4">
        <div className="space-y-2">
          <div className="flex items-start justify-between gap-3">
            <div className="space-y-2">
              <p className="font-body text-xs uppercase tracking-[0.15em] text-on-surface-variant">
                {selectedGroup?.name ?? 'Loading'}
              </p>
            </div>
            <div className="flex items-center gap-2">
              <Link
                to={{
                  pathname: '/tasks/completed',
                  search: resolvedGroupId ? `?group=${resolvedGroupId}` : ''
                }}
                className="inline-flex items-center gap-2 rounded-pill bg-surface-container-high px-4 py-2 text-sm font-medium text-on-surface transition-all duration-200 hover:bg-surface-container-highest hover:shadow-ambient active:scale-95"
              >
                Completed
              </Link>
              <button
                type="button"
                onClick={() => setIsAddTaskModalOpen(true)}
                className="inline-flex items-center gap-2 rounded-pill bg-primary px-4 py-2 text-sm font-medium text-surface transition-all duration-200 hover:bg-primary-dim hover:shadow-ambient active:scale-95"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
                </svg>
                Add Task
              </button>
              <Link
                to={{
                  pathname: '/tasks/groups',
                  search: resolvedGroupId ? `?group=${resolvedGroupId}` : ''
                }}
                className="inline-flex items-center gap-2 rounded-pill bg-primary/20 px-4 py-2 text-sm font-medium text-primary transition-all duration-200 hover:bg-primary/30 hover:shadow-ambient active:scale-95"
              >
                <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M19 11H5m14 0a2 2 0 012 2v6a2 2 0 01-2 2H5a2 2 0 01-2-2v-6a2 2 0 012-2m14 0V9a2 2 0 00-2-2M5 11V9a2 2 0 012-2m0 0V5a2 2 0 012-2h6a2 2 0 012 2v2M7 7h10" />
                </svg>
                Groups
              </Link>
            </div>
          </div>
        </div>

        {groupsQuery.data?.length ? (
          <div className="flex flex-wrap gap-2">
            {groupsQuery.data.map((group) => (
              <button
                key={group.id}
                type="button"
                onClick={() => setSearchParams({ group: group.id })}
                className={[
                  'rounded-pill px-4 py-2 font-body text-sm font-medium transition-all duration-200',
                  group.id === resolvedGroupId
                    ? 'bg-primary text-surface shadow-ambient ring-2 ring-primary/50'
                    : 'bg-surface-container-high text-on-surface hover:bg-surface-container-highest hover:shadow-ambient border border-outline/20'
                ].join(' ')}
              >
                {group.name} · {group.open_task_count}
              </button>
            ))}
          </div>
        ) : null}

        {actionError ? (
          <p className="rounded-card border border-tertiary/30 bg-tertiary/10 px-4 py-3 font-body text-sm text-on-surface">
            {actionError}
          </p>
        ) : null}

        {tasksQuery.isLoading ? (
          <div className="rounded-card bg-surface-container p-6 text-sm text-on-surface-variant">
            Loading open tasks.
          </div>
        ) : null}

        {tasksQuery.data && tasksQuery.data.length === 0 ? (
          <div className="rounded-soft bg-surface-container p-6 shadow-ambient">
            <p className="font-display text-2xl text-on-surface">No open tasks here</p>
            <p className="mt-3 font-body text-sm leading-6 text-on-surface-variant">
              Capture a voice note or move tasks into this group from detail editing.
            </p>
          </div>
        ) : null}

        <div className="space-y-4">
          {bucketSections.map((section) => {
            const items = (tasksQuery.data ?? []).filter((task) => task.due_bucket === section.key)
            if (items.length === 0) {
              return null
            }

            return (
              <section key={section.key} className="space-y-3">
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-xl text-on-surface">{section.label}</h3>
                  <span className="font-body text-xs uppercase tracking-[0.1em] text-on-surface-variant">
                    {items.length} tasks
                  </span>
                </div>

                <div className="space-y-3">
                  {items.map((task) => (
                    <SwipeTaskCard
                      key={task.id}
                      task={task}
                      isBusy={isBusy}
                      onOpen={(taskId) =>
                        void navigate({
                          pathname: `/tasks/${taskId}`,
                          search: resolvedGroupId ? `?group=${resolvedGroupId}` : ''
                        })
                      }
                      onComplete={(taskId) => {
                        const current = (tasksQuery.data ?? []).find((item) => item.id === taskId)
                        if (current) {
                          completeMutation.mutate(current)
                        }
                      }}
                      onDelete={(taskId) => {
                        const current = (tasksQuery.data ?? []).find((item) => item.id === taskId)
                        if (current) {
                          handleDeleteTask(current)
                        }
                      }}
                    />
                  ))}
                </div>
              </section>
            )
          })}
        </div>

        {pendingRecurringDelete ? (
          <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
            <div className="w-full max-w-md rounded-card bg-surface-container p-4 shadow-ambient">
              <p className="font-display text-xl text-on-surface">Delete recurring task</p>
              <p className="mt-2 font-body text-sm text-on-surface-variant">
                Choose whether to delete only this occurrence or this and future open occurrences.
              </p>
              <p className="mt-2 truncate font-body text-sm text-on-surface">
                {pendingRecurringDelete.title}
              </p>
              <div className="mt-4 space-y-2">
                <button
                  type="button"
                  onClick={() =>
                    deleteMutation.mutate({
                      task: pendingRecurringDelete,
                      scope: 'occurrence'
                    })
                  }
                  disabled={deleteMutation.isPending}
                  className="w-full rounded-pill bg-surface-container-high px-4 py-2 text-sm font-medium text-on-surface transition hover:bg-surface-container-highest disabled:opacity-50"
                >
                  Delete this occurrence
                </button>
                <button
                  type="button"
                  onClick={() =>
                    deleteMutation.mutate({
                      task: pendingRecurringDelete,
                      scope: 'series'
                    })
                  }
                  disabled={deleteMutation.isPending}
                  className="w-full rounded-pill bg-tertiary px-4 py-2 text-sm font-medium text-surface transition hover:bg-tertiary/85 disabled:opacity-50"
                >
                  Delete this and future
                </button>
                <button
                  type="button"
                  onClick={() => setPendingRecurringDelete(null)}
                  disabled={deleteMutation.isPending}
                  className="w-full rounded-pill bg-transparent px-4 py-2 text-sm font-medium text-on-surface-variant transition hover:bg-surface-container-high disabled:opacity-50"
                >
                  Cancel
                </button>
              </div>
            </div>
          </div>
        ) : null}

        {undoState ? (
          <div className={`fixed bottom-0 left-0 right-0 z-50 mx-auto max-w-md rounded-t-soft p-4 shadow-ambient ${
            undoState.kind === 'complete'
              ? 'bg-primary/10 border-t-2 border-primary'
              : 'bg-tertiary/10 border-t-2 border-tertiary'
          }`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-body text-sm text-on-surface">
                  {undoState.kind === 'complete' ? 'Completed' : 'Deleted'} {undoState.title}
                </p>
                <p className="font-body text-xs uppercase tracking-[0.1em] text-on-surface-variant">
                  Undo is available while this message is visible
                </p>
              </div>
              <button
                type="button"
                onClick={() => undoMutation.mutate(undoState)}
                disabled={undoMutation.isPending}
                className={`rounded-pill px-3 py-1.5 text-sm font-medium text-surface disabled:opacity-50 ${
                  undoState.kind === 'complete'
                    ? 'bg-primary hover:bg-primary-dim'
                    : 'bg-tertiary hover:bg-tertiary/80'
                }`}
              >
                Undo
              </button>
            </div>
          </div>
        ) : null}
      </section>

      <EditExtractedTaskModal
        task={null}
        groups={groupsQuery.data ?? []}
        isOpen={isAddTaskModalOpen}
        onClose={() => setIsAddTaskModalOpen(false)}
        onSave={async (_taskId, _updates) => {
          // Refresh task data after creation
          await refreshTaskData()
        }}
        csrfToken={sessionQuery.data?.csrf_token ?? ''}
        defaultGroupId={resolvedGroupId ?? undefined}
      />
    </SessionGuard>
  )
}
