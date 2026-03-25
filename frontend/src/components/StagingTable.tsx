import { useState, useMemo } from 'react'
import { ExtractedTask } from '../lib/api'
import { ExtractedTaskCard } from './ExtractedTaskCard'

type GroupingMode = 'none' | 'group' | 'confidence' | 'needs_review'

interface StagingTableProps {
  tasks: ExtractedTask[]
  onApprove: (taskId: string) => Promise<void>
  onDiscard: (taskId: string) => Promise<void>
  onApproveAll: () => Promise<void>
  onDiscardAll: () => Promise<void>
  onTaskClick: (task: ExtractedTask) => void
  isLoading?: boolean
  title?: string
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
  emptyMessage = 'No extracted tasks to review'
}: StagingTableProps) {
  const [isApprovingAll, setIsApprovingAll] = useState(false)
  const [isDiscardingAll, setIsDiscardingAll] = useState(false)
  const [groupingMode, setGroupingMode] = useState<GroupingMode>('none')

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

  const pendingTasks = tasks.filter(t => t.status === 'pending')
  const needsReviewCount = pendingTasks.filter(t => t.needs_review).length

  // Group tasks based on selected mode
  const groupedTasks = useMemo(() => {
    if (groupingMode === 'none') {
      return [{ key: 'all', label: null, tasks: pendingTasks }]
    }

    const groups = new Map<string, ExtractedTask[]>()

    if (groupingMode === 'group') {
      pendingTasks.forEach(task => {
        const key = task.group_name || 'No Group'
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key)!.push(task)
      })
    } else if (groupingMode === 'confidence') {
      pendingTasks.forEach(task => {
        let key: string
        if (task.top_confidence >= 0.8) key = 'High Confidence'
        else if (task.top_confidence >= 0.7) key = 'Medium Confidence'
        else key = 'Low Confidence'
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key)!.push(task)
      })
    } else if (groupingMode === 'needs_review') {
      pendingTasks.forEach(task => {
        const key = task.needs_review ? 'Needs Review' : 'Look Good'
        if (!groups.has(key)) groups.set(key, [])
        groups.get(key)!.push(task)
      })
    }

    return Array.from(groups.entries()).map(([key, tasks]) => ({
      key,
      label: key,
      tasks
    }))
  }, [pendingTasks, groupingMode])

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
            <h2 className="text-lg font-semibold text-on-surface">
              {title} ({pendingTasks.length})
            </h2>
            {needsReviewCount > 0 && (
              <p className="text-sm text-warning mt-0.5">
                {needsReviewCount} task{needsReviewCount !== 1 ? 's' : ''} need{needsReviewCount === 1 ? 's' : ''} review
              </p>
            )}
          </div>

          {/* Bulk Action Buttons - Solid Filled Style, Compact */}
          <div className="flex items-center gap-2 shrink-0">
            <button
              type="button"
              onClick={handleApproveAll}
              disabled={isApprovingAll || isDiscardingAll || isLoading || pendingTasks.length === 0}
              className="h-8 px-3 text-xs font-medium text-surface bg-primary hover:bg-primary-dim rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isApprovingAll ? 'Approving...' : 'Approve All'}
            </button>
            <button
              type="button"
              onClick={handleDiscardAll}
              disabled={isApprovingAll || isDiscardingAll || isLoading || pendingTasks.length === 0}
              className="h-8 px-3 text-xs font-medium text-surface bg-tertiary hover:bg-tertiary/80 rounded-md transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {isDiscardingAll ? 'Discarding...' : 'Discard All'}
            </button>
          </div>
        </div>

        {/* Grouping Toggle - Full Width */}
        <div className="flex items-center gap-1 bg-surface-dim rounded-pill p-1 overflow-x-auto">
          <button
            type="button"
            onClick={() => setGroupingMode('none')}
            className={`px-3 py-1 text-xs font-medium rounded-pill transition-colors whitespace-nowrap ${
              groupingMode === 'none'
                ? 'bg-primary text-surface'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            Flat
          </button>
          <button
            type="button"
            onClick={() => setGroupingMode('group')}
            className={`px-3 py-1 text-xs font-medium rounded-pill transition-colors whitespace-nowrap ${
              groupingMode === 'group'
                ? 'bg-primary text-surface'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            Group
          </button>
          <button
            type="button"
            onClick={() => setGroupingMode('confidence')}
            className={`px-3 py-1 text-xs font-medium rounded-pill transition-colors whitespace-nowrap ${
              groupingMode === 'confidence'
                ? 'bg-primary text-surface'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            Confidence
          </button>
          <button
            type="button"
            onClick={() => setGroupingMode('needs_review')}
            className={`px-3 py-1 text-xs font-medium rounded-pill transition-colors whitespace-nowrap ${
              groupingMode === 'needs_review'
                ? 'bg-primary text-surface'
                : 'text-on-surface-variant hover:text-on-surface'
            }`}
          >
            Review
          </button>
        </div>
      </div>

      {/* Task List */}
      {isLoading ? (
        <div className="bg-surface-dim rounded-lg p-6 text-center">
          <div className="animate-spin rounded-full h-8 w-8 border-b-2 border-primary mx-auto"></div>
          <p className="text-on-surface-variant text-sm mt-2">Loading extracted tasks...</p>
        </div>
      ) : (
        <div className="space-y-4">
          {groupedTasks.map(group => (
            <div key={group.key} className="space-y-2">
              {group.label && groupingMode !== 'none' && (
                <div className="flex items-center gap-2 px-1">
                  <span className="text-xs font-medium text-on-surface-variant uppercase tracking-wider">
                    {group.label}
                  </span>
                  <span className="text-xs text-on-surface-variant">
                    ({group.tasks.length})
                  </span>
                  {groupingMode === 'confidence' && group.key === 'High Confidence' && (
                    <span className="text-xs text-primary">●</span>
                  )}
                  {groupingMode === 'confidence' && group.key === 'Medium Confidence' && (
                    <span className="text-xs text-warning">●</span>
                  )}
                  {groupingMode === 'confidence' && group.key === 'Low Confidence' && (
                    <span className="text-xs text-tertiary">●</span>
                  )}
                  {groupingMode === 'needs_review' && group.key === 'Needs Review' && (
                    <span className="text-xs text-warning">⚠</span>
                  )}
                </div>
              )}
              <div className="space-y-3">
                {group.tasks.map(task => (
                  <ExtractedTaskCard
                    key={task.id}
                    task={task}
                    onApprove={onApprove}
                    onDiscard={onDiscard}
                    onClick={onTaskClick}
                  />
                ))}
              </div>
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
