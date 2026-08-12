import { DragDropProvider, useDraggable, useDroppable, type DragEndEvent } from '@dnd-kit/react'
import { AlertCircle, Calendar, CalendarDays, CheckCircle2, Clock3, Eye, GripVertical, Inbox, ListTodo } from 'lucide-react'
import type { ReactNode } from 'react'

import type { useDesktopTaskActions } from '../hooks/useDesktopTaskActions'
import type { TaskSummary } from '../lib/api'
import {
  COMPLETION_TREND_RANGES,
  buildDesktopAnalytics,
  formatIsoDateLabel,
  type CompletionTrendRange,
  type WeeklyBoardColumn,
} from '../lib/desktopData'

const KANBAN_TASK_TYPE = 'weekly-kanban-task'
export const OVERDUE_COLUMN_KEY = 'overdue'

const BAR_SCALE: Record<CompletionTrendRange, { minHeight: number; maxHeightPercent: number; zeroHeight: number }> = {
  week: { minHeight: 18, maxHeightPercent: 82, zeroHeight: 2 },
  month: { minHeight: 14, maxHeightPercent: 88, zeroHeight: 2 },
  '3m': { minHeight: 12, maxHeightPercent: 58, zeroHeight: 2 },
  '6m': { minHeight: 10, maxHeightPercent: 48, zeroHeight: 2 },
  year: { minHeight: 12, maxHeightPercent: 54, zeroHeight: 2 },
  ytd: { minHeight: 12, maxHeightPercent: 58, zeroHeight: 2 },
}

type Analytics = ReturnType<typeof buildDesktopAnalytics>
type TaskActions = ReturnType<typeof useDesktopTaskActions>

function pluralized(count: number, singular: string) {
  return `${count} ${singular}${count === 1 ? '' : 's'}`
}

function MetricRow({ icon, label, value, tone = 'default', insight }: { icon: ReactNode; label: string; value: number; tone?: 'default' | 'warning' | 'success'; insight: string }) {
  const toneClasses = { default: 'bg-primary/10 text-primary', warning: 'bg-warning/15 text-warning', success: 'bg-success/15 text-success' }[tone]
  return <article className="group flex items-center gap-3 rounded-card bg-surface-container-high/55 px-3 py-2.5 transition duration-300 ease-out hover:bg-surface-container-high active:scale-[0.99]"><div className={`shrink-0 rounded-pill p-2 ${toneClasses}`}>{icon}</div><div className="min-w-0 flex-1"><div className="flex items-baseline gap-2"><p className="font-display text-2xl font-semibold leading-none tracking-tight text-on-surface">{value}</p><p className="truncate font-body text-[0.62rem] font-semibold uppercase tracking-[0.13em] text-on-surface-variant">{label}</p></div><p className="mt-1 truncate font-body text-xs leading-4 text-on-surface-variant">{insight}</p></div></article>
}

function TaskOverview({ analytics }: { analytics: Analytics }) {
  const { counts } = analytics
  return <section className="rounded-soft bg-surface-container p-5 shadow-ambient lg:col-span-1"><div className="mb-3 flex items-center gap-2"><ListTodo className="h-4 w-4 text-primary" strokeWidth={1.8} /><h2 className="font-display text-base text-on-surface">Task overview</h2></div><div className="grid grid-cols-1 gap-2.5"><MetricRow icon={<Inbox className="h-4 w-4" strokeWidth={1.8} />} label="Open" value={counts.open} insight={counts.open === 0 ? 'All clear. Nothing pending right now.' : `${pluralized(counts.open, 'task')} waiting for your attention.`} /><MetricRow icon={<AlertCircle className="h-4 w-4" strokeWidth={1.8} />} label="Overdue" value={counts.overdue} tone={counts.overdue > 0 ? 'warning' : 'default'} insight={counts.overdue === 0 ? 'No overdue items. You are caught up.' : `${pluralized(counts.overdue, 'task')} past due. Consider rescheduling.`} /><MetricRow icon={<Calendar className="h-4 w-4" strokeWidth={1.8} />} label="Due Today" value={counts.dueToday} insight={counts.dueToday === 0 ? 'Nothing due today. Enjoy the breather.' : `${pluralized(counts.dueToday, 'task')} to wrap up today.`} /><MetricRow icon={<Eye className="h-4 w-4" strokeWidth={1.8} />} label="This Week" value={counts.dueThisWeek} insight={counts.dueThisWeek === 0 ? 'No tasks scheduled for this week.' : `${counts.dueThisWeek} due before ${formatIsoDateLabel(analytics.weekEndIso)}.`} /></div></section>
}

function TrendRangePicker({ value, onChange }: { value: CompletionTrendRange; onChange: (range: CompletionTrendRange) => void }) {
  return <div className="flex rounded-pill bg-surface-dim p-1" aria-label="Completion trend range">{COMPLETION_TREND_RANGES.map((range) => <button key={range.value} type="button" onClick={() => onChange(range.value)} className={`rounded-pill px-2.5 py-1 font-body text-[0.68rem] font-semibold transition ${range.value === value ? 'bg-primary text-on-primary shadow-ambient' : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'}`} aria-pressed={range.value === value}>{range.label}</button>)}</div>
}

