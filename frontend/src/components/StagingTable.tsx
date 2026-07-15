import { useState } from 'react'
import { ExtractedTask } from '../lib/api'
import { ExtractedTaskCard } from './ExtractedTaskCard'
import { Button } from './Button'
import { useNotifications } from './Notifications'
interface StagingTableProps {
  tasks: ExtractedTask[]
  onApprove: (taskId: string) => Promise<void>
  onDiscard: (taskId: string) => Promise<void>
  onApproveAll: () => Promise<void>
  onDiscardAll: () => Promise<void>
  onTaskClick: (task: ExtractedTask) => void
  isLoading?: boolean
  title?: string
  subtext?: string
  emptyMessage?: string
  variant?: 'mobile' | 'desktop'
}

type BulkActionButtonsProps = {
  isApproving: boolean
  isDiscarding: boolean
  disabled: boolean
  onApprove: () => void
  onDiscard: () => void
  className: string
}

function BulkActionButtons({
  isApproving,
  isDiscarding,
  disabled,
  onApprove,
  onDiscard,
  className,
}: BulkActionButtonsProps) {
  return (
    <div className={className}>
      <Button size="sm" variant="solid" onClick={onApprove} disabled={disabled} className="w-full justify-center sm:w-auto">
        {isApproving ? '...' : 'Approve All'}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={onDiscard}
        disabled={disabled}
        className="w-full justify-center text-tertiary hover:bg-tertiary/10 hover:text-tertiary sm:w-auto"
      >
        {isDiscarding ? '...' : 'Discard All'}
      </Button>
    </div>
  )
}

function ReviewCount({ count, className }: { count: number; className: string }) {
  if (count === 0) return null
  return (
    <span className={className}>
      {count} task{count !== 1 ? 's' : ''} need{count === 1 ? 's' : ''} review
    </span>
  )
}

export function StagingTable({
  tasks,
  onApprove,
  onDiscard,
  onApproveAll,
  onDiscardAll,
  onTaskClick,
  isLoading = false,
  title = 'Extracted Tasks',
  subtext,
  emptyMessage = 'No extracted tasks to review',
  variant = 'mobile'
}: StagingTableProps) {
  const [isApprovingAll, setIsApprovingAll] = useState(false)
  const [isDiscardingAll, setIsDiscardingAll] = useState(false)
  const { notifyError } = useNotifications()

  const handleApproveAll = async () => {
    setIsApprovingAll(true)
    try {
      await onApproveAll()
    } catch (error) {
      notifyError(
        error instanceof Error ? error.message : 'Approve all could not be completed.'
      )
    } finally {
      setIsApprovingAll(false)
    }
  }

  const handleDiscardAll = async () => {
    setIsDiscardingAll(true)
    try {
      await onDiscardAll()
    } catch (error) {
      notifyError(
        error instanceof Error ? error.message : 'Discard all could not be completed.'
      )
    } finally {
      setIsDiscardingAll(false)
    }
  }

  const pendingTasks = tasks.filter(t => t.status === 'pending')
  const needsReviewCount = pendingTasks.filter(t => t.needs_review).length
  const bulkActionsDisabled =
    isApprovingAll || isDiscardingAll || isLoading || pendingTasks.length === 0
  const bulkActionProps = {
    isApproving: isApprovingAll,
    isDiscarding: isDiscardingAll,
    disabled: bulkActionsDisabled,
    onApprove: () => { void handleApproveAll() },
    onDiscard: () => { void handleDiscardAll() },
  }

  if (isLoading) {
    return (
      <div className="space-y-3">
        <div className="space-y-2">
          <div className="h-4 w-40 animate-pulse rounded-full bg-white/10" />
          <div className="h-3 w-56 animate-pulse rounded-full bg-white/5" />
        </div>
        {Array.from({ length: 3 }).map((_, index) => (
          <div key={index} className="rounded-card bg-surface-container-high p-4">
            <div className="space-y-3">
              <div className="h-4 w-3/4 animate-pulse rounded-full bg-white/10" />
              <div className="h-3 w-full animate-pulse rounded-full bg-white/5" />
              <div className="h-3 w-2/3 animate-pulse rounded-full bg-white/5" />
            </div>
          </div>
        ))}
        <p className="text-center text-sm text-on-surface-variant">Loading extracted tasks...</p>
      </div>
    )
  }

  if (tasks.length === 0) {
    return (
      <div className="py-8 text-center">
        <p className="text-on-surface-variant text-sm">{emptyMessage}</p>
      </div>
    )
  }

  return (
    <div className="w-full space-y-4">
      {/* Bulk actions */}
      {variant === 'desktop' ? (
        <div className="flex items-center justify-between gap-3 border-b border-outline/60 pb-3">
          <h2 className="sr-only">
            {title} ({pendingTasks.length})
          </h2>
          <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 font-body text-xs text-on-surface-variant">
            <span>{pendingTasks.length} pending</span>
            <ReviewCount count={needsReviewCount} className="font-semibold text-warning" />
          </div>
          <BulkActionButtons {...bulkActionProps} className="flex flex-col gap-2 sm:flex-row sm:items-center sm:shrink-0" />
        </div>
      ) : (
        <div className="space-y-3">
          <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
            <div className="flex-1 min-w-0">
              <h2 className="text-base font-display text-on-surface truncate">
                {title} <span className="text-on-surface-variant font-body">({pendingTasks.length})</span>
              </h2>
              {subtext && (
                <p className="text-xs text-on-surface-variant mt-1.5 leading-relaxed">
                  {subtext}
                </p>
              )}
              <ReviewCount count={needsReviewCount} className="mt-1 block text-xs text-warning" />
            </div>
            <BulkActionButtons {...bulkActionProps} className="flex w-full flex-col gap-2 sm:w-auto sm:shrink-0" />
          </div>
        </div>
      )}

      {/* Task List */}
      <div className={variant === 'desktop' ? "flex flex-col gap-2" : "space-y-3"}>
        {pendingTasks.map(task => (
          <ExtractedTaskCard
            key={task.id}
            task={task}
            onApprove={onApprove}
            onDiscard={onDiscard}
            onClick={onTaskClick}
            variant={variant}
          />
        ))}
      </div>
    </div>
  )
}
