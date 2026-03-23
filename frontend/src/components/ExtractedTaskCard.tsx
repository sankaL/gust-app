import { useState } from 'react'
import { ExtractedTask } from '../lib/api'

interface ExtractedTaskCardProps {
  task: ExtractedTask
  onApprove: (taskId: string) => void
  onDiscard: (taskId: string) => void
}

export function ExtractedTaskCard({
  task,
  onApprove,
  onDiscard
}: ExtractedTaskCardProps) {
  const [isApproving, setIsApproving] = useState(false)
  const [isDiscarding, setIsDiscarding] = useState(false)

  const handleApprove = async () => {
    setIsApproving(true)
    try {
      await onApprove(task.id)
    } finally {
      setIsApproving(false)
    }
  }

  const handleDiscard = async () => {
    setIsDiscarding(true)
    try {
      await onDiscard(task.id)
    } finally {
      setIsDiscarding(false)
    }
  }

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return 'text-green-400'
    if (confidence >= 0.7) return 'text-yellow-400'
    return 'text-red-400'
  }

  const getConfidenceLabel = (confidence: number) => {
    if (confidence >= 0.8) return 'High'
    if (confidence >= 0.7) return 'Medium'
    return 'Low'
  }

  return (
    <div className="bg-gray-800 rounded-lg p-4 border border-gray-700">
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2">
            <h3 className="text-sm font-medium text-white truncate">
              {task.title}
            </h3>
            {task.needs_review && (
              <span className="px-2 py-0.5 text-xs font-medium bg-yellow-900 text-yellow-200 rounded">
                Needs Review
              </span>
            )}
          </div>

          <div className="space-y-1 text-xs text-gray-400">
            {task.group_name && (
              <div className="flex items-center gap-1">
                <span className="text-gray-500">Group:</span>
                <span>{task.group_name}</span>
              </div>
            )}

            {task.due_date && (
              <div className="flex items-center gap-1">
                <span className="text-gray-500">Due:</span>
                <span>{new Date(task.due_date).toLocaleDateString()}</span>
              </div>
            )}

            {task.recurrence_frequency && (
              <div className="flex items-center gap-1">
                <span className="text-gray-500">Recurrence:</span>
                <span className="capitalize">{task.recurrence_frequency}</span>
              </div>
            )}

            <div className="flex items-center gap-1">
              <span className="text-gray-500">Confidence:</span>
              <span className={getConfidenceColor(task.top_confidence)}>
                {getConfidenceLabel(task.top_confidence)} ({Math.round(task.top_confidence * 100)}%)
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2">
          <button
            onClick={handleApprove}
            disabled={isApproving || isDiscarding}
            className="px-3 py-1.5 text-xs font-medium text-white bg-green-600 hover:bg-green-700 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isApproving ? 'Approving...' : 'Approve'}
          </button>
          <button
            onClick={handleDiscard}
            disabled={isApproving || isDiscarding}
            className="px-3 py-1.5 text-xs font-medium text-white bg-red-600 hover:bg-red-700 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isDiscarding ? 'Discarding...' : 'Discard'}
          </button>
        </div>
      </div>
    </div>
  )
}
