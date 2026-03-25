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
          <p className="rounded-card border border-tertiary/30 bg-tertiary/10 px-4 py-3 font-body text-sm text-on-surface">
            {actionError}
          </p>
        ) : null}

        {completedTasksQuery.isLoading ? (
          <div className="rounded-card bg-surface-container p-6 text-sm text-on-surface-variant">
            Loading completed tasks.
          </div>
        ) : null}

        {completedTasksQuery.data && completedTasksQuery.data.length === 0 ? (
          <div className="rounded-soft bg-surface-container p-6 shadow-ambient">
            <p className="font-display text-2xl text-on-surface">No completed tasks here</p>
            <p className="mt-3 font-body text-sm leading-6 text-on-surface-variant">
              Complete tasks from the open list, then review them here.
            </p>
          </div>
        ) : null}

        <div className="space-y-3">
          {(completedTasksQuery.data ?? []).map((task) => (
            <article key={task.id} className="rounded-card bg-surface-container p-4 shadow-ambient">
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0 space-y-1">
                  <p className="truncate font-display text-base text-on-surface">{task.title}</p>
                  <p className="font-body text-xs text-on-surface-variant">{buildCompletedLabel(task)}</p>
                </div>
                <button
                  type="button"
                  onClick={() => reopenMutation.mutate(task)}
                  disabled={reopenMutation.isPending}
                  className="rounded-pill bg-primary/20 px-3 py-1.5 text-sm font-medium text-primary transition hover:bg-primary/30 disabled:opacity-50"
                >
                  Move to To-do
                </button>
              </div>
            </article>
          ))}
        </div>
      </section>
    </SessionGuard>
  )
}
