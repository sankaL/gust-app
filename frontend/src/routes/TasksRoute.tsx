import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import {
  ApiError,
  completeTask,
  getSessionStatus,
  listGroups,
  listTasks,
  reopenTask,
  restoreTask,
  type SessionStatus,
  type TaskSummary
} from '../lib/api'
import { AllTasksView } from '../components/AllTasksView'
import { EditExtractedTaskModal } from '../components/EditExtractedTaskModal'
import { SessionGuard } from '../components/SessionGuard'
import { Card } from '../components/Card'

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

function SwipeTaskCard({ task, onOpen, onComplete, isBusy }: SwipeTaskCardProps) {
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
    }
    resetSwipe()
  }

  let dueTextColor = 'text-on-surface-variant/50'
  if (task.due_date) {
    const today = new Date()
    const due = new Date(`${task.due_date}T00:00:00`)
    const todayDay = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) / 86400000
    const dueDay = Date.UTC(due.getFullYear(), due.getMonth(), due.getDate()) / 86400000
    const diff = dueDay - todayDay
    if (diff < 0) dueTextColor = 'text-error'
    else if (diff === 0) dueTextColor = 'text-warning'
    else dueTextColor = 'text-primary'
  }

  function formatReminder(reminderAt: string | null): string {
    if (!reminderAt) return 'none'
    const date = new Date(reminderAt)
    return date.toLocaleDateString(undefined, {
      month: 'short',
      day: 'numeric',
      hour: 'numeric',
      minute: '2-digit'
    })
  }

  const clampTwoLines = {
    display: '-webkit-box',
    WebkitBoxOrient: 'vertical' as const,
    WebkitLineClamp: 2,
    overflow: 'hidden'
  }

  return (
    <Card padding="none" className={`relative overflow-hidden bg-surface-container-high border border-white/5 ${!task.due_date ? 'opacity-70' : ''}`}>
      <div className="absolute inset-0 flex items-center justify-start px-6 text-[0.65rem] font-bold uppercase tracking-[0.15em] text-on-surface-variant">
        <span>Swipe right to complete</span>
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
        className="relative z-10 w-full touch-pan-y bg-surface-container-high p-4 text-left transition-transform duration-200 flex items-stretch justify-between gap-4"
        style={{ transform: `translateX(${offsetX}px)` }}
      >
        {/* Left Column: Task Content */}
        <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
          <div className="flex flex-col gap-2">
            <h3
              className="font-display text-base font-medium text-on-surface leading-tight"
              style={clampTwoLines}
            >
              {task.title}
            </h3>

            {task.description ? (
              <p
                className="text-[0.78rem] leading-5 text-on-surface-variant/85"
                style={clampTwoLines}
              >
                {task.description}
              </p>
            ) : null}

            <div className="flex items-center gap-2 font-body text-[0.72rem] text-on-surface-variant flex-wrap">
              <span className="text-on-surface-variant/80 font-medium">
                {task.group?.name || 'Inbox'}
              </span>
              {task.reminder_at && (
                <>
                  <span className="text-on-surface-variant/40">•</span>
                  <span className="text-on-surface-variant/80">
                    Reminder: {formatReminder(task.reminder_at)}
                  </span>
                </>
              )}
              {task.needs_review && (
                <span className="inline-block px-2 py-0.5 text-[0.65rem] uppercase tracking-widest font-bold bg-warning/20 text-warning rounded-pill">
                  Needs Review
                </span>
              )}
            </div>
          </div>

          <div className="mt-4 space-y-2">
            <span className={`${dueTextColor} block uppercase tracking-wider text-[0.65rem] font-bold`}>
              Due: {badge ? badge.label : '--'}
            </span>
            <div className="flex items-center gap-2 flex-wrap">
              <span className={`font-body text-[0.65rem] uppercase tracking-widest px-2 py-0.5 rounded-pill ${
                task.recurrence_frequency 
                  ? 'bg-primary/20 text-primary' 
                  : 'bg-surface-dim text-on-surface-variant/40'
              }`} title={task.recurrence_frequency ? `Recurring: ${task.recurrence_frequency}` : 'No recurrence'}>
                {task.recurrence_frequency ? task.recurrence_frequency : 'ONE-OFF'}
              </span>
              
              <div 
                className="flex items-center gap-1 bg-surface-dim px-2 py-0.5 rounded-pill"
                title={`${task.subtask_count} subtasks`}
              >
                <span className="font-body text-[0.65rem] text-on-surface-variant uppercase tracking-widest">
                  {task.subtask_count > 0 ? `${task.subtask_count} SUBTASKS` : '0 SUBTASKS'}
                </span>
              </div>
            </div>
          </div>
        </div>

        {/* Right Column: Actions */}
        <div className="flex flex-col items-end justify-end gap-4 shrink-0 px-2">
          <div 
            className="flex items-center gap-3 shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onComplete(task.id)
              }}
              disabled={isBusy}
              className="flex items-center justify-center w-8 h-8 rounded-full bg-surface-dim border border-white/10 shadow-[0_4px_12px_rgba(0,0,0,0.5),_inset_0_2px_4px_rgba(255,255,255,0.1)] text-primary hover:bg-surface-container-highest hover:-translate-y-0.5 transition-all duration-200 active:scale-90 active:translate-y-0 disabled:opacity-50 disabled:hover:-translate-y-0 disabled:active:scale-100"
              aria-label={`Complete ${task.title}`}
            >
              <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
            </button>
          </div>
        </div>

      </div>
    </Card>
  )
}

