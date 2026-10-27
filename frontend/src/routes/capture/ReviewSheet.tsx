import { useMemo } from 'react'
import { PartyPopper, Plus } from 'lucide-react'

import { Button } from '../../components/Button'
import { BottomSheet } from '../../components/ui/BottomSheet'
import { EmptyState } from '../../components/ui/controls'
import type { ExtractedTask } from '../../lib/api'
import { BulkReviewFooter, ExtractedTaskList } from './CaptureSheet'
import { useBulkAction } from './useBulkAction'
import type { useCaptureController } from './useCaptureController'

type CaptureController = ReturnType<typeof useCaptureController>

function captureLabel(createdAt: string) {
  const date = new Date(createdAt)
  if (Number.isNaN(date.getTime())) return 'Earlier capture'
  return `Captured ${new Intl.DateTimeFormat(undefined, { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(date)}`
}

function groupByCapture(tasks: ExtractedTask[]) {
  const groups = new Map<string, ExtractedTask[]>()
  for (const task of tasks) groups.set(task.capture_id, [...(groups.get(task.capture_id) ?? []), task])
  return [...groups.entries()]
    .map(([captureId, items]) => ({ captureId, items, createdAt: items[0]?.created_at ?? '' }))
    .sort((left, right) => right.createdAt.localeCompare(left.createdAt))
}

/** Every extracted task that has not been approved or discarded yet, across all captures. */
export function ReviewSheet({ controller, open, onClose, onCapture }: { controller: CaptureController; open: boolean; onClose: () => void; onCapture: () => void }) {
  const { queries, review } = controller
  const tasks = queries.pendingTasks
  const captures = useMemo(() => groupByCapture(tasks), [tasks])
  const bulk = useBulkAction()
  const isLoading = queries.pending.isLoading

  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      // No visible header; the count stays in the accessible name. Swipe, backdrop tap, Escape, back and a hidden close button all close it.
      ariaLabel={tasks.length > 0 ? `${tasks.length} pending ${tasks.length === 1 ? 'task' : 'tasks'}` : 'Review'}
      bodyClassName="overflow-y-auto px-5 pb-6 pt-2"
      closeLabel="Close review"
      footer={tasks.length > 0 ? (
        <BulkReviewFooter count={tasks.length} running={bulk.running} onApproveAll={() => void bulk.run('approve', review.approveEverything)} onDiscardAll={() => void bulk.run('discard', review.discardEverything)} />
      ) : undefined}
    >
      {isLoading ? (
        <div className="space-y-3 pt-1" aria-busy="true">
          {[0, 1, 2].map((row) => <div key={row} className="skeleton-shimmer h-[6.5rem] rounded-[1.35rem]" />)}
        </div>
      ) : null}
      {!isLoading && tasks.length === 0 ? (
        <EmptyState bare icon={PartyPopper} title="All caught up" action={<Button variant="primary" onClick={onCapture}><Plus className="h-4 w-4" strokeWidth={2.4} />New capture</Button>}>
          Extracted tasks you haven&apos;t approved yet will wait here until you review them.
        </EmptyState>
      ) : null}
      <div className="space-y-6">
        {captures.map((capture) => (
          <section key={capture.captureId} className="space-y-2.5" aria-label={captureLabel(capture.createdAt)}>
            <p className="px-1 font-body text-[0.72rem] font-semibold uppercase tracking-[0.14em] text-on-surface-variant">{captureLabel(capture.createdAt)}</p>
            <ExtractedTaskList tasks={capture.items} onApprove={review.approve} onDiscard={review.discard} onOpen={controller.state.setEditTask} />
          </section>
        ))}
      </div>
    </BottomSheet>
  )
}
