import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useWindowVirtualizer } from '@tanstack/react-virtual'

import { useAppShellActions } from '../components/AppShellActions'
import { TaskScreenRefreshButton } from '../components/TaskScreenRefresh'
import type { VirtualTaskItem } from '../components/VirtualTaskRows'
import { listAllTasks, type TaskSummary } from '../lib/api'
import { getTodayIsoDate } from '../lib/desktopData'
import { formatRelativeDay } from '../lib/taskFormatters'
import { refreshTaskScreenQueries, TASK_SCREEN_GC_TIME_MS, TASK_SCREEN_STALE_TIME_MS } from '../lib/taskScreenCache'

const PAGE_SIZE = 50
const QUERY_KEY = ['tasks', 'all', 'open', 'infinite'] as const
const HEADER_HEIGHT = 52
const CARD_HEIGHT = 132
const MAX_DAY_FILTER_PAGES = 20
const sections = [
  { key: 'today', label: 'Today' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'upcoming', label: 'Upcoming' },
  { key: 'someday', label: 'No date' },
] as const

type SectionKey = typeof sections[number]['key']

function taskSection(task: TaskSummary, today: string): SectionKey {
  if (!task.due_date) return 'someday'
  if (task.due_date === today) return 'today'
  return task.due_date < today ? 'overdue' : 'upcoming'
}

function taskRows(tasks: TaskSummary[], highlightFirst: boolean): VirtualTaskItem[] {
  return tasks.map((task, index) => ({ type: 'task' as const, task, highlighted: highlightFirst && index === 0 }))
}

function buildVirtualItems(tasks: TaskSummary[], today: string, dayFilter: string | null = null): VirtualTaskItem[] {
  if (dayFilter && dayFilter !== today) {
    const dayTasks = tasks.filter((task) => task.due_date === dayFilter)
    if (dayTasks.length === 0) return []
    return [{ type: 'header' as const, sectionKey: dayFilter < today ? 'overdue' : 'upcoming', label: formatRelativeDay(dayFilter, today), count: dayTasks.length }, ...taskRows(dayTasks, false)]
  }
  const grouped: Record<SectionKey, TaskSummary[]> = { today: [], overdue: [], upcoming: [], someday: [] }
  for (const task of tasks) grouped[taskSection(task, today)].push(task)
  return sections.flatMap((section) => {
    const sectionTasks = grouped[section.key]
    if (sectionTasks.length === 0) return []
    return [{ type: 'header' as const, sectionKey: section.key, label: section.label, count: sectionTasks.length }, ...taskRows(sectionTasks, section.key === 'today')]
  })
}

/** Counts open tasks per due date so the week strip can mark busy days. */
export function countTasksByDueDate(tasks: TaskSummary[]): Record<string, number> {
  const counts: Record<string, number> = {}
  for (const task of tasks) if (task.due_date) counts[task.due_date] = (counts[task.due_date] ?? 0) + 1
  return counts
}

function virtualItemKey(items: VirtualTaskItem[], index: number) {
  const item = items[index]
  if (!item) return String(index)
  return item.type === 'header' ? `header-${item.sectionKey}` : `task-${item.task.id}`
}

function virtualItemSize(items: VirtualTaskItem[], index: number) {
  return items[index]?.type === 'header' ? HEADER_HEIGHT : CARD_HEIGHT
}

function useAllTasksRefreshButton(shellActions: ReturnType<typeof useAppShellActions>, isRefreshing: boolean, refresh: () => Promise<void>) {
  useEffect(() => {
    shellActions?.setTopBarAction(<TaskScreenRefreshButton isRefreshing={isRefreshing} label="Refresh tasks" onRefresh={refresh} />)
    return () => shellActions?.setTopBarAction(null)
  }, [isRefreshing, refresh, shellActions])
}

