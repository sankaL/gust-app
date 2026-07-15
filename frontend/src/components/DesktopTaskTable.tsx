import { useEffect } from 'react'

import type { GroupSummary, TaskSummary } from '../lib/api'
import { useDesktopTaskTableState } from '../hooks/useDesktopTaskTableState'
import { DesktopTaskTableView } from './DesktopTaskTableView'

type DesktopTaskTableProps = {
  title: string; tasks: TaskSummary[]; groups: GroupSummary[]; status: 'open' | 'completed' | 'all'
  lockedGroupId?: string; hideHeader?: boolean; busyTaskIds?: string[]
  onComplete?: (task: TaskSummary) => void; onReopen?: (task: TaskSummary) => void
  onMoveDueDate?: (task: TaskSummary, dueDate: string | null) => void
  onTaskOpen?: (taskId: string) => void
  onVisibleCountChange?: (visibleCount: number, totalCount: number) => void
}

export function DesktopTaskTable({ title, tasks, groups, status, lockedGroupId, hideHeader = false,
  busyTaskIds = [], onComplete, onReopen, onMoveDueDate, onTaskOpen, onVisibleCountChange }: DesktopTaskTableProps) {
  const state = useDesktopTaskTableState(tasks, status, lockedGroupId)
  useEffect(() => onVisibleCountChange?.(state.visibleTasks.length, tasks.length),
    [onVisibleCountChange, state.visibleTasks.length, tasks.length])
  return <DesktopTaskTableView title={title} total={tasks.length} hideHeader={hideHeader}
    groups={groups} status={status} lockedGroupId={lockedGroupId} state={state}
    actions={{ busyTaskIds, onComplete, onReopen, onMoveDueDate, onTaskOpen }} />
}