function chartBarClass(count: number) {
  return count > 0 ? 'bg-success shadow-[0_0_18px_rgba(78,219,121,0.24)]' : 'bg-white/8'
}

function chartBarHeight(count: number, maxCount: number, scale: (typeof BAR_SCALE)[CompletionTrendRange]) {
  if (count <= 0) return `${scale.zeroHeight}px`
  return `max(${scale.minHeight}px, ${(count / maxCount) * scale.maxHeightPercent}%)`
}

function CompletionBar({ point, maxCount, scale }: { point: Analytics['completionTrends'][CompletionTrendRange]['points'][number]; maxCount: number; scale: (typeof BAR_SCALE)[CompletionTrendRange] }) {
  const countLabel = point.count > 0 ? point.count : null
  const countClass = point.count > 0 ? 'text-on-surface' : 'text-transparent'
  return <div className="flex h-full flex-1 flex-col items-center justify-end gap-1"><span className={`font-body text-[0.62rem] font-semibold leading-none ${countClass}`}>{countLabel}</span><div className={`w-full min-w-2 rounded-t-card transition ${chartBarClass(point.count)}`} style={{ height: chartBarHeight(point.count, maxCount, scale) }} title={`${point.label}: ${point.count} completed`} /></div>
}

function showTrendLabel(index: number, lastIndex: number, every: number) {
  if (index === 0) return true
  if (index === lastIndex) return true
  return index % every === 0
}

function CompletionLabel({ point, show }: { point: Analytics['completionTrends'][CompletionTrendRange]['points'][number]; show: boolean }) {
  return <span className={`min-w-0 flex-1 truncate text-center font-body text-[0.6rem] leading-4 ${show ? 'text-on-surface-variant' : 'text-transparent'}`}>{show ? point.label : '.'}</span>
}

function CompletionChart({ analytics, range }: { analytics: Analytics; range: CompletionTrendRange }) {
  const trend = analytics.completionTrends[range]
  if (trend.total === 0) return <div className="mt-3 flex min-h-44 flex-1 items-center justify-center rounded-card bg-surface-dim"><p className="font-body text-xs text-on-surface-variant">No completed tasks in this range.</p></div>
  const scale = BAR_SCALE[range]
  const maxCount = Math.max(...trend.points.map((point) => point.count), 1)
  const labelEvery = Math.max(1, Math.ceil(trend.points.length / 8))
  return <div className="mt-3 flex min-h-44 flex-1 flex-col rounded-card bg-surface-dim/70 px-3 pb-2.5 pt-3"><div className="flex flex-1 items-end gap-2 border-b border-white/10">{trend.points.map((point) => <CompletionBar key={point.date} point={point} maxCount={maxCount} scale={scale} />)}</div><div className="mt-1.5 flex gap-2">{trend.points.map((point, index) => <CompletionLabel key={point.date} point={point} show={showTrendLabel(index, trend.points.length - 1, labelEvery)} />)}</div></div>
}

function CompletionTrend({ analytics, range, onRangeChange }: { analytics: Analytics; range: CompletionTrendRange; onRangeChange: (range: CompletionTrendRange) => void }) {
  const trend = analytics.completionTrends[range]
  return <section className="flex flex-col rounded-soft bg-surface-container p-4 shadow-ambient lg:col-span-3"><div className="flex flex-wrap items-center justify-between gap-3"><div className="flex items-center gap-2"><Clock3 className="h-4 w-4 text-primary" strokeWidth={1.8} /><h2 className="font-display text-base text-on-surface">Completion Trend</h2><span className="font-body text-xs text-on-surface-variant">{trend.total} completed</span></div><TrendRangePicker value={range} onChange={onRangeChange} /></div><CompletionChart analytics={analytics} range={range} /></section>
}

function kanbanColumnTone(column: WeeklyBoardColumn) {
  if (column.key === OVERDUE_COLUMN_KEY) {
    return {
      surface: 'bg-error/15 shadow-[inset_0_0_0_1px_rgba(239,83,80,0.24)]',
      heading: 'text-error',
      count: 'bg-error/15 text-error',
    }
  }
  if (column.label === 'Today') {
    return {
      surface: 'bg-warning/15 shadow-[inset_0_0_0_1px_rgba(255,167,38,0.24)]',
      heading: 'text-warning',
      count: 'bg-warning/15 text-warning',
    }
  }
  if (column.key === 'no-date') {
    return {
      surface: 'bg-surface-container/60 shadow-[inset_0_0_0_1px_rgba(173,170,170,0.1)]',
      heading: 'text-on-surface-variant',
      count: 'bg-surface-container-high/80 text-on-surface-variant',
    }
  }
  return {
    surface: 'bg-surface-dim',
    heading: 'text-on-surface',
    count: 'bg-surface-container-high text-on-surface-variant',
  }
}

