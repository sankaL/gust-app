import { useEffect, useMemo, useRef, useCallback, useState } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { listAllTasks, type TaskSummary } from '../lib/api'

interface AllTasksViewProps {
  onTaskOpen: (taskId: string) => void
  onTaskComplete: (task: TaskSummary) => void
  isBusy: boolean
}

const PAGE_SIZE = 50

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

function TaskCard({
  task,
  onOpen,
  onComplete,
  isBusy
}: {
  task: TaskSummary
  onOpen: (taskId: string) => void
  onComplete: (task: TaskSummary) => void
  isBusy: boolean
}) {
  const badge = buildDueBadge(task)

  return (
    <article className="bg-surface-container">
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
        className="p-3 cursor-pointer transition-opacity hover:opacity-80 active:opacity-60"
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
              {task.recurrence_frequency ? (
                <span className="inline-flex items-center gap-1 text-xs text-primary" title={`Recurring: ${task.recurrence_frequency}`}>
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M4 4v5h.582m15.356 2A8.001 8.001 0 004.582 9m0 0H9m11 11v-5h-.581m0 0a8.003 8.003 0 01-15.357-2m15.357 2H15" />
                  </svg>
                </span>
              ) : null}
              {task.subtask_count > 0 ? (
                <span className="inline-flex items-center gap-1 text-xs text-on-surface-variant" title={`${task.subtask_count} subtask${task.subtask_count > 1 ? 's' : ''}`}>
                  <svg className="h-3.5 w-3.5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5H7a2 2 0 00-2 2v12a2 2 0 002 2h10a2 2 0 002-2V7a2 2 0 00-2-2h-2M9 5a2 2 0 002 2h2a2 2 0 002-2M9 5a2 2 0 012-2h2a2 2 0 012 2m-6 9l2 2 4-4" />
                  </svg>
                  <span>{task.subtask_count}</span>
                </span>
              ) : null}
            </div>
            <p className="truncate font-display text-base text-on-surface">{task.title}</p>
            <p className="truncate font-body text-xs text-on-surface-variant">{task.group.name}</p>
          </div>
          <div className="flex flex-col items-end gap-2">
            <div className="rounded-pill bg-surface-container-high px-2 py-1 text-xs uppercase tracking-[0.1em] text-on-surface-variant">
              {task.due_bucket.replace('_', ' ')}
            </div>
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onComplete(task)
              }}
              disabled={isBusy}
              className="rounded-full bg-primary/20 p-1.5 text-primary disabled:opacity-50 hover:bg-primary/30 transition-colors"
              aria-label={`Complete ${task.title}`}
            >
              <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              </svg>
            </button>
          </div>
        </div>
      </div>
    </article>
  )
}

// Hook to manage pagination state
function useAllTasksPagination() {
  const [cursor, setCursor] = useState<string | null>(null)
  const [allTasks, setAllTasks] = useState<TaskSummary[]>([])
  const [hasMore, setHasMore] = useState(true)
  const [isLoadingMore, setIsLoadingMore] = useState(false)

  return {
    cursor,
    setCursor,
    allTasks,
    setAllTasks,
    hasMore,
    setHasMore,
    isLoadingMore,
    setIsLoadingMore,
  }
}

// Hook to fetch current page
function useAllTasksPage(cursor: string | null) {
  return useQuery({
    queryKey: ['tasks', 'all', 'open', cursor],
    queryFn: async () => {
      const result = await listAllTasks('open', cursor, PAGE_SIZE)
      return result
    },
    staleTime: 1000 * 60,
  })
}

