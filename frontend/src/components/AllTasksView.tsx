import { Coffee, SearchX, Sparkles } from 'lucide-react'

import type { TaskSummary } from '../lib/api'
import { Button } from './Button'
import { EmptyState, InlineNotice } from './ui/controls'
import { useAllTasksViewModel } from '../hooks/useAllTasksViewModel'
import { PullToRefresh } from './TaskScreenRefresh'
import { VirtualTaskRows } from './VirtualTaskRows'

interface AllTasksViewProps {
  userTimezone: string | null
  dayFilter?: string | null
  searchQuery: string
  requestSearchQuery: string
  isSearchActive: boolean
  isSearchDebouncing: boolean
  onTaskOpen: (taskId: string) => void
  onTaskPrepareOpen?: (taskId: string) => void
  onTaskComplete: (task: TaskSummary) => void
  onTaskDelete: (task: TaskSummary) => void
  busyTaskIds?: string[]
}

export function TaskListSkeleton() {
  return (
    <div className="space-y-3 pt-4" aria-busy="true">
      <div className="skeleton-shimmer h-5 w-28 rounded-pill" />
      {[1, 2, 3].map((value) => <div key={value} className="skeleton-shimmer h-[7.5rem] rounded-[1.4rem]" />)}
    </div>
  )
}

export function TaskLoadError({ searching, onRetry }: { searching: boolean; onRetry: () => void }) {
  return <div className="pt-4"><InlineNotice tone="error" role="alert" title={searching ? 'Could not search tasks.' : 'Could not load tasks.'} action={<Button variant="primary" size="sm" onClick={onRetry}>Try again</Button>} /></div>
}

function EmptyTasks({ refreshing, refresh, searchQuery, isDayFiltered }: { refreshing: boolean; refresh: () => Promise<void>; searchQuery: string; isDayFiltered: boolean }) {
  if (searchQuery) return <div className="pt-4"><EmptyState icon={SearchX} title={`No tasks match "${searchQuery}"`}>Try a different task title or detail.</EmptyState></div>
  if (isDayFiltered) return <div className="pt-4"><EmptyState icon={Coffee} title="Nothing due this day">Enjoy the breathing room, or tap + to plan something.</EmptyState></div>
  return <PullToRefresh isRefreshing={refreshing} onRefresh={refresh}><div className="pt-4"><EmptyState icon={Sparkles} title="No tasks across any group">Capture a voice note to create tasks, or move tasks into groups.</EmptyState></div></PullToRefresh>
}

type AllTasksModel = ReturnType<typeof useAllTasksViewModel>

function AllTaskResults({ model, isSearchPending, onTaskOpen, onTaskPrepareOpen, onTaskComplete, onTaskDelete, busyTaskIds }: {
  model: AllTasksModel
  isSearchPending: boolean
  onTaskOpen: (taskId: string) => void
  onTaskPrepareOpen?: (taskId: string) => void
  onTaskComplete: (task: TaskSummary) => void
  onTaskDelete: (task: TaskSummary) => void
  busyTaskIds: string[]
}) {
  return <PullToRefresh isRefreshing={model.isRefreshing} onRefresh={model.refresh} getScrollTop={() => window.scrollY}><div aria-busy={isSearchPending} className={`flex flex-col transition-opacity duration-200 motion-reduce:transition-none ${isSearchPending ? 'opacity-55' : 'opacity-100'}`}><div ref={model.listRef} style={{ height: `${model.virtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}><VirtualTaskRows rows={model.virtualizer.getVirtualItems()} items={model.items} todayIso={model.todayIso} busyTaskIds={busyTaskIds} measure={model.virtualizer.measureElement} onOpen={onTaskOpen} onPrepareOpen={onTaskPrepareOpen} onComplete={onTaskComplete} onDelete={onTaskDelete} scrollMargin={model.virtualizer.options.scrollMargin ?? 0} /></div><div ref={model.loadMoreRef} className="h-1" />{(model.query.isFetching || model.query.isFetchingNextPage) && <div className="py-3 text-center font-body text-xs font-medium text-on-surface-variant">Loading more tasks...</div>}</div></PullToRefresh>
}

function AllTasksContent({ model, normalizedSearchQuery, isSearchPending, ...actions }: {
  model: AllTasksModel
  normalizedSearchQuery: string
  isSearchPending: boolean
  onTaskOpen: (taskId: string) => void
  onTaskPrepareOpen?: (taskId: string) => void
  onTaskComplete: (task: TaskSummary) => void
  onTaskDelete: (task: TaskSummary) => void
  busyTaskIds: string[]
}) {
  if (model.query.isLoading && model.tasks.length === 0) return <TaskListSkeleton />
  if (model.query.isError) return <TaskLoadError searching={Boolean(normalizedSearchQuery)} onRetry={() => { void model.query.refetch() }} />
  if (model.items.length === 0) return <EmptyTasks refreshing={model.isRefreshing} refresh={model.refresh} searchQuery={normalizedSearchQuery} isDayFiltered={model.isDayFiltered} />
  return <AllTaskResults model={model} isSearchPending={isSearchPending} {...actions} />
}

export function AllTasksView({ userTimezone, dayFilter = null, searchQuery, requestSearchQuery, isSearchActive, isSearchDebouncing, ...actions }: AllTasksViewProps) {
  const model = useAllTasksViewModel(userTimezone, requestSearchQuery, dayFilter)
  const normalizedSearchQuery = isSearchActive ? searchQuery.trim() : ''
  const searchRequestPending = Boolean(normalizedSearchQuery && model.query.isFetching && !model.query.isFetchingNextPage)
  return <AllTasksContent model={model} normalizedSearchQuery={normalizedSearchQuery} isSearchPending={isSearchDebouncing || searchRequestPending} {...actions} busyTaskIds={actions.busyTaskIds ?? []} />
}
