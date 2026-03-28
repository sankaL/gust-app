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
  emptyMessage = 'No extracted tasks to review'
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



  if (tasks.length === 0) {
    return (
      <div className="bg-surface-dim rounded-lg p-6 text-center">
        <p className="text-on-surface-variant text-sm">{emptyMessage}</p>
      </div>
    )
  }

  return (
    <div className="space-y-4">
      {/* Header Section */}
      <div className="space-y-3">
        {/* Top row: Title + Bulk Actions */}
        <div className="flex items-start justify-between gap-3">
          <div className="flex-1 min-w-0">
            <h2 className="text-base font-display text-on-surface truncate">
              {title} <span className="text-on-surface-variant font-body">({pendingTasks.length})</span>
            </h2>
            {subtext && (
              <p className="text-xs text-on-surface-variant mt-1.5 leading-relaxed">
                {subtext}
              </p>
            )}
            {needsReviewCount > 0 && (
              <p className="text-xs text-warning mt-1">
                {needsReviewCount} task{needsReviewCount !== 1 ? 's' : ''} need{needsReviewCount === 1 ? 's' : ''} review
              </p>
            )}
          </div>

          <div className="flex flex-col gap-2 shrink-0">
            <Button
              size="sm"
              variant="solid"
              onClick={() => {
                void handleApproveAll()
              }}
              disabled={isApprovingAll || isDiscardingAll || isLoading || pendingTasks.length === 0}
              className="w-full justify-center"
            >
              {isApprovingAll ? '...' : 'Approve All'}
            </Button>
            <Button
              size="sm"
              variant="ghost"
              onClick={() => {
                void handleDiscardAll()
              }}
              disabled={isApprovingAll || isDiscardingAll || isLoading || pendingTasks.length === 0}
              className="text-tertiary hover:text-tertiary hover:bg-tertiary/10 w-full justify-center"
            >
              {isDiscardingAll ? '...' : 'Discard All'}
            </Button>
          </div>
        </div>
      </div>

      {/* Task List */}
      {isLoading ? (
        <div className="bg-surface-dim rounded-lg p-6 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="text-on-surface-variant text-sm mt-2">Loading extracted tasks...</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pendingTasks.map(task => (
            <ExtractedTaskCard
              key={task.id}
              task={task}
              onApprove={onApprove}
              onDiscard={onDiscard}
              onClick={onTaskClick}
            />
          ))}
        </div>
      )}
    </div>
  )
}
