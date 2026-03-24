import { useState } from 'react'
import { ExtractedTask } from '../lib/api'

interface ExtractedTaskCardProps {
  task: ExtractedTask
  onApprove: (taskId: string) => void
  onDiscard: (taskId: string) => void
  onDueDateChange?: (taskId: string, dueDate: string | null) => Promise<void>
}

export function ExtractedTaskCard({
  task,
  onApprove,
  onDiscard,
  onDueDateChange
}: ExtractedTaskCardProps) {
  const [isApproving, setIsApproving] = useState(false)
  const [isDiscarding, setIsDiscarding] = useState(false)
  const [isEditingDueDate, setIsEditingDueDate] = useState(false)
  const [localDueDate, setLocalDueDate] = useState(task.due_date ? task.due_date.split('T')[0] : '')
  const [isUpdatingDueDate, setIsUpdatingDueDate] = useState(false)

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

  const handleDueDateClick = () => {
    if (onDueDateChange) {
      setIsEditingDueDate(true)
    }
  }

  const handleDueDateSave = async () => {
    if (!onDueDateChange) return
    setIsUpdatingDueDate(true)
    try {
      const newDueDate = localDueDate || null
      await onDueDateChange(task.id, newDueDate)
      setIsEditingDueDate(false)
    } finally {
      setIsUpdatingDueDate(false)
    }
  }

  const handleDueDateCancel = () => {
    setLocalDueDate(task.due_date ? task.due_date.split('T')[0] : '')
    setIsEditingDueDate(false)
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
      className="bg-surface-dim rounded-lg p-4 border border-surface-variant transition-transform"
      style={{ willChange: 'transform' }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 mb-2 flex-wrap">
            <h3 className="text-sm font-medium text-on-surface truncate">
              {task.title}
            </h3>
            {task.needs_review && (
              <span className="px-2 py-0.5 text-xs font-medium bg-warning/20 text-warning rounded">
                Needs Review
              </span>
            )}
          </div>

          <div className="space-y-1 text-xs text-on-surface-variant">
            {task.group_name && (
              <div className="flex items-center gap-1">
                <span className="text-on-surface-variant/60">Group:</span>
                <span>{task.group_name}</span>
              </div>
            )}

            <div className="flex items-center gap-1 min-h-[20px]">
              <span className="text-on-surface-variant/60">Due:</span>
              {isEditingDueDate ? (
                <div className="flex items-center gap-1">
                  <input
                    type="date"
                    value={localDueDate}
                    onChange={(e) => setLocalDueDate(e.target.value)}
                    className="bg-surface-container-high text-on-surface text-xs px-2 py-1 rounded border border-outline focus:border-primary outline-none h-6"
                    disabled={isUpdatingDueDate}
                  />
                  <button
                    onClick={handleDueDateSave}
                    disabled={isUpdatingDueDate}
                    className="text-primary hover:text-primary-dim text-xs h-6 px-1"
                  >
                    {isUpdatingDueDate ? '...' : '✓'}
                  </button>
                  <button
                    onClick={handleDueDateCancel}
                    disabled={isUpdatingDueDate}
                    className="text-on-surface-variant hover:text-on-surface text-xs h-6 px-1"
                  >
                    ✕
                  </button>
                </div>
              ) : task.due_date ? (
                <button
                  onClick={handleDueDateClick}
                  className="text-on-surface hover:text-primary transition-colors"
                  disabled={!onDueDateChange}
                >
                  {new Date(task.due_date).toLocaleDateString()}
                </button>
              ) : (
                <button
                  onClick={handleDueDateClick}
                  className="text-on-surface-variant/50 hover:text-primary transition-colors italic"
                  disabled={!onDueDateChange}
                >
                  {onDueDateChange ? '+ Set due date' : 'No due date'}
                </button>
              )}
            </div>

            {task.recurrence_frequency && (
              <div className="flex items-center gap-1">
                <span className="text-on-surface-variant/60">Recurrence:</span>
                <span className="capitalize">{task.recurrence_frequency}</span>
              </div>
            )}

            <div className="flex items-center gap-1">
              <span className="text-on-surface-variant/60">Confidence:</span>
              <span className={getConfidenceColor(task.top_confidence)}>
                {getConfidenceLabel(task.top_confidence)} ({Math.round(task.top_confidence * 100)}%)
              </span>
            </div>
          </div>
        </div>

        <div className="flex items-center gap-2 shrink-0">
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
