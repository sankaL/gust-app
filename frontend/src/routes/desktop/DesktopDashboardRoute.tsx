import { useMemo, useState } from 'react'
import type { DragEndEvent } from '@dnd-kit/react'
import { useOutletContext } from 'react-router-dom'

import { DesktopDashboardView, OVERDUE_COLUMN_KEY } from '../../components/DesktopDashboardView'
import { useDesktopHeader, type DesktopOutletContext } from '../../components/DesktopShellContext'
import { DesktopTaskDetailModal } from '../../components/DesktopTaskDetailModal'
import { useDesktopTaskActions } from '../../hooks/useDesktopTaskActions'
import { useDesktopTaskCollections } from '../../hooks/useDesktopTaskCollections'
import { useDesktopTaskPreview } from '../../hooks/useDesktopTaskPreview'
import type { TaskSummary } from '../../lib/api'
import {
  addDaysIso,
  buildDesktopAnalytics,
  buildWeeklyBoardColumns,
  formatIsoDateLabel,
  getTodayIsoDate,
  type CompletionTrendRange,
  type WeeklyBoardColumn,
} from '../../lib/desktopData'

function dragIds(event: DragEndEvent): [string, string] | null {
  const { source, target } = event.operation
  if (event.canceled) return null
  if (!source) return null
  if (!target) return null
  return [String(source.id), String(target.id)]
}

function kanbanEntities(ids: [string, string], tasks: Map<string, TaskSummary>, columns: Map<string, WeeklyBoardColumn>) {
  const task = tasks.get(ids[0])
  const column = columns.get(ids[1])
  return task && column ? { task, column } : null
}

function isUnavailableKanbanMove({ task, column }: NonNullable<ReturnType<typeof kanbanEntities>>) {
  return column.key === OVERDUE_COLUMN_KEY || task.due_date === column.date
}

function findKanbanMove(event: DragEndEvent, tasks: Map<string, TaskSummary>, columns: Map<string, WeeklyBoardColumn>) {
  const ids = dragIds(event)
  if (!ids) return null
  const entities = kanbanEntities(ids, tasks, columns)
  if (!entities) return null
  if (isUnavailableKanbanMove(entities)) return null
  return { task: entities.task, dueDate: entities.column.date }
}

function indexTasks(tasks: TaskSummary[]) {
  return new Map(tasks.map((task) => [task.id, task]))
}

function indexColumns(columns: WeeklyBoardColumn[]) {
  return new Map(columns.map((column) => [column.key, column]))
}

function dashboardState(open: { isLoading: boolean; isError: boolean }, completed: { isLoading: boolean; isError: boolean }) {
  if (open.isLoading || completed.isLoading) return 'loading'
  if (open.isError || completed.isError) return 'error'
  return 'ready'
}

function moveKanbanTask(event: DragEndEvent, tasks: Map<string, TaskSummary>, columns: Map<string, WeeklyBoardColumn>, actions: ReturnType<typeof useDesktopTaskActions>) {
  const move = findKanbanMove(event, tasks, columns)
  if (move) actions.moveTaskDueDate(move.task, move.dueDate)
}

function DashboardDetail({ preview, session, groups, actions }: { preview: ReturnType<typeof useDesktopTaskPreview>; session: DesktopOutletContext['session']; groups: DesktopOutletContext['groups']; actions: ReturnType<typeof useDesktopTaskActions> }) {
  const complete = (task: TaskSummary) => { actions.completeTask(task); preview.closeTaskPreview() }
  return <DesktopTaskDetailModal taskId={preview.selectedTaskId} isOpen={Boolean(preview.selectedTaskId)} onClose={preview.closeTaskPreview} session={session} groups={groups} onComplete={complete} busyTaskIds={actions.busyTaskIds} />
}

export function DesktopDashboardRoute() {
  const { session, groups } = useOutletContext<DesktopOutletContext>()
  const taskActions = useDesktopTaskActions(session)
  const [range, setRange] = useState<CompletionTrendRange>('month')
  const preview = useDesktopTaskPreview()
  const completedStart = useMemo(() => addDaysIso(getTodayIsoDate(session.timezone), -370), [session.timezone])
  const { openQuery, completedQuery, openTasks, completedTasks } = useDesktopTaskCollections({ completedStart })
  const analytics = useMemo(() => buildDesktopAnalytics({ openTasks, completedTasks, groups, timezone: session.timezone }), [completedTasks, groups, openTasks, session.timezone])
  const columns = useMemo(() => buildWeeklyBoardColumns(openTasks, session.timezone), [openTasks, session.timezone])
  const tasksById = useMemo(() => indexTasks(openTasks), [openTasks])
  const columnsByKey = useMemo(() => indexColumns(columns), [columns])
  const todayLabel = formatIsoDateLabel(analytics.todayIso)
  const header = useMemo(() => ({ eyebrow: todayLabel, title: 'Weekly overview', subtitle: `${todayLabel} – ${formatIsoDateLabel(analytics.weekEndIso)} · ${analytics.counts.completed} tasks completed all time` }), [analytics.counts.completed, analytics.weekEndIso, todayLabel])
  useDesktopHeader(header)

  const state = dashboardState(openQuery, completedQuery)
  if (state === 'loading') return <section className="space-y-6" aria-busy="true"><div className="h-16 animate-pulse rounded-soft bg-surface-container" /><div className="h-64 animate-pulse rounded-soft bg-surface-container" /></section>
  if (state === 'error') return <section className="rounded-soft bg-[rgba(80,18,18,0.92)] p-6"><h1 className="font-display text-3xl text-on-surface">Desktop data could not load</h1><p className="mt-2 font-body text-sm text-red-100">Refresh the page and try again. The task data stays protected behind your session.</p></section>

  const handleDragEnd = (event: DragEndEvent) => moveKanbanTask(event, tasksById, columnsByKey, taskActions)
  const detail = <DashboardDetail preview={preview} session={session} groups={groups} actions={taskActions} />
  return <DesktopDashboardView analytics={analytics} columns={columns} range={range} onRangeChange={setRange} taskActions={taskActions} onOpen={preview.openTaskPreview} onDragEnd={handleDragEnd} detail={detail} />
}
