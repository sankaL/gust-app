import type { TaskSummary } from '../lib/api'
import { useAllTasksViewModel } from '../hooks/useAllTasksViewModel'
import { PullToRefresh } from './TaskScreenRefresh'
import { VirtualTaskRows } from './VirtualTaskRows'

interface AllTasksViewProps {
  userTimezone: string | null
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

function LoadingTasks() {
  return <div className="space-y-6"><section className="space-y-3"><div className="flex items-center justify-between"><div className="h-7 w-24 animate-pulse rounded bg-surface-container-highest" /><div className="h-4 w-16 animate-pulse rounded bg-surface-container-highest" /></div><div className="space-y-2">{[1, 2, 3].map((value) => <div key={value} className="h-24 animate-pulse rounded-card bg-surface-container-high" />)}</div></section></div>
}

function TaskLoadError({ searching, onRetry }: { searching: boolean; onRetry: () => void }) {
  return <div className="space-y-3"><div className="rounded-card bg-[rgba(80,18,18,0.92)] p-4 shadow-[0_18px_36px_rgba(0,0,0,0.4)]"><p className="font-body text-sm font-medium leading-relaxed text-red-100">{searching ? 'Could not search tasks.' : 'Could not load tasks.'}</p><button type="button" onClick={onRetry} className="mt-3 rounded-pill bg-red-100 px-4 py-2 text-sm font-semibold text-red-950">Try again</button></div></div>
}

function EmptyTasks({ refreshing, refresh, searchQuery }: { refreshing: boolean; refresh: () => Promise<void>; searchQuery: string }) {
  if (searchQuery) return <div className="space-y-3"><div className="rounded-soft bg-surface-container p-6 shadow-ambient"><p className="font-display text-2xl text-on-surface">No tasks match "{searchQuery}"</p><p className="mt-3 font-body text-sm leading-6 text-on-surface-variant">Try a different task title or detail.</p></div></div>
  return <PullToRefresh isRefreshing={refreshing} onRefresh={refresh}><div className="space-y-3"><div className="rounded-soft bg-surface-container p-6 shadow-ambient"><p className="font-display text-2xl text-on-surface">No tasks across any group</p><p className="mt-3 font-body text-sm leading-6 text-on-surface-variant">Capture a voice note to create tasks, or move tasks into groups.</p></div></div></PullToRefresh>
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
  return <PullToRefresh isRefreshing={model.isRefreshing} onRefresh={model.refresh} getScrollTop={() => window.scrollY}><div aria-busy={isSearchPending} className={`flex flex-col gap-3 transition-opacity duration-200 motion-reduce:transition-none ${isSearchPending ? 'opacity-55' : 'opacity-100'}`}><div ref={model.listRef} style={{ height: `${model.virtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}><VirtualTaskRows rows={model.virtualizer.getVirtualItems()} items={model.items} todayIso={model.todayIso} busyTaskIds={busyTaskIds} measure={model.virtualizer.measureElement} onOpen={onTaskOpen} onPrepareOpen={onTaskPrepareOpen} onComplete={onTaskComplete} onDelete={onTaskDelete} scrollMargin={model.virtualizer.options.scrollMargin ?? 0} /></div><div ref={model.loadMoreRef} className="h-1" />{(model.query.isFetching || model.query.isFetchingNextPage) && <div className="py-2 text-center text-sm text-on-surface-variant">Loading more tasks...</div>}</div></PullToRefresh>
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
  if (model.query.isLoading && model.tasks.length === 0) return <LoadingTasks />
  if (model.query.isError) return <TaskLoadError searching={Boolean(normalizedSearchQuery)} onRetry={() => { void model.query.refetch() }} />
  if (model.tasks.length === 0) return <EmptyTasks refreshing={model.isRefreshing} refresh={model.refresh} searchQuery={normalizedSearchQuery} />
  return <AllTaskResults model={model} isSearchPending={isSearchPending} {...actions} />
}

export function AllTasksView({ userTimezone, searchQuery, requestSearchQuery, isSearchActive, isSearchDebouncing, ...actions }: AllTasksViewProps) {
  const model = useAllTasksViewModel(userTimezone, requestSearchQuery)
  const normalizedSearchQuery = isSearchActive ? searchQuery.trim() : ''
  const searchRequestPending = Boolean(normalizedSearchQuery && model.query.isFetching && !model.query.isFetchingNextPage)
  return <AllTasksContent model={model} normalizedSearchQuery={normalizedSearchQuery} isSearchPending={isSearchDebouncing || searchRequestPending} {...actions} busyTaskIds={actions.busyTaskIds ?? []} />
}
