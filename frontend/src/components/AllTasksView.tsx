import { useMemo, useRef, useEffect, useCallback } from 'react'
import { useInfiniteQuery } from '@tanstack/react-query'
import { useVirtualizer } from '@tanstack/react-virtual'
import { listAllTasks, type TaskSummary } from '../lib/api'
import { TASK_SCREEN_GC_TIME_MS, TASK_SCREEN_STALE_TIME_MS } from '../lib/queryTuning'
import { OpenTaskCard } from './OpenTaskCard'

interface AllTasksViewProps {
  userTimezone: string | null
  onTaskOpen: (taskId: string) => void
  onTaskPrepareOpen?: (taskId: string) => void
  onTaskComplete: (task: TaskSummary) => void
  onTaskDelete: (task: TaskSummary) => void
  busyTaskIds?: string[]
}

const PAGE_SIZE = 50
const ALL_TASKS_INFINITE_QUERY_KEY = ['tasks', 'all', 'open', 'infinite'] as const

// Estimated heights for virtualizer
const SECTION_HEADER_HEIGHT = 48
const TASK_CARD_HEIGHT = 100

type VirtualItemDef =
  | { type: 'header'; sectionKey: string; label: string; count: number }
  | { type: 'task'; task: TaskSummary }

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
      showCollapsedGroupLabel
    />
  )
}

const SECTIONS = [
  { key: 'today', label: 'Today' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'others', label: 'Others' },
] as const

function getTodayIsoDate(timezone: string | null): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone ?? undefined,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = formatter.formatToParts(new Date())
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value

  if (!year || !month || !day) {
    throw new Error('Failed to compute current date in user timezone.')
  }

  return `${year}-${month}-${day}`
}

function getTaskSection(
  task: TaskSummary,
  todayIsoDate: string
): 'today' | 'overdue' | 'others' {
  if (!task.due_date) {
    return 'others'
  }
  if (task.due_date === todayIsoDate) {
    return 'today'
  }
  if (task.due_date < todayIsoDate) {
    return 'overdue'
  }
  return 'others'
}

