import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'

import {
  ApiError,
  getSessionStatus,
  listGroups,
  listTasks,
  reopenTask,
  type SessionStatus,
  type TaskSummary
} from '../lib/api'
import { SessionGuard } from '../components/SessionGuard'

function buildFriendlyMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message
  }

  return fallback
}

function buildCompletedLabel(task: TaskSummary) {
  if (!task.completed_at) {
    return 'Completed'
  }

  const value = new Date(task.completed_at)
  return `Completed ${new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  }).format(value)}`
}

function dedupeCompletedTasks(tasks: TaskSummary[]) {
  const seen = new Set<string>()
  const result: TaskSummary[] = []

  for (const task of tasks) {
    const completedSecond = task.completed_at ? task.completed_at.slice(0, 19) : 'none'
    const normalizedTitle = task.title.trim().toLowerCase()
    const dueValue = task.due_date ?? 'none'
    const candidateKeys = [`task:${task.id}`]

    if (task.series_id) {
      candidateKeys.push(`series:${task.series_id}|second:${completedSecond}`)
    } else if (task.recurrence_frequency) {
      candidateKeys.push(
        `recurrence:${normalizedTitle}|group:${task.group.id}|due:${dueValue}|second:${completedSecond}`
      )
    }

    if (task.completed_at && !task.series_id && !task.recurrence_frequency) {
      candidateKeys.push(
        `legacy:${normalizedTitle}|group:${task.group.id}|due:${dueValue}|second:${completedSecond}`
      )
    }

    if (candidateKeys.some((key) => seen.has(key))) {
      continue
    }
    candidateKeys.forEach((key) => seen.add(key))
    result.push(task)
  }

  return result
}

export function CompletedTasksRoute() {
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
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

  const completedTasksQuery = useQuery({
    queryKey: ['tasks', resolvedGroupId, 'completed'],
    queryFn: () => listTasks(resolvedGroupId as string, 'completed'),
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

  const reopenMutation = useMutation({
    mutationFn: async (task: TaskSummary) => {
      const csrfToken = requireCsrf(sessionQuery.data)
      return reopenTask(task.id, csrfToken)
    },
    onSuccess: () => {
      setActionError(null)
      void refreshTaskData()
    },
    onError: (error) => {
      setActionError(buildFriendlyMessage(error, 'Task could not be moved back to To-do.'))
    }
  })

  const selectedGroup =
    groupsQuery.data?.find((group) => group.id === resolvedGroupId) ?? groupsQuery.data?.[0] ?? null
  const visibleCompletedTasks = dedupeCompletedTasks(completedTasksQuery.data?.items ?? [])

  return (
    <SessionGuard
      session={sessionQuery.data}
      isLoading={sessionQuery.isLoading}
      isError={sessionQuery.isError}
      title="Completed Tasks"
      eyebrow="Completed history"
      description="Review completed tasks and move them back to To-do when needed."
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
                  pathname: '/tasks',
                  search: resolvedGroupId ? `?group=${resolvedGroupId}` : ''
                }}
                className="inline-flex items-center gap-2 rounded-pill bg-primary px-4 py-2 text-sm font-medium text-surface transition-all duration-200 hover:bg-primary-dim hover:shadow-ambient active:scale-95"
              >
                Open Tasks
              </Link>
              <Link
                to={{
                  pathname: '/tasks/groups',
                  search: resolvedGroupId ? `?group=${resolvedGroupId}` : ''
                }}
                className="inline-flex items-center gap-2 rounded-pill bg-primary/20 px-4 py-2 text-sm font-medium text-primary transition-all duration-200 hover:bg-primary/30 hover:shadow-ambient active:scale-95"
              >
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
                {group.name}
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

        {completedTasksQuery.isLoading ? (
          <div className="rounded-card bg-surface-container p-6 text-sm text-on-surface-variant">
            Loading completed tasks.
          </div>
        ) : null}

        {completedTasksQuery.data && visibleCompletedTasks.length === 0 ? (
          <div className="rounded-soft bg-surface-container p-6 shadow-ambient">
            <p className="font-display text-2xl text-on-surface">No completed tasks here</p>
            <p className="mt-3 font-body text-sm leading-6 text-on-surface-variant">
              Complete tasks from the open list, then review them here.
            </p>
          </div>
        ) : null}

        <div className="space-y-3">
          {visibleCompletedTasks.map((task) => (
            <article key={task.id} className="rounded-card bg-surface-container-high border border-white/5 p-4 flex flex-col gap-4">
              <div className="flex items-stretch justify-between gap-4">
                <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
                  <div className="flex flex-col gap-1.5 align-top">
                    <h3 className="font-display text-lg font-medium text-on-surface truncate leading-tight">
                      {task.title}
                    </h3>
                    <p className="font-body text-xs text-on-surface-variant/80 font-medium">
                      {task.group?.name || 'Inbox'}
                    </p>
                  </div>
                  <div className="mt-4">
                    <span className="text-tertiary uppercase tracking-wider text-[0.65rem] font-bold">
                      {buildCompletedLabel(task)}
                    </span>
                  </div>
                </div>
                
                <div className="flex flex-col items-end justify-between gap-4 shrink-0 px-2">
                  <div className="flex items-center gap-2">
                    {task.recurrence_frequency && (
                      <span className="font-body text-[0.65rem] uppercase tracking-widest px-2 py-0.5 rounded-pill bg-primary/20 text-primary">
                        {task.recurrence_frequency}
                      </span>
                    )}
                  </div>
                  <div className="flex items-center gap-3 shrink-0">
                    <button
                      type="button"
                      onClick={() => reopenMutation.mutate(task)}
                      disabled={reopenMutation.isPending}
                      className="rounded-pill bg-surface-dim px-3 py-1.5 font-body text-[0.65rem] font-bold uppercase tracking-widest text-on-surface-variant shadow-[0_4px_12px_rgba(0,0,0,0.5),_inset_0_2px_4px_rgba(255,255,255,0.1)] hover:-translate-y-0.5 transition-all active:scale-95 disabled:opacity-50 disabled:hover:-translate-y-0 disabled:active:scale-100"
                    >
                      Restore
                    </button>
                  </div>
                </div>
              </div>
            </article>
          ))}
        </div>
      </section>
    </SessionGuard>
  )
}
