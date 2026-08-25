import { useCallback, useEffect, useMemo, useRef } from 'react'
import { useInfiniteQuery, useQueryClient } from '@tanstack/react-query'
import { useWindowVirtualizer } from '@tanstack/react-virtual'

import { useAppShellActions } from '../components/AppShellActions'
import { TaskScreenRefreshButton } from '../components/TaskScreenRefresh'
import type { VirtualTaskItem } from '../components/VirtualTaskRows'
import { listAllTasks, type TaskSummary } from '../lib/api'
import { getTodayIsoDate } from '../lib/desktopData'
import { refreshTaskScreenQueries, TASK_SCREEN_GC_TIME_MS, TASK_SCREEN_STALE_TIME_MS } from '../lib/taskScreenCache'

const PAGE_SIZE = 50
const QUERY_KEY = ['tasks', 'all', 'open', 'infinite'] as const
const HEADER_HEIGHT = 48
const CARD_HEIGHT = 100
const sections = [
  { key: 'today', label: 'Today' },
  { key: 'overdue', label: 'Overdue' },
  { key: 'others', label: 'Others' },
] as const

function taskSection(task: TaskSummary, today: string): 'today' | 'overdue' | 'others' {
  if (!task.due_date) return 'others'
  if (task.due_date === today) return 'today'
  return task.due_date < today ? 'overdue' : 'others'
}

function buildVirtualItems(tasks: TaskSummary[], today: string): VirtualTaskItem[] {
  const grouped = { today: [] as TaskSummary[], overdue: [] as TaskSummary[], others: [] as TaskSummary[] }
  for (const task of tasks) grouped[taskSection(task, today)].push(task)
  return sections.flatMap((section) => {
    const sectionTasks = grouped[section.key]
    if (sectionTasks.length === 0) return []
    return [{ type: 'header' as const, sectionKey: section.key, label: section.label, count: sectionTasks.length }, ...sectionTasks.map((task) => ({ type: 'task' as const, task }))]
  })
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

export function useAllTasksViewModel(userTimezone: string | null, searchQuery = '') {
  const queryClient = useQueryClient()
  const shellActions = useAppShellActions()
  const loadMoreRef = useRef<HTMLDivElement>(null)
  const listRef = useRef<HTMLDivElement>(null)
  const query = useInfiniteQuery({
    queryKey: [...QUERY_KEY, searchQuery],
    queryFn: ({ pageParam }) => listAllTasks('open', pageParam ?? null, PAGE_SIZE, null, null, searchQuery),
    initialPageParam: null as string | null,
    getNextPageParam: (lastPage) => lastPage.next_cursor,
    staleTime: TASK_SCREEN_STALE_TIME_MS,
    gcTime: TASK_SCREEN_GC_TIME_MS,
    placeholderData: (previous) => previous,
  })
  const refresh = useCallback(() => refreshTaskScreenQueries(queryClient, { statuses: ['open'], includeAllOpen: true }), [queryClient])
  const tasks = useMemo(() => query.data?.pages.flatMap((page) => page.items) ?? [], [query.data])
  const todayIso = getTodayIsoDate(userTimezone)
  const items = useMemo(() => buildVirtualItems(tasks, todayIso), [tasks, todayIso])
  const virtualizer = useTaskVirtualizer(items, listRef)
  const isRefreshing = query.isFetching && !query.isFetchingNextPage

  useAllTasksRefreshButton(shellActions, isRefreshing, refresh)
  const loadMore = useCallback(() => query.fetchNextPage(), [query])
  useLoadMoreObserver({ loadMoreRef, enabled: Boolean(query.hasNextPage) && !query.isFetchingNextPage, loadMore })

  return { query, tasks, items, todayIso, virtualizer, loadMoreRef, listRef, refresh, isRefreshing, hasMore: Boolean(query.hasNextPage) }
}
