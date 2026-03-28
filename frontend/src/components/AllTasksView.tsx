import { useMemo, useRef, useEffect } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { listAllTasks, type TaskSummary } from '../lib/api'
import { OpenTaskCard } from './OpenTaskCard'

interface AllTasksViewProps {
  onTaskOpen: (taskId: string) => void
  onTaskPrepareOpen?: (taskId: string) => void
  onTaskComplete: (task: TaskSummary) => void
  onTaskDelete: (task: TaskSummary) => void
  busyTaskIds?: string[]
}

const PAGE_SIZE = 50

function TaskCard({
  task,
  onOpen,
  onPrepareOpen,
  onComplete,
  onDelete,
  isBusy
}: {
  task: TaskSummary
  onOpen: (taskId: string) => void
  onPrepareOpen?: (taskId: string) => void
  onComplete: (task: TaskSummary) => void
  onDelete: (task: TaskSummary) => void
  isBusy: boolean
}) {
  return (
    <OpenTaskCard
      task={task}
      onOpen={onOpen}
      onPrepareOpen={onPrepareOpen}
      onComplete={onComplete}
      onDelete={onDelete}
      isBusy={isBusy}
    />
  )
}

export function AllTasksView({
  onTaskOpen,
  onTaskPrepareOpen,
  onTaskComplete,
  onTaskDelete,
  busyTaskIds = [],
}: AllTasksViewProps) {
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const allTasksQuery = useInfiniteQuery({
    queryKey: ['tasks', 'all', 'open'],
    queryFn: ({ pageParam }) => listAllTasks('open', pageParam ?? null, PAGE_SIZE),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.next_cursor,
  })
  const allTasks = allTasksQuery.data?.pages.flatMap((page) => page.items) ?? []
  const hasMore = Boolean(allTasksQuery.hasNextPage)

  // Intersection Observer for infinite scroll
  useEffect(() => {
    if (!loadMoreRef.current || !hasMore || allTasksQuery.isFetchingNextPage) {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !allTasksQuery.isFetchingNextPage) {
          void allTasksQuery.fetchNextPage()
        }
      },
      { rootMargin: '200px' }
    )

    observer.observe(loadMoreRef.current)

    return () => observer.disconnect()
  }, [allTasksQuery, hasMore])

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

  if (allTasksQuery.isLoading && allTasks.length === 0) {
    return (
      <div className="rounded-card bg-surface-container p-6 text-sm text-on-surface-variant">
        Loading all tasks...
      </div>
    )
  }

  if (allTasksQuery.isError) {
    return (
      <div className="flex items-start gap-3 rounded-card border border-error/35 bg-[rgba(80,18,18,0.92)] p-4 shadow-[0_18px_36px_rgba(0,0,0,0.4)]">
        <svg className="w-5 h-5 shrink-0 mt-0.5 text-error" fill="none" viewBox="0 0 24 24" stroke="currentColor">
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
        </svg>
        <p className="font-body text-sm font-medium text-red-100 leading-relaxed">
          Error loading tasks: {allTasksQuery.error instanceof Error ? allTasksQuery.error.message : 'Unknown error'}
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
                onPrepareOpen={onTaskPrepareOpen}
                onComplete={onTaskComplete}
                onDelete={onTaskDelete}
                isBusy={busyTaskIds.includes(task.id)}
              />
            ))}
          </div>
        </section>
      ))}

      {/* Load more trigger */}
      <div ref={loadMoreRef} className="h-4" />

      {(allTasksQuery.isFetching || allTasksQuery.isFetchingNextPage) && (
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
