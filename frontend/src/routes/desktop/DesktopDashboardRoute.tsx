import { useMemo, useState } from 'react'
import { DragDropProvider, useDraggable, useDroppable, type DragEndEvent } from '@dnd-kit/react'
import { useQuery } from '@tanstack/react-query'
import {
  AlertCircle,
  Calendar,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Eye,
  GripVertical,
  Inbox,
  ListTodo,
} from 'lucide-react'
import { useOutletContext, useSearchParams } from 'react-router-dom'

import { useDesktopHeader, type DesktopOutletContext } from '../../components/DesktopShell'
import { DesktopTaskDetailModal } from '../../components/DesktopTaskDetailModal'
import { useDesktopTaskActions } from '../../hooks/useDesktopTaskActions'
import type { TaskSummary } from '../../lib/api'
import {
  COMPLETION_TREND_RANGES,
  buildDesktopAnalytics,
  buildWeeklyBoardColumns,
  fetchAllDesktopTasks,
  formatIsoDateLabel,
  addDaysIso,
  getTodayIsoDate,
  type CompletionTrendRange,
  type WeeklyBoardColumn,
} from '../../lib/desktopData'
import { TASK_SCREEN_GC_TIME_MS, TASK_SCREEN_STALE_TIME_MS } from '../../lib/taskScreenCache'

const KANBAN_TASK_TYPE = 'weekly-kanban-task'
const OVERDUE_COLUMN_KEY = 'overdue'
const COMPLETION_TREND_BAR_SCALE: Record<
  CompletionTrendRange,
  { minHeight: number; maxHeightPercent: number; zeroHeight: number }
> = {
  week: { minHeight: 18, maxHeightPercent: 82, zeroHeight: 2 },
  month: { minHeight: 14, maxHeightPercent: 88, zeroHeight: 2 },
  '3m': { minHeight: 12, maxHeightPercent: 58, zeroHeight: 2 },
  '6m': { minHeight: 10, maxHeightPercent: 48, zeroHeight: 2 },
  year: { minHeight: 12, maxHeightPercent: 54, zeroHeight: 2 },
  ytd: { minHeight: 12, maxHeightPercent: 58, zeroHeight: 2 },
}

function MetricRow({
  icon,
  label,
  value,
  tone = 'default',
  insight,
}: {
  icon: React.ReactNode
  label: string
  value: number
  tone?: 'default' | 'warning' | 'success'
  insight: string
}) {
  const toneClasses = {
    default: 'bg-primary/10 text-primary',
    warning: 'bg-warning/15 text-warning',
    success: 'bg-success/15 text-success',
  }[tone]

  return (
    <article className="group flex items-center gap-3 rounded-card bg-surface-container-high/55 px-3 py-2.5 transition duration-300 ease-out hover:bg-surface-container-high active:scale-[0.99]">
      <div className={`shrink-0 rounded-pill p-2 ${toneClasses}`}>
        {icon}
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-baseline gap-2">
          <p className="font-display text-2xl font-semibold leading-none tracking-tight text-on-surface">
            {value}
          </p>
          <p className="truncate font-body text-[0.62rem] font-semibold uppercase tracking-[0.13em] text-on-surface-variant">
            {label}
          </p>
        </div>
        <p className="mt-1 truncate font-body text-xs leading-4 text-on-surface-variant">{insight}</p>
      </div>
    </article>
  )
}

function WeeklyKanbanColumn({
  column,
  children,
}: {
  column: WeeklyBoardColumn
  children: React.ReactNode
}) {
  const canReceiveDrops = column.key !== OVERDUE_COLUMN_KEY
  const { ref, isDropTarget } = useDroppable({
    id: column.key,
    type: 'weekly-kanban-column',
    accept: canReceiveDrops ? KANBAN_TASK_TYPE : () => false,
    collisionPriority: 1,
    data: { columnKey: column.key },
  })

  return (
    <div
      ref={ref}
      className={`min-h-80 rounded-card bg-surface-dim p-3 transition duration-200 xl:p-2 ${
        isDropTarget ? 'bg-surface-container-high/40 ring-1 ring-primary/70' : ''
      }`}
    >
      <div className="mb-3 flex items-center justify-between gap-2">
        <h3 className="min-w-0 truncate font-body text-sm font-semibold text-on-surface xl:text-xs">
          {column.label}
        </h3>
        <span className="shrink-0 rounded-pill bg-surface-container-high px-2 py-0.5 font-body text-[0.68rem] text-on-surface-variant">
          {column.tasks.length}
        </span>
      </div>
      <div className="space-y-2">{children}</div>
    </div>
  )
}