export function AllTasksView({
  userTimezone,
  onTaskOpen,
  onTaskPrepareOpen,
  onTaskComplete,
  onTaskDelete,
  busyTaskIds = [],
}: AllTasksViewProps) {
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const parentRef = useRef<HTMLDivElement>(null)

  const allTasksQuery = useInfiniteQuery({
    queryKey: ALL_TASKS_INFINITE_QUERY_KEY,
    queryFn: ({ pageParam }) => listAllTasks('open', pageParam ?? null, PAGE_SIZE),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.next_cursor,
    staleTime: TASK_SCREEN_STALE_TIME_MS,
    gcTime: TASK_SCREEN_GC_TIME_MS,
  })
  const allTasks = useMemo(
    () => allTasksQuery.data?.pages.flatMap((page) => page.items) ?? [],
    [allTasksQuery.data]
  )
  const hasMore = Boolean(allTasksQuery.hasNextPage)
  const todayIsoDate = useMemo(() => getTodayIsoDate(userTimezone), [userTimezone])

  const sectionedTasks = useMemo(() => {
    const result: Record<string, TaskSummary[]> = {
      today: [],
      overdue: [],
      others: [],
    }
    for (const task of allTasks) {
      const section = getTaskSection(task, todayIsoDate)
      result[section].push(task)
    }
    return result
  }, [allTasks, todayIsoDate])

  // Flatten sections into a single virtualizable array
  const virtualItems = useMemo((): VirtualItemDef[] => {
    const items: VirtualItemDef[] = []
    for (const section of SECTIONS) {
      const tasks = sectionedTasks[section.key]
      if (tasks.length === 0) continue
      items.push({ type: 'header', sectionKey: section.key, label: section.label, count: tasks.length })
      for (const task of tasks) {
        items.push({ type: 'task', task })
      }
    }
    return items
  }, [sectionedTasks])

  // Stable key function so the virtualizer tracks rows by identity, not shifted index
  const getItemKey = useCallback((index: number): string => {
    const item = virtualItems[index]
    if (!item) return String(index)
    return item.type === 'header' ? `header-${item.sectionKey}` : `task-${item.task.id}`
  }, [virtualItems])

  // Estimate size function for virtualizer
  const estimateSize = useCallback((index: number): number => {
    const item = virtualItems[index]
    if (!item) return TASK_CARD_HEIGHT
    return item.type === 'header' ? SECTION_HEADER_HEIGHT : TASK_CARD_HEIGHT
  }, [virtualItems])

  const virtualizer = useVirtualizer({
    count: virtualItems.length,
    getScrollElement: () => parentRef.current,
    getItemKey,
    estimateSize,
    overscan: 5,
    measureElement: (el) => el.getBoundingClientRect().height,
  })

  // Re-measure after the virtualized structure changes (e.g. task deleted, section header removed).
  // This prevents stale cached offsets from leaving a visual gap in the absolute-positioned layout.
  useEffect(() => {
    void virtualizer.measure()
  }, [virtualizer, virtualItems.length])

  // Intersection Observer for infinite scroll (attached to virtualized container)
  useEffect(() => {
    const loadMoreElement = loadMoreRef.current
    const scrollElement = parentRef.current

    if (!loadMoreElement || !scrollElement || !hasMore || allTasksQuery.isFetchingNextPage) {
      return
    }

    const observer = new IntersectionObserver(
      (entries) => {
        if (entries[0].isIntersecting && hasMore && !allTasksQuery.isFetchingNextPage) {
          void allTasksQuery.fetchNextPage()
        }
      },
      {
        root: scrollElement,
        rootMargin: '200px 0px',
      }
    )

    observer.observe(loadMoreElement)

    return () => observer.disconnect()
  }, [allTasksQuery, hasMore])

  if (allTasksQuery.isLoading && allTasks.length === 0) {
    return (
      <div className="space-y-6">
        {/* Skeleton loading state */}
        <section className="space-y-3">
          <div className="flex items-center justify-between">
            <div className="h-7 w-24 animate-pulse rounded bg-surface-container-highest" />
            <div className="h-4 w-16 animate-pulse rounded bg-surface-container-highest" />
          </div>
          <div className="space-y-2">
            {[1, 2, 3].map((i) => (
              <div
                key={i}
                className="h-24 animate-pulse rounded-card bg-surface-container-high"
              />
            ))}
          </div>
        </section>
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
    <div className="flex flex-col">
      {/* Virtualized scroll container */}
      <div
        ref={parentRef}
        className="relative overflow-auto"
        style={{ maxHeight: 'calc(100vh - 200px)' }}
      >
        <div
          style={{
            height: `${virtualizer.getTotalSize()}px`,
            width: '100%',
            position: 'relative',
          }}
        >
          {virtualizer.getVirtualItems().map((virtualRow) => {
            const item = virtualItems[virtualRow.index]
            if (!item) return null

            if (item.type === 'header') {
              return (
                <div
                  key={virtualRow.key}
                  data-index={virtualRow.index}
                  ref={virtualizer.measureElement}
                  style={{
                    position: 'absolute',
                    top: 0,
                    left: 0,
                    width: '100%',
                    transform: `translateY(${virtualRow.start}px)`,
                  }}
                  className="flex items-center justify-between px-1"
                >
                  <h3 className="font-display text-xl text-on-surface">{item.label}</h3>
                  <span className="font-body text-xs uppercase tracking-[0.1em] text-on-surface-variant">
                    {item.count} tasks
                  </span>
                </div>
              )
            }

            // Task card
            return (
              <div
                key={virtualRow.key}
                data-index={virtualRow.index}
                ref={virtualizer.measureElement}
                style={{
                  position: 'absolute',
                  top: 0,
                  left: 0,
                  width: '100%',
                  transform: `translateY(${virtualRow.start}px)`,
                }}
                className="px-1 py-1"
              >
                <TaskCard
                  task={item.task}
                  onOpen={onTaskOpen}
                  onPrepareOpen={onTaskPrepareOpen}
                  onComplete={onTaskComplete}
                  onDelete={onTaskDelete}
                  isBusy={busyTaskIds.includes(item.task.id)}
                />
              </div>
            )
          })}
        </div>

        {/* Load more trigger must live inside the scroll container for the observer root */}
        <div ref={loadMoreRef} className="h-1" />
      </div>

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
