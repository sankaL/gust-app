import { StagingTable } from './StagingTable'
import type { useDesktopCaptureReview } from '../hooks/useDesktopCaptureReview'
import type { ExtractedTask } from '../lib/api'

type Review = ReturnType<typeof useDesktopCaptureReview>

function LatestCapture({ review, onEdit }: { review: Review; onEdit: (task: ExtractedTask) => void }) {
  if (!review.captureId) return null
  return <div className="space-y-4"><StagingTable tasks={review.latestTasks} onApprove={review.approve} onDiscard={review.discard} onApproveAll={review.approveLatest} onDiscardAll={review.discardLatest} onTaskClick={onEdit} isLoading={review.extractedQuery.isLoading || review.extractedQuery.isFetching} title="Newly extracted tasks" subtext="Review and approve tasks from your latest desktop recording" emptyMessage="No newly captured tasks to review" variant="desktop" /><div className="flex justify-end"><button type="button" onClick={() => review.complete.mutate()} disabled={review.complete.isPending} className="rounded-pill border border-outline px-4 py-2 text-sm font-medium text-on-surface-variant transition hover:bg-surface-container hover:text-on-surface disabled:opacity-60">{review.complete.isPending ? 'Finishing...' : 'Done'}</button></div></div>
}

function PendingCaptures({ review, onEdit }: { review: Review; onEdit: (task: ExtractedTask) => void }) {
  if (review.visiblePendingTasks.length === 0) return null
  return <StagingTable tasks={review.visiblePendingTasks} onApprove={review.approve} onDiscard={review.discard} onApproveAll={review.approvePending} onDiscardAll={review.discardPending} onTaskClick={onEdit} isLoading={review.pendingQuery.isLoading || review.pendingQuery.isFetching} title={review.captureId ? 'Older pending tasks' : 'Pending capture tasks'} subtext="Extracted tasks awaiting review" emptyMessage="No pending tasks to review" variant="desktop" />
}

export function DesktopCaptureReviewView({ review, onEdit }: { review: Review; onEdit: (task: ExtractedTask) => void }) {
  const empty = !review.captureId && review.visiblePendingTasks.length === 0
  return <section className="w-full space-y-6"><LatestCapture review={review} onEdit={onEdit} /><PendingCaptures review={review} onEdit={onEdit} />{empty ? <div className="py-12 text-center"><p className="font-display text-2xl text-on-surface">No capture tasks to review</p><p className="mt-2 font-body text-sm text-on-surface-variant">Use the floating mic button to record a desktop capture.</p></div> : null}</section>
}
