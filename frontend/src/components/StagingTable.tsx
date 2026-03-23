import { useState } from 'react'
import { ExtractedTask } from '../lib/api'
import { ExtractedTaskCard } from './ExtractedTaskCard'

interface StagingTableProps {
  tasks: ExtractedTask[]
  onApprove: (taskId: string) => Promise<void>
  onDiscard: (taskId: string) => Promise<void>
  onApproveAll: () => Promise<void>
  onDiscardAll: () => Promise<void>
  isLoading?: boolean
}

export function StagingTable({
  tasks,
  onApprove,
  onDiscard,
  onApproveAll,
  onDiscardAll,
  isLoading = false
}: StagingTableProps) {
  const [isApprovingAll, setIsApprovingAll] = useState(false)
  const [isDiscardingAll, setIsDiscardingAll] = useState(false)

  const handleApproveAll = async () => {
    setIsApprovingAll(true)
    try {
      await onApproveAll()
    } finally {
      setIsApprovingAll(false)
    }
  }

  const handleDiscardAll = async () => {
    setIsDiscardingAll(true)
    try {
      await onDiscardAll()
    } finally {
      setIsDiscardingAll(false)
    }
  }

  if (tasks.length === 0) {
    return (
      <div className="bg-gray-800 rounded-lg p-6 text-center">
        <p className="text-gray-400 text-sm">No extracted tasks to review</p>
      </div>
    )
  }

  const pendingTasks = tasks.filter(t => t.status === 'pending')
  const needsReviewCount = pendingTasks.filter(t => t.needs_review).length

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <div>
          <h2 className="text-lg font-semibold text-white">
            Extracted Tasks ({pendingTasks.length})
          </h2>
          {needsReviewCount > 0 && (
            <p className="text-sm text-yellow-400 mt-1">
              {needsReviewCount} task{needsReviewCount !== 1 ? 's' : ''} need{needsReviewCount === 1 ? 's' : ''} review
            </p>
          )}
        </div>
        <div className="flex gap-2">
          <button
            onClick={handleApproveAll}
            disabled={isApprovingAll || isDiscardingAll || isLoading || pendingTasks.length === 0}
            className="px-4 py-2 text-sm font-medium text-white bg-green-600 hover:bg-green-700 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isApprovingAll ? 'Approving...' : 'Approve All'}
          </button>
          <button
            onClick={handleDiscardAll}
            disabled={isApprovingAll || isDiscardingAll || isLoading || pendingTasks.length === 0}
            className="px-4 py-2 text-sm font-medium text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isDiscardingAll ? 'Discarding...' : 'Discard All'}
          </button>
        </div>
      </div>

      {isLoading ? (
        <div className="bg-gray-800 rounded-lg p-6 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-white mx-auto"></div>
          <p className="text-gray-400 text-sm mt-2">Loading extracted tasks...</p>
        </div>
      ) : (
        <div className="space-y-3">
          {pendingTasks.map(task => (
            <ExtractedTaskCard
              key={task.id}
              task={task}
              onApprove={onApprove}
              onDiscard={onDiscard}
            />
          ))}
        </div>
      )}
    </div>
  )
}