function WeeklyKanbanTaskCard({
  task,
  taskActions,
  onOpen,
}: {
  task: TaskSummary
  taskActions: ReturnType<typeof useDesktopTaskActions>
  onOpen: (taskId: string) => void
}) {
  const { ref, handleRef, isDragSource, isDragging } = useDraggable({
    id: task.id,
    type: KANBAN_TASK_TYPE,
    data: { taskId: task.id },
  })

  return (
    <article
      ref={ref}
      className={`rounded-card bg-surface-container px-2.5 py-2 transition duration-200 ${
        isDragSource || isDragging
          ? 'scale-[0.99] opacity-75 ring-1 ring-primary/70 shadow-ambient'
          : 'hover:bg-surface-container-high/70'
      }`}
    >
      <div className="flex items-start gap-1.5">
        <button
          ref={handleRef}
          type="button"
          className="mt-0.5 shrink-0 cursor-grab rounded-full p-0.5 text-on-surface-variant transition hover:bg-surface-container-high hover:text-on-surface active:cursor-grabbing"
          aria-label={`Drag ${task.title}`}
          title="Drag task"
        >
          <GripVertical className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
        <div className="min-w-0 flex-1">
          <button
            type="button"
            onClick={() => onOpen(task.id)}
            className="line-clamp-2 block max-w-full text-left font-body text-xs font-semibold leading-4 text-on-surface transition hover:text-primary active:scale-[0.99]"
          >
            {task.title}
          </button>
          <p className="mt-0.5 truncate font-body text-[0.68rem] leading-4 text-on-surface-variant">
            {task.group.name}
          </p>
        </div>
        <button
          type="button"
          onClick={() => taskActions.completeTask(task)}
          disabled={taskActions.busyTaskIds.includes(task.id)}
          className="mt-0.5 shrink-0 rounded-full bg-success/20 p-1 text-success transition hover:bg-success/30 active:scale-[0.98] disabled:opacity-50"
          aria-label={`Complete ${task.title}`}
        >
          <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />
        </button>
      </div>
    </article>
  )
}

