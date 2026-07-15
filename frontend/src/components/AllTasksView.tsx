import type { TaskSummary } from '../lib/api'
import { useAllTasksViewModel } from '../hooks/useAllTasksViewModel'
import { PullToRefresh } from './TaskScreenRefresh'
import { VirtualTaskRows } from './VirtualTaskRows'

interface AllTasksViewProps {
  userTimezone: string | null
  onTaskOpen: (taskId: string) => void
  onTaskPrepareOpen?: (taskId: string) => void
  onTaskComplete: (task: TaskSummary) => void
  onTaskDelete: (task: TaskSummary) => void
  busyTaskIds?: string[]
}

function LoadingTasks() {
  return <div className="space-y-6"><section className="space-y-3"><div className="flex items-center justify-between"><div className="h-7 w-24 animate-pulse rounded bg-surface-container-highest" /><div className="h-4 w-16 animate-pulse rounded bg-surface-container-highest" /></div><div className="space-y-2">{[1, 2, 3].map((value) => <div key={value} className="h-24 animate-pulse rounded-card bg-surface-container-high" />)}</div></section></div>
}

function TaskLoadError({ error }: { error: unknown }) {
  return <div className="space-y-3"><div className="flex items-start gap-3 rounded-card border border-error/35 bg-[rgba(80,18,18,0.92)] p-4 shadow-[0_18px_36px_rgba(0,0,0,0.4)]"><p className="font-body text-sm font-medium leading-relaxed text-red-100">Error loading tasks: {error instanceof Error ? error.message : 'Unknown error'}</p></div></div>
}

function EmptyTasks({ refreshing, refresh }: { refreshing: boolean; refresh: () => Promise<void> }) {
  return <PullToRefresh isRefreshing={refreshing} onRefresh={refresh}><div className="space-y-3"><div className="rounded-soft bg-surface-container p-6 shadow-ambient"><p className="font-display text-2xl text-on-surface">No tasks across any group</p><p className="mt-3 font-body text-sm leading-6 text-on-surface-variant">Capture a voice note to create tasks, or move tasks into groups.</p></div></div></PullToRefresh>
}

export function AllTasksView({ userTimezone, onTaskOpen, onTaskPrepareOpen, onTaskComplete, onTaskDelete, busyTaskIds = [] }: AllTasksViewProps) {
  const model = useAllTasksViewModel(userTimezone)
  if (model.query.isLoading && model.tasks.length === 0) return <LoadingTasks />
  if (model.query.isError) return <TaskLoadError error={model.query.error} />
  if (model.tasks.length === 0) return <EmptyTasks refreshing={model.isRefreshing} refresh={model.refresh} />
  return (
    <PullToRefresh isRefreshing={model.isRefreshing} onRefresh={model.refresh} getScrollTop={() => model.scrollRef.current?.scrollTop ?? window.scrollY}>
      <div className="flex flex-col gap-3">
        <div ref={model.scrollRef} className="relative overflow-auto" style={{ maxHeight: 'calc(100vh - 200px)' }}>
          <div style={{ height: `${model.virtualizer.getTotalSize()}px`, width: '100%', position: 'relative' }}>
            <VirtualTaskRows rows={model.virtualizer.getVirtualItems()} items={model.items} busyTaskIds={busyTaskIds} measure={model.virtualizer.measureElement} onOpen={onTaskOpen} onPrepareOpen={onTaskPrepareOpen} onComplete={onTaskComplete} onDelete={onTaskDelete} />
          </div>
          <div ref={model.loadMoreRef} className="h-1" />
        </div>
        {(model.query.isFetching || model.query.isFetchingNextPage) && <div className="py-2 text-center text-sm text-on-surface-variant">Loading more tasks...</div>}
        {!model.hasMore && <div className="py-2 text-center text-sm text-on-surface-variant">All tasks loaded</div>}
      </div>
    </PullToRefresh>
  )
}