export function AllTasksView({ onTaskOpen, onTaskComplete, isBusy }: AllTasksViewProps) {
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const queryClient = useQueryClient()

  const {
    cursor,
    setCursor,
    allTasks,
    setAllTasks,
    hasMore,
    setHasMore,
    isLoadingMore,
    setIsLoadingMore,
  } = useAllTasksPagination()

  const { isLoading, isError, error, isFetching, data } = useAllTasksPage(cursor)

  // Handle data updates when new page arrives
  useEffect(() => {
    if (!data) return

    if (cursor === null) {
      // First page - replace tasks
      setAllTasks(data.items)
    } else {
      // Subsequent pages - append tasks
      setAllTasks(prev => [...prev, ...data.items])
    }
    setHasMore(data.has_more)
  }, [data, cursor])

  // Reset function
  const resetPagination = useCallback(() => {
    setCursor(null)
    setAllTasks([])
    setHasMore(true)
    void queryClient.invalidateQueries({ queryKey: ['tasks', 'all', 'open'] })
  }, [queryClient])

  // Reset when view becomes visible
  useEffect(() => {
    resetPagination()
  }, [resetPagination])

  // Load more function
  const loadMore = useCallback(() => {
    if (!data?.next_cursor || isLoadingMore || !hasMore) return
    setIsLoadingMore(true)
    setCursor(data.next_cursor)
  }, [data?.next_cursor, isLoadingMore, hasMore])

  // Intersection Observer for infinite scroll
  useEffect(() => {
    if (!loadMoreRef.current || !hasMore || isFetching || isLoadingMore) {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !isFetching && !isLoadingMore) {
          loadMore()
        }
      },
      { rootMargin: '200px' }
    )

    observer.observe(loadMoreRef.current)

    return () => observer.disconnect()
  }, [hasMore, isFetching, isLoadingMore, loadMore])

  // Group tasks by group_id
  const groupedTasks = useMemo(() => {
    const groups = new Map<string, { name: string; tasks: TaskSummary[] }>()

    for (const task of allTasks) {
      const existing = groups.get(task.group.id)
      if (existing) {
        existing.tasks.push(task)
      } else {
        groups.set(task.group.id, {
          name: task.group.name,
          tasks: [task]
        })
      }
    }

    // Sort groups by name for consistent ordering
    return new Map(
      Array.from(groups.entries()).sort((a, b) => a[1].name.localeCompare(b[1].name))
    )
  }, [allTasks])

  if (isLoading && allTasks.length === 0) {
    return (
      <div className="rounded-card bg-surface-container p-6 text-sm text-on-surface-variant">
        Loading all tasks...
      </div>
    )
  }

  if (isError) {
    return (
      <div className="rounded-card border border-tertiary/30 bg-tertiary/10 p-4 text-sm text-on-surface">
        Error loading tasks: {error instanceof Error ? error.message : 'Unknown error'}
      </div>
    )
  }

  if (allTasks.length === 0) {
    return (
      <div className="rounded-soft bg-surface-container p-6 shadow-ambient">
        <p className="font-display text-2xl text-on-surface">No tasks across any group</p>
        <p className="mt-3 font-body text-sm leading-6 text-on-surface-variant">
          Capture a voice note to create tasks, or move tasks into groups.
        </p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {Array.from(groupedTasks.entries()).map(([groupId, groupData]) => (
        <section key={groupId} className="space-y-3">
          <div className="sticky top-0 z-10 bg-surface px-3 py-2 flex items-center justify-between">
            <h3 className="font-display text-lg text-on-surface">{groupData.name}</h3>
            <span className="font-body text-xs uppercase tracking-[0.1em] text-on-surface-variant">
              {groupData.tasks.length} tasks
            </span>
          </div>
          <div className="space-y-2">
            {groupData.tasks.map((task) => (
              <TaskCard
                key={task.id}
                task={task}
                onOpen={onTaskOpen}
                onComplete={onTaskComplete}
                isBusy={isBusy}
              />
            ))}
          </div>
        </section>
      ))}

      {/* Load more trigger */}
      <div ref={loadMoreRef} className="h-4" />

      {(isFetching || isLoadingMore) && (
        <div className="text-center text-sm text-on-surface-variant py-2">
          Loading more tasks...
        </div>
      )}

      {!hasMore && allTasks.length > 0 && (
        <div className="text-center text-sm text-on-surface-variant py-2">
          All tasks loaded
        </div>
      )}
    </div>
  )
}