export function DesktopDashboardRoute() {
  const { session, groups } = useOutletContext<DesktopOutletContext>()
  const taskActions = useDesktopTaskActions(session)
  const [completionTrendRange, setCompletionTrendRange] =
    useState<CompletionTrendRange>('month')
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedTaskId = searchParams.get('task')
  const completedAnalyticsStart = useMemo(
    () => addDaysIso(getTodayIsoDate(session.timezone), -370),
    [session.timezone]
  )

  const openTasksQuery = useQuery({
    queryKey: ['desktop', 'tasks', 'all', 'open'],
    queryFn: () => fetchAllDesktopTasks('open'),
    staleTime: TASK_SCREEN_STALE_TIME_MS,
    gcTime: TASK_SCREEN_GC_TIME_MS,
  })

  const completedTasksQuery = useQuery({
    queryKey: ['desktop', 'tasks', 'all', 'completed', completedAnalyticsStart],
    queryFn: () =>
      fetchAllDesktopTasks('completed', null, {
        completedStart: completedAnalyticsStart,
      }),
    staleTime: TASK_SCREEN_STALE_TIME_MS,
    gcTime: TASK_SCREEN_GC_TIME_MS,
  })

  const openTasks = useMemo(() => openTasksQuery.data ?? [], [openTasksQuery.data])
  const completedTasks = useMemo(
    () => completedTasksQuery.data ?? [],
    [completedTasksQuery.data]
  )
  const analytics = useMemo(
    () =>
      buildDesktopAnalytics({
        openTasks,
        completedTasks,
        groups,
        timezone: session.timezone,
      }),
    [completedTasks, groups, openTasks, session.timezone]
  )
  const weeklyColumns = useMemo(
    () => buildWeeklyBoardColumns(openTasks, session.timezone),
    [openTasks, session.timezone]
  )
  const taskById = useMemo(
    () => new Map(openTasks.map((task) => [task.id, task])),
    [openTasks]
  )
  const columnByKey = useMemo(
    () => new Map(weeklyColumns.map((column) => [column.key, column])),
    [weeklyColumns]
  )
  const completionTrend = analytics.completionTrends[completionTrendRange]
  const completionTrendScale = COMPLETION_TREND_BAR_SCALE[completionTrendRange]
  const maxTrendCount = Math.max(...completionTrend.points.map((point) => point.count), 1)
  const hasCompletionTrendData = completionTrend.total > 0
  const visibleTrendLabelEvery = Math.max(1, Math.ceil(completionTrend.points.length / 8))

  function handleKanbanDragEnd(event: DragEndEvent) {
    if (event.canceled) {
      return
    }

    const { source, target } = event.operation
    if (!source || !target) {
      return
    }

    const task = taskById.get(String(source.id))
    const targetColumnKey = String(target.id)

    if (!task) {
      return
    }

    const targetColumn = columnByKey.get(targetColumnKey)
    if (!targetColumn || targetColumn.key === OVERDUE_COLUMN_KEY) {
      return
    }

    if (task.due_date === targetColumn.date) {
      return
    }

    taskActions.moveTaskDueDate(task, targetColumn.date)
  }

  function openTaskPreview(taskId: string) {
    const next = new URLSearchParams(searchParams)
    next.set('task', taskId)
    setSearchParams(next)
  }

  function closeTaskPreview() {
    const next = new URLSearchParams(searchParams)
    next.delete('task')
    setSearchParams(next, { replace: true })
  }

  const todayLabel = formatIsoDateLabel(analytics.todayIso)
  const weekRangeLabel = `${todayLabel} – ${formatIsoDateLabel(analytics.weekEndIso)}`
  const header = useMemo(
    () => ({
      eyebrow: todayLabel,
      title: 'Weekly overview',
      subtitle: `${weekRangeLabel} · ${analytics.counts.completed} tasks completed all time`,
    }),
    [analytics.counts.completed, todayLabel, weekRangeLabel]
  )
  useDesktopHeader(header)

  if (openTasksQuery.isLoading || completedTasksQuery.isLoading) {
    return (
      <section className="space-y-6" aria-busy="true">
        <div className="h-16 animate-pulse rounded-soft bg-surface-container" />
        <div className="h-64 animate-pulse rounded-soft bg-surface-container" />
      </section>
    )
  }

  if (openTasksQuery.isError || completedTasksQuery.isError) {
    return (
      <section className="rounded-soft bg-[rgba(80,18,18,0.92)] p-6">
        <h1 className="font-display text-3xl text-on-surface">Desktop data could not load</h1>
        <p className="mt-2 font-body text-sm text-red-100">
          Refresh the page and try again. The task data stays protected behind your session.
        </p>
      </section>
    )
  }

  return (
    <div className="space-y-6">
      {/* Metrics + trend side-by-side */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-4">
        {/* Task overview: 1/4 */}
        <section className="rounded-soft bg-surface-container p-5 shadow-ambient lg:col-span-1">
          <div className="mb-3 flex items-center gap-2">
            <ListTodo className="h-4 w-4 text-primary" strokeWidth={1.8} />
            <h2 className="font-display text-base text-on-surface">Task overview</h2>
          </div>
          <div className="grid grid-cols-1 gap-2.5">
            <MetricRow
              icon={<Inbox className="h-4 w-4" strokeWidth={1.8} />}
              label="Open"
              value={analytics.counts.open}
              insight={
                analytics.counts.open === 0
                  ? 'All clear. Nothing pending right now.'
                  : `${analytics.counts.open} task${analytics.counts.open > 1 ? 's' : ''} waiting for your attention.`
              }
            />
            <MetricRow
              icon={<AlertCircle className="h-4 w-4" strokeWidth={1.8} />}
              label="Overdue"
              value={analytics.counts.overdue}
              tone={analytics.counts.overdue > 0 ? 'warning' : 'default'}
              insight={
                analytics.counts.overdue === 0
                  ? 'No overdue items. You are caught up.'
                  : `${analytics.counts.overdue} task${analytics.counts.overdue > 1 ? 's' : ''} past due. Consider rescheduling.`
              }
            />
            <MetricRow
              icon={<Calendar className="h-4 w-4" strokeWidth={1.8} />}
              label="Due Today"
              value={analytics.counts.dueToday}
              insight={
                analytics.counts.dueToday === 0
                  ? 'Nothing due today. Enjoy the breather.'
                  : `${analytics.counts.dueToday} task${analytics.counts.dueToday > 1 ? 's' : ''} to wrap up today.`
              }
            />
            <MetricRow
              icon={<Eye className="h-4 w-4" strokeWidth={1.8} />}
              label="This Week"
              value={analytics.counts.dueThisWeek}
              insight={
                analytics.counts.dueThisWeek === 0
                  ? 'No tasks scheduled for this week.'
                  : `${analytics.counts.dueThisWeek} due before ${formatIsoDateLabel(analytics.weekEndIso)}.`
              }
            />
          </div>
        </section>

        {/* Completion trend: 3/4 */}
        <section className="flex flex-col rounded-soft bg-surface-container p-4 shadow-ambient lg:col-span-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div className="flex items-center gap-2">
              <Clock3 className="h-4 w-4 text-primary" strokeWidth={1.8} />
              <h2 className="font-display text-base text-on-surface">Completion Trend</h2>
              <span className="font-body text-xs text-on-surface-variant">
                {completionTrend.total} completed
              </span>
            </div>
            <div
              className="flex rounded-pill bg-surface-dim p-1"
              aria-label="Completion trend range"
            >
              {COMPLETION_TREND_RANGES.map((range) => {
                const selected = range.value === completionTrendRange
                return (
                  <button
                    key={range.value}
                    type="button"
                    onClick={() => setCompletionTrendRange(range.value)}
                    className={`rounded-pill px-2.5 py-1 font-body text-[0.68rem] font-semibold transition ${
                      selected
                        ? 'bg-primary text-on-primary shadow-ambient'
                        : 'text-on-surface-variant hover:bg-surface-container-high hover:text-on-surface'
                    }`}
                    aria-pressed={selected}
                  >
                    {range.label}
                  </button>
                )
              })}
            </div>
          </div>
          {hasCompletionTrendData ? (
            <div className="mt-3 flex min-h-44 flex-1 flex-col rounded-card bg-surface-dim/70 px-3 pb-2.5 pt-3">
              <div className="flex flex-1 items-end gap-2 border-b border-white/10">
                {completionTrend.points.map((point) => (
                  <div key={point.date} className="flex h-full flex-1 flex-col items-center justify-end gap-1">
                    <span
                      className={`font-body text-[0.62rem] font-semibold leading-none ${
                        point.count > 0 ? 'text-on-surface' : 'text-transparent'
                      }`}
                    >
                      {point.count > 0 ? point.count : null}
                    </span>
                    <div
                      className={`w-full min-w-2 rounded-t-card transition ${
                        point.count > 0 ? 'bg-success shadow-[0_0_18px_rgba(78,219,121,0.24)]' : 'bg-white/8'
                      }`}
                      style={{
                        height:
                          point.count > 0
                            ? `max(${completionTrendScale.minHeight}px, ${
                                (point.count / maxTrendCount) *
                                completionTrendScale.maxHeightPercent
                              }%)`
                            : `${completionTrendScale.zeroHeight}px`,
                      }}
                      title={`${point.label}: ${point.count} completed`}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-1.5 flex gap-2">
                {completionTrend.points.map((point, index) => {
                  const showLabel =
                    index === 0 ||
                    index === completionTrend.points.length - 1 ||
                    index % visibleTrendLabelEvery === 0
                  return (
                    <span
                      key={point.date}
                      className={`min-w-0 flex-1 truncate text-center font-body text-[0.6rem] leading-4 ${
                        showLabel ? 'text-on-surface-variant' : 'text-transparent'
                      }`}
                    >
                      {showLabel ? point.label : '.'}
                    </span>
                  )
                })}
              </div>
            </div>
          ) : (
            <div className="mt-3 flex min-h-44 flex-1 items-center justify-center rounded-card bg-surface-dim">
              <p className="font-body text-xs text-on-surface-variant">
                No completed tasks in this range.
              </p>
            </div>
          )}
        </section>
      </div>

      {/* Full-width Kanban board */}
      <section>
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl text-on-surface">Weekly Kanban</h2>
            <p className="font-body text-sm text-on-surface-variant">
              Drag cards across date columns or complete work in place.
            </p>
          </div>
          <CalendarDays className="h-5 w-5 text-primary" strokeWidth={1.8} />
        </div>
        <DragDropProvider onDragEnd={handleKanbanDragEnd}>
          <div className="grid min-w-0 grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-[repeat(9,minmax(0,1fr))] xl:gap-2">
            {weeklyColumns.map((column) => (
              <WeeklyKanbanColumn key={column.key} column={column}>
                {column.tasks.slice(0, 12).map((task) => (
                  <WeeklyKanbanTaskCard
                    key={task.id}
                    task={task}
                    taskActions={taskActions}
                    onOpen={openTaskPreview}
                  />
                ))}
                {column.tasks.length === 0 ? (
                  <p className="rounded-card bg-surface-container/50 p-3 font-body text-xs leading-5 text-on-surface-variant xl:p-2 xl:text-[0.68rem]">
                    Nothing scheduled here.
                  </p>
                ) : null}
              </WeeklyKanbanColumn>
            ))}
          </div>
        </DragDropProvider>
      </section>

      <DesktopTaskDetailModal
        taskId={selectedTaskId}
        isOpen={Boolean(selectedTaskId)}
        onClose={closeTaskPreview}
        session={session}
        groups={groups}
        onComplete={(task) => {
          taskActions.completeTask(task)
          closeTaskPreview()
        }}
        busyTaskIds={taskActions.busyTaskIds}
      />
    </div>
  )
}
