import { useState } from 'react'
import { ExtractedTask } from '../lib/api'

interface ExtractedTaskCardProps {
  task: ExtractedTask
  onApprove: (taskId: string) => void
  onDiscard: (taskId: string) => void
  onClick: (task: ExtractedTask) => void
}

export function ExtractedTaskCard({
  task,
  onApprove,
  onDiscard,
  onClick
}: ExtractedTaskCardProps) {
  const [isApproving, setIsApproving] = useState(false)
  const [isDiscarding, setIsDiscarding] = useState(false)

  const handleApprove = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setIsApproving(true)
    try {
      await onApprove(task.id)
    } finally {
      setIsApproving(false)
    }
  }

  const handleDiscard = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setIsDiscarding(true)
    try {
      await onDiscard(task.id)
    } finally {
      setIsDiscarding(false)
    }
  }

  const handleCardClick = () => {
    onClick(task)
  }

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return 'text-primary'
    if (confidence >= 0.7) return 'text-warning'
    return 'text-tertiary'
  }

  const getConfidenceLabel = (confidence: number) => {
    if (confidence >= 0.8) return 'High'
    if (confidence >= 0.7) return 'Medium'
    return 'Low'
  }

  return (
    <div 
      className="bg-surface-dim rounded-lg p-4 border border-surface-variant transition-transform cursor-pointer hover:border-primary/50"
      style={{ willChange: 'transform' }}
      onClick={handleCardClick}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          {/* Title row with recurring icon */}
          <div className="flex items-center gap-2 mb-1 flex-wrap">
            {task.recurrence_frequency && task.recurrence_frequency !== 'none' && (
              <span className="text-primary text-sm" title={`Recurring: ${task.recurrence_frequency}`}>
                🔁
              </span>
            )}
            <h3 className="text-sm font-medium text-on-surface truncate">
              {task.title}
            </h3>
            {task.needs_review && (
              <span className="px-2 py-0.5 text-xs font-medium bg-warning/20 text-warning rounded">
                Needs Review
              </span>
            )}
          </div>

          {/* Condensed info row */}
          <div className="flex items-center gap-2 text-xs text-on-surface-variant flex-wrap">
            {task.group_name && (
              <span className="text-on-surface-variant/80">{task.group_name}</span>
            )}
            {task.group_name && task.due_date && (
              <span className="text-on-surface-variant/40">•</span>
            )}
            {task.due_date && (
              <span className="text-on-surface-variant/80">
                Due: {new Date(task.due_date + 'T00:00:00').toLocaleDateString()}
              </span>
            )}
            <span className="text-on-surface-variant/40">•</span>
            <span className={getConfidenceColor(task.top_confidence)}>
              {getConfidenceLabel(task.top_confidence)}
            </span>
          </div>
        </div>

        <div 
          className="flex items-center gap-2 shrink-0"
          onClick={(e) => e.stopPropagation()}
        >
          <button
            onClick={handleApprove}
            disabled={isApproving || isDiscarding}
            className="px-3 py-1.5 text-xs font-medium text-primary bg-primary/10 hover:bg-primary/20 border border-primary/30 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isApproving ? 'Approving...' : 'Approve'}
          </button>
          <button
            onClick={handleDiscard}
            disabled={isApproving || isDiscarding}
            className="px-3 py-1.5 text-xs font-medium text-tertiary bg-tertiary/10 hover:bg-tertiary/20 border border-tertiary/30 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
          >
            {isDiscarding ? 'Discarding...' : 'Discard'}
          </button>
        </div>
      </div>
    </div>
  )
}