function WeeklyKanbanColumn({ column, children }: { column: WeeklyBoardColumn; children: ReactNode }) {
  const canReceiveDrops = column.key !== OVERDUE_COLUMN_KEY
  const { ref, isDropTarget } = useDroppable({ id: column.key, type: 'weekly-kanban-column', accept: canReceiveDrops ? KANBAN_TASK_TYPE : () => false, collisionPriority: 1, data: { columnKey: column.key } })
  const tone = kanbanColumnTone(column)
  return <div ref={ref} className={`min-h-80 rounded-card p-3 transition-[background-color,box-shadow] duration-200 xl:p-2 ${tone.surface} ${isDropTarget ? 'bg-surface-container-high/40 ring-1 ring-primary/70' : ''}`}><div className="mb-3 flex items-center justify-between gap-2"><h3 className={`min-w-0 truncate font-body text-sm font-semibold xl:text-xs ${tone.heading}`}>{column.label}</h3><span className={`shrink-0 rounded-pill px-2 py-0.5 font-body text-[0.68rem] tabular-nums ${tone.count}`}>{column.tasks.length}</span></div><div className="space-y-2">{children}</div></div>
}

function WeeklyKanbanTaskCard({ task, taskActions, onOpen }: { task: TaskSummary; taskActions: TaskActions; onOpen: (taskId: string) => void }) {
  const { ref, handleRef, isDragSource, isDragging } = useDraggable({ id: task.id, type: KANBAN_TASK_TYPE, data: { taskId: task.id } })
  return <article ref={ref} className={`rounded-card bg-surface-container px-2.5 py-2 transition duration-200 ${isDragSource || isDragging ? 'scale-[0.99] opacity-75 ring-1 ring-primary/70 shadow-ambient' : 'hover:bg-surface-container-high/70'}`}><div className="flex items-start gap-1.5"><button ref={handleRef} type="button" className="mt-0.5 shrink-0 cursor-grab rounded-full p-0.5 text-on-surface-variant transition hover:bg-surface-container-high hover:text-on-surface active:cursor-grabbing" aria-label={`Drag ${task.title}`} title="Drag task"><GripVertical className="h-3.5 w-3.5" strokeWidth={1.8} /></button><div className="min-w-0 flex-1"><button type="button" onClick={() => onOpen(task.id)} className="line-clamp-2 block max-w-full text-left font-body text-xs font-semibold leading-4 text-on-surface transition hover:text-primary active:scale-[0.99]">{task.title}</button><p className="mt-0.5 truncate font-body text-[0.68rem] leading-4 text-on-surface-variant">{task.group.name}</p></div><button type="button" onClick={() => taskActions.completeTask(task)} disabled={taskActions.busyTaskIds.includes(task.id)} className="mt-0.5 shrink-0 rounded-full bg-success/20 p-1 text-success transition hover:bg-success/30 active:scale-[0.98] disabled:opacity-50" aria-label={`Complete ${task.title}`}><CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} /></button></div></article>
}

function WeeklyKanban({ columns, taskActions, onOpen, onDragEnd }: { columns: WeeklyBoardColumn[]; taskActions: TaskActions; onOpen: (taskId: string) => void; onDragEnd: (event: DragEndEvent) => void }) {
  return <section><div className="mb-4 flex items-center justify-between gap-4"><div><h2 className="font-display text-2xl text-on-surface">Weekly Kanban</h2><p className="font-body text-sm text-on-surface-variant">Drag cards across date columns or complete work in place.</p></div><CalendarDays className="h-5 w-5 text-primary" strokeWidth={1.8} /></div><DragDropProvider onDragEnd={onDragEnd}><div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-[repeat(7,minmax(0,1fr))] xl:gap-2">{columns.map((column) => <WeeklyKanbanColumn key={column.key} column={column}>{column.tasks.slice(0, 12).map((task) => <WeeklyKanbanTaskCard key={task.id} task={task} taskActions={taskActions} onOpen={onOpen} />)}{column.tasks.length === 0 ? <p className="rounded-card bg-surface-container/50 p-3 font-body text-xs leading-5 text-on-surface-variant xl:p-2 xl:text-[0.68rem]">Nothing scheduled here.</p> : null}</WeeklyKanbanColumn>)}</div></DragDropProvider></section>
}

export function DesktopDashboardView({ analytics, columns, range, onRangeChange, taskActions, onOpen, onDragEnd, detail }: { analytics: Analytics; columns: WeeklyBoardColumn[]; range: CompletionTrendRange; onRangeChange: (range: CompletionTrendRange) => void; taskActions: TaskActions; onOpen: (taskId: string) => void; onDragEnd: (event: DragEndEvent) => void; detail: ReactNode }) {
  return <div className="space-y-6"><div className="grid grid-cols-1 gap-6 lg:grid-cols-4"><TaskOverview analytics={analytics} /><CompletionTrend analytics={analytics} range={range} onRangeChange={onRangeChange} /></div><WeeklyKanban columns={columns} taskActions={taskActions} onOpen={onOpen} onDragEnd={onDragEnd} />{detail}</div>
}
