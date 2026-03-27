import { useEffect, useMemo, useRef, useCallback, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { Card } from './Card'
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

  return (
    <Card padding="none" interactive className="bg-surface-container-high border border-white/5">
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
        className="p-4 flex items-stretch justify-between gap-4"
      >
        {/* Left Column: Title & Metadata */}
        <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
          <div className="flex flex-col gap-1.5 align-top">
            <h3 className="font-display text-lg font-medium text-on-surface truncate leading-tight">
              {task.title}
            </h3>
            
            <div className="flex items-center gap-2 font-body text-xs text-on-surface-variant flex-wrap">
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

          <div className="mt-4">
            <span className={`${dueTextColor} uppercase tracking-wider text-[0.65rem] font-bold`}>
              Due: {badge ? badge.label : '--'}
            </span>
          </div>
        </div>

        {/* Right Column: Badges & Actions */}
        <div className="flex flex-col items-end justify-between gap-4 shrink-0">
          <div className="flex items-center gap-2">
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

          <div 
            className="flex items-center gap-3 shrink-0"
            onClick={(e) => e.stopPropagation()}
          >
            <button
              type="button"
              onClick={(e) => {
                e.stopPropagation()
                onComplete(task)
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
      <div className="flex items-start gap-3 rounded-card bg-error/10 border border-error/20 p-4 shadow-ambient">
        <svg className="w-5 h-5 shrink-0 mt-0.5 text-error" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <p className="font-body text-sm font-medium text-error leading-relaxed">
          Error loading tasks: {error instanceof Error ? error.message : 'Unknown error'}
        </p>
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