function useTaskVirtualizer(items: VirtualTaskItem[], listRef: React.RefObject<HTMLDivElement | null>) {
  const getItemKey = useCallback((index: number) => virtualItemKey(items, index), [items])
  const estimateSize = useCallback((index: number) => virtualItemSize(items, index), [items])
  const virtualizer = useWindowVirtualizer({
    count: items.length,
    getItemKey,
    estimateSize,
    overscan: 5,
    scrollMargin: listRef.current?.offsetTop ?? 0,
    measureElement: (element) => element.getBoundingClientRect().height,
  })
  useEffect(() => { void virtualizer.measure() }, [items.length, virtualizer])
  return virtualizer
}

function useLoadMoreObserver({
  loadMoreRef,
  enabled,
  loadMore,
}: {
  loadMoreRef: React.RefObject<HTMLDivElement | null>
  enabled: boolean
  loadMore: () => Promise<unknown>
}) {
  useEffect(() => {
    const target = loadMoreRef.current
    if (!target || !enabled) return
    const observer = new IntersectionObserver((entries) => {
      if (entries[0]?.isIntersecting) void loadMore()
    }, { rootMargin: '300px 0px' })
    observer.observe(target)
    return () => observer.disconnect()
  }, [enabled, loadMore, loadMoreRef])
}

export function useAllOpenTasksQuery(searchQuery = '', enabled = true) {
  const query = useInfiniteQuery({
    enabled,
    queryKey: [...QUERY_KEY, searchQuery],
    queryFn: ({ pageParam }) => listAllTasks('open', pageParam ?? null, PAGE_SIZE, null, null, searchQuery),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.next_cursor,
    staleTime: TASK_SCREEN_STALE_TIME_MS,
    gcTime: TASK_SCREEN_GC_TIME_MS,
    placeholderData: (previous) => previous,
  })
  const tasks = useMemo(() => query.data?.pages.flatMap((page) => (Array.isArray(page?.items) ? page.items : [])) ?? [], [query.data])
  return { query, tasks }
}

/** A day filter needs every page loaded to be complete; keep fetching, with a hard page cap. */
function useDayFilterBackfill(query: ReturnType<typeof useAllOpenTasksQuery>['query'], dayFilter: string | null) {
  const pageCount = query.data?.pages.length ?? 0
  const { hasNextPage, isFetchingNextPage, fetchNextPage } = query
  useEffect(() => {
    if (!dayFilter || !hasNextPage || isFetchingNextPage || pageCount >= MAX_DAY_FILTER_PAGES) return
    void fetchNextPage()
  }, [dayFilter, fetchNextPage, hasNextPage, isFetchingNextPage, pageCount])
}

export function useAllTasksViewModel(userTimezone: string | null, searchQuery = '', dayFilter: string | null = null) {
  const queryClient = useQueryClient()
  const shellActions = useAppShellActions()
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const { query, tasks } = useAllOpenTasksQuery(searchQuery)
  const refresh = useCallback(() => refreshTaskScreenQueries(queryClient, { statuses: ['open'], includeAllOpen: true }), [queryClient])
  const todayIso = getTodayIsoDate(userTimezone)
  useDayFilterBackfill(query, dayFilter)
  const items = useMemo(() => buildVirtualItems(tasks, todayIso, dayFilter), [dayFilter, tasks, todayIso])
  const virtualizer = useTaskVirtualizer(items, listRef)
  const isRefreshing = query.isFetching && !query.isFetchingNextPage

  useAllTasksRefreshButton(shellActions, isRefreshing, refresh)
  const loadMore = useCallback(() => query.fetchNextPage(), [query])
  useLoadMoreObserver({ loadMoreRef, enabled: Boolean(query.hasNextPage) && !query.isFetchingNextPage, loadMore })

  return { query, tasks, items, todayIso, virtualizer, loadMoreRef, listRef, refresh, isRefreshing, hasMore: Boolean(query.hasNextPage), isDayFiltered: Boolean(dayFilter && dayFilter !== todayIso) }
}