export function TasksRoute() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [undoState, setUndoState] = useState<UndoState>(null)
  const [actionError, setActionError] = useState<string | null>(null)
  const [isAddTaskModalOpen, setIsAddTaskModalOpen] = useState(false)

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

    // Default to 'all' view instead of a specific group
    setSearchParams({ group: 'all' }, { replace: true })
  }, [groupsQuery.data, selectedGroupId, sessionQuery.data, setSearchParams])

  const isAllView = selectedGroupId === 'all'

  const tasksQuery = useQuery({
    queryKey: ['tasks', resolvedGroupId, 'open'],
    queryFn: () => listTasks(resolvedGroupId as string),
    enabled: sessionQuery.data?.signed_in === true && Boolean(resolvedGroupId) && !isAllView
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
    completeMutation.isPending || undoMutation.isPending

  const bucketSections = [
    { key: 'overdue', label: 'Overdue' },
    { key: 'due_soon', label: 'Due Soon' },
    { key: 'no_date', label: 'No Date' }
  ] as const


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


        {groupsQuery.data?.length ? (
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={() => setSearchParams({ group: 'all' })}
              className={[
                'rounded-pill px-4 py-2 font-body text-sm font-medium transition-all duration-200 active:scale-95 outline-none',
                selectedGroupId === 'all'
                  ? 'bg-[radial-gradient(circle_at_top_left,_#5b21b6_0%,_#2e1065_100%)] text-white shadow-[0_2px_0_#171033,_0_4px_8px_rgba(0,0,0,0.3),_inset_0_1px_2px_rgba(255,255,255,0.15)] -translate-y-[1px]'
                  : 'bg-surface-container-high text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] border border-white/5'
              ].join(' ')}
            >
              All
            </button>
            {groupsQuery.data.map((group) => (
              <button
                key={group.id}
                type="button"
                onClick={() => setSearchParams({ group: group.id })}
                className={[
                  'rounded-pill px-4 py-2 font-body text-sm font-medium transition-all duration-200 active:scale-95 outline-none',
                  group.id === resolvedGroupId
                    ? 'bg-[radial-gradient(circle_at_top_left,_#5b21b6_0%,_#2e1065_100%)] text-white shadow-[0_2px_0_#171033,_0_4px_8px_rgba(0,0,0,0.3),_inset_0_1px_2px_rgba(255,255,255,0.15)] -translate-y-[1px]'
                    : 'bg-surface-container-high text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] border border-white/5'
                ].join(' ')}
              >
                {group.name} · {group.open_task_count}
              </button>
            ))}
          </div>
        ) : null}

        {actionError ? (
          <div className="flex items-start gap-3 rounded-card bg-error/10 border border-error/20 p-4 shadow-ambient">
            <svg className="w-5 h-5 shrink-0 mt-0.5 text-error" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
            </svg>
            <p className="font-body text-sm font-medium text-error leading-relaxed">{actionError}</p>
          </div>
        ) : null}

        {isAllView ? (
          <AllTasksView
            onTaskOpen={(taskId) =>
              void navigate({
                pathname: `/tasks/${taskId}`
              })
            }
            onTaskComplete={(task) => {
              completeMutation.mutate(task)
            }}
            isBusy={isBusy}
          />
        ) : (
          <>
            {tasksQuery.isLoading ? (
              <div className="rounded-card bg-surface-container p-6 text-sm text-on-surface-variant">
                Loading open tasks.
              </div>
            ) : null}

            {tasksQuery.data && (Array.isArray(tasksQuery.data) ? tasksQuery.data : tasksQuery.data.items).length === 0 ? (
              <div className="rounded-soft bg-surface-container p-6 shadow-ambient">
                <p className="font-display text-2xl text-on-surface">No open tasks here</p>
                <p className="mt-3 font-body text-sm leading-6 text-on-surface-variant">
                  Capture a voice note or move tasks into this group from detail editing.
                </p>
              </div>
            ) : null}

            <div className="space-y-4">
              {bucketSections.map((section) => {
                const rawData = tasksQuery.data;
                const itemsList = Array.isArray(rawData) ? rawData : (rawData?.items ?? [])
                const items = itemsList.filter((task) => task.due_bucket === section.key)
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
                            const rawData = tasksQuery.data;
                            const itemsList = Array.isArray(rawData) ? rawData : (rawData?.items ?? [])
                            const current = itemsList.find((item) => item.id === taskId)
                            if (current) {
                              completeMutation.mutate(current)
                            }
                          }}
                        />
                      ))}
                    </div>
                  </section>
                )
              })}
            </div>
          </>
        )}

        {undoState ? (
          <div className={`fixed bottom-0 left-0 right-0 z-50 mx-auto max-w-md rounded-t-soft p-4 shadow-ambient ${
            undoState.kind === 'complete'
              ? 'bg-primary/10 border-t-2 border-primary'
              : 'bg-surface-container-highest border-t-2 border-error/50'
          }`}>
            <div className="flex items-center justify-between gap-3">
              <div>
                <p className="font-body text-sm font-medium text-on-surface">
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
        <div className="mt-8 mb-20 flex justify-center pb-8">
          <Link
            to={{
              pathname: '/tasks/completed',
              search: resolvedGroupId ? `?group=${resolvedGroupId}` : ''
            }}
            className="inline-flex items-center gap-2 rounded-pill border border-outline/20 bg-surface-container px-4 py-2 text-sm font-medium text-on-surface-variant transition-all hover:bg-surface-container-high hover:text-on-surface hover:shadow-ambient"
          >
            View Completed Tasks
          </Link>
        </div>
      </section>

      <button
        type="button"
        onClick={() => setIsAddTaskModalOpen(true)}
        className="group fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-[radial-gradient(circle_at_top,_#c4b5fd_10%,_#7c3aed_90%)] text-white shadow-[0_8px_0_#4c1d95,_0_15px_20px_rgba(0,0,0,0.4),_inset_0_2px_3px_rgba(255,255,255,0.6)] hover:-translate-y-[2px] hover:shadow-[0_10px_0_#4c1d95,_0_18px_24px_rgba(0,0,0,0.4),_inset_0_2px_3px_rgba(255,255,255,0.6)] active:translate-y-[8px] active:shadow-[0_0px_0_#4c1d95,_0_4px_8px_rgba(0,0,0,0.4),_inset_0_4px_8px_rgba(0,0,0,0.3)] transition-all duration-200 outline-none select-none"
        aria-label="Add Task"
      >
        <div className="flex items-center justify-center transition-all duration-200 drop-shadow-md">
          <svg className="h-6 w-6 text-white/95" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
        </div>
      </button>

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
