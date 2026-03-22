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
  type SessionStatus,
  type TaskSummary
} from '../lib/api'
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
    <article className="relative overflow-hidden rounded-card bg-surface-container shadow-ambient">
      <div className="absolute inset-0 flex items-center justify-between px-4 text-xs uppercase tracking-[0.18em] text-on-surface-variant">
        <span>Swipe right to complete</span>
        <span>Swipe left to delete</span>
      </div>
      <button
        type="button"
        onClick={() => onOpen(task.id)}
        onPointerDown={handlePointerDown}
        onPointerMove={handlePointerMove}
        onPointerUp={handlePointerEnd}
        onPointerCancel={resetSwipe}
        className="relative z-10 w-full touch-pan-y rounded-card bg-surface-container p-5 text-left transition"
        style={{ transform: `translateX(${offsetX}px)` }}
      >
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-3">
            <div className="flex flex-wrap items-center gap-2">
              {task.needs_review ? (
                <span className="inline-flex rounded-pill bg-primary/20 px-3 py-1 text-xs uppercase tracking-[0.18em] text-primary">
                  Needs review
                </span>
              ) : null}
              {badge ? (
                <span className={`inline-flex rounded-pill px-3 py-1 text-xs uppercase tracking-[0.18em] ${badge.tone}`}>
                  {badge.label}
                </span>
              ) : null}
            </div>
            <div className="space-y-2">
              <p className="font-display text-xl text-on-surface">{task.title}</p>
              <p className="font-body text-sm text-on-surface-variant">{task.group.name}</p>
            </div>
          </div>
          <div className="mt-1 rounded-pill bg-surface-container-high px-3 py-2 text-xs uppercase tracking-[0.18em] text-on-surface-variant">
            {task.due_bucket.replace('_', ' ')}
          </div>
        </div>
      </button>

      <div className="relative z-10 flex gap-3 border-t border-outline/15 bg-surface-container-high px-4 py-3">
        <button
          type="button"
          onClick={() => onComplete(task.id)}
          disabled={isBusy}
          className="rounded-pill bg-primary px-4 py-2 text-sm font-medium text-surface disabled:opacity-50"
          aria-label={`Complete ${task.title}`}
        >
          Complete
        </button>
        <button
          type="button"
          onClick={() => onDelete(task.id)}
          disabled={isBusy}
          className="rounded-pill border border-outline/30 px-4 py-2 text-sm text-on-surface-variant disabled:opacity-50"
          aria-label={`Delete ${task.title}`}
        >
          Delete
        </button>
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
    mutationFn: async (task: TaskSummary) => {
      const csrfToken = requireCsrf(sessionQuery.data)
      return deleteTask(task.id, csrfToken)
    },
    onSuccess: (task) => {
      setUndoState({ kind: 'delete', taskId: task.id, title: task.title })
      setActionError(null)
      void refreshTaskData()
    },
    onError: (error) => {
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
      <section className="space-y-6">
        <div className="space-y-3">
          <div className="flex items-start justify-between gap-4">
            <div className="space-y-3">
              <p className="font-body text-sm uppercase tracking-[0.25em] text-on-surface-variant">
                Grouped open work
              </p>
              <h2 className="font-display text-3xl text-on-surface">Tasks</h2>
              <p className="max-w-sm font-body text-base leading-7 text-on-surface-variant">
                {selectedGroup
                  ? `Focused on ${selectedGroup.name}. Swipe for fast changes or open a task for full editing.`
                  : 'Loading your groups and open tasks.'}
              </p>
            </div>
            <Link
              to={{
                pathname: '/tasks/groups',
                search: resolvedGroupId ? `?group=${resolvedGroupId}` : ''
              }}
              className="inline-flex rounded-pill bg-surface-container-high px-4 py-3 text-sm text-on-surface"
            >
              Manage Groups
            </Link>
          </div>
        </div>

        {groupsQuery.data?.length ? (
          <div className="flex flex-wrap gap-3">
            {groupsQuery.data.map((group) => (
              <button
                key={group.id}
                type="button"
                onClick={() => setSearchParams({ group: group.id })}
                className={[
                  'rounded-pill px-4 py-3 font-body text-sm transition',
                  group.id === resolvedGroupId
                    ? 'bg-primary text-surface shadow-ambient'
                    : 'bg-surface-container text-on-surface-variant hover:bg-surface-container-high'
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

        <div className="space-y-6">
          {bucketSections.map((section) => {
            const items = (tasksQuery.data ?? []).filter((task) => task.due_bucket === section.key)
            if (items.length === 0) {
              return null
            }

            return (
              <section key={section.key} className="space-y-4">
                <div className="flex items-center justify-between">
                  <h3 className="font-display text-2xl text-on-surface">{section.label}</h3>
                  <span className="font-body text-xs uppercase tracking-[0.18em] text-on-surface-variant">
                    {items.length} tasks
                  </span>
                </div>

                <div className="space-y-4">
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
                          deleteMutation.mutate(current)
                        }
                      }}
                    />
                  ))}
                </div>
              </section>
            )
          })}
        </div>

        {undoState ? (
          <div className="sticky bottom-4 rounded-soft bg-surface-container-highest p-4 shadow-ambient">
            <div className="flex items-center justify-between gap-4">
              <div>
                <p className="font-body text-sm text-on-surface">
                  {undoState.kind === 'complete' ? 'Completed' : 'Deleted'} {undoState.title}
                </p>
                <p className="font-body text-xs uppercase tracking-[0.18em] text-on-surface-variant">
                  Undo is available while this message is visible
                </p>
              </div>
              <button
                type="button"
                onClick={() => undoMutation.mutate(undoState)}
                disabled={undoMutation.isPending}
                className="rounded-pill bg-primary px-4 py-2 text-sm font-medium text-surface disabled:opacity-50"
              >
                Undo
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </SessionGuard>
  )
}
