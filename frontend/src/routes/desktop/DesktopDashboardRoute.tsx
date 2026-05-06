import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import {
  AlertCircle,
  Calendar,
  CalendarDays,
  CheckCircle2,
  Clock3,
  Eye,
  Inbox,
  ListTodo,
} from 'lucide-react'
import { Link, useOutletContext } from 'react-router-dom'

import { useDesktopHeader, type DesktopOutletContext } from '../../components/DesktopShell'
import { useDesktopTaskActions } from '../../hooks/useDesktopTaskActions'
import {
  buildDesktopAnalytics,
  buildWeeklyBoardColumns,
  fetchAllDesktopTasks,
  formatIsoDateLabel,
} from '../../lib/desktopData'
import { TASK_SCREEN_GC_TIME_MS, TASK_SCREEN_STALE_TIME_MS } from '../../lib/taskScreenCache'

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

export function DesktopDashboardRoute() {
  const { session, groups } = useOutletContext<DesktopOutletContext>()
  const taskActions = useDesktopTaskActions(session)

  const openTasksQuery = useQuery({
    queryKey: ['desktop', 'tasks', 'all', 'open'],
    queryFn: () => fetchAllDesktopTasks('open'),
    staleTime: TASK_SCREEN_STALE_TIME_MS,
    gcTime: TASK_SCREEN_GC_TIME_MS,
  })

  const completedTasksQuery = useQuery({
    queryKey: ['desktop', 'tasks', 'all', 'completed'],
    queryFn: () => fetchAllDesktopTasks('completed'),
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
  const maxTrendCount = Math.max(...analytics.completionTrend.map((point) => point.count), 1)

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
        {/* Task overview — 1/4 */}
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
                  ? 'All clear — nothing pending right now.'
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
                  : `${analytics.counts.overdue} task${analytics.counts.overdue > 1 ? 's' : ''} past due — consider rescheduling.`
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

        {/* Completion trend — 3/4 */}
        <section className="rounded-soft bg-surface-container p-4 shadow-ambient lg:col-span-3">
          <div className="flex items-center justify-between">
            <div className="flex items-center gap-2">
              <Clock3 className="h-4 w-4 text-primary" strokeWidth={1.8} />
              <h2 className="font-display text-base text-on-surface">Completion Trend</h2>
              <span className="font-body text-xs text-on-surface-variant">
                {analytics.counts.completed} total completed
              </span>
            </div>
          </div>
          <div className="mt-3 flex h-16 items-end gap-1.5">
            {analytics.completionTrend.map((point) => (
              <div key={point.date} className="flex flex-1 flex-col items-center gap-1">
                <div
                  className="w-full rounded-t-card bg-success/60"
                  style={{ height: `${Math.max(4, (point.count / maxTrendCount) * 56)}px` }}
                  title={`${point.count} completed`}
                />
                <span className="font-body text-[0.6rem] text-on-surface-variant">
                  {point.label}
                </span>
              </div>
            ))}
          </div>
        </section>
      </div>

      {/* Full-width Kanban board */}
      <section>
        <div className="mb-4 flex items-center justify-between gap-4">
          <div>
            <h2 className="font-display text-2xl text-on-surface">Weekly Kanban</h2>
            <p className="font-body text-sm text-on-surface-variant">
              Move dated work by changing the date, or complete it directly.
            </p>
          </div>
          <CalendarDays className="h-5 w-5 text-primary" strokeWidth={1.8} />
        </div>
        <div className="grid grid-cols-[repeat(9,minmax(13rem,1fr))] gap-3 overflow-x-auto pb-2">
          {weeklyColumns.map((column) => (
            <div key={column.key} className="min-h-80 rounded-card bg-surface-dim p-3">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-body text-sm font-semibold text-on-surface">{column.label}</h3>
                <span className="rounded-pill bg-surface-container-high px-2 py-0.5 font-body text-[0.68rem] text-on-surface-variant">
                  {column.tasks.length}
                </span>
              </div>
              <div className="space-y-2">
                {column.tasks.slice(0, 12).map((task) => (
                  <article key={task.id} className="rounded-card bg-surface-container p-3">
                    <Link
                      to={`/desktop/tasks/${task.id}`}
                      className="font-body text-sm font-semibold leading-5 text-on-surface transition hover:text-primary"
                    >
                      {task.title}
                    </Link>
                    <p className="mt-1 font-body text-xs text-on-surface-variant">
                      {task.group.name}
                    </p>
                    <div className="mt-3 flex items-center gap-2">
                      <input
                        type="date"
                        value={task.due_date ?? ''}
                        onChange={(event) =>
                          taskActions.moveTaskDueDate(
                            task,
                            event.target.value ? event.target.value : null
                          )
                        }
                        className="min-w-0 flex-1 rounded-card bg-surface-dim px-2 py-1.5 font-body text-xs text-on-surface outline-none ring-1 ring-white/10 focus:ring-primary"
                        aria-label={`Move ${task.title} due date`}
                      />
                      <button
                        type="button"
                        onClick={() => taskActions.completeTask(task)}
                        disabled={taskActions.busyTaskIds.includes(task.id)}
                        className="rounded-full bg-success/20 p-1.5 text-success transition hover:bg-success/30 active:scale-[0.98] disabled:opacity-50"
                        aria-label={`Complete ${task.title}`}
                      >
                        <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
                      </button>
                    </div>
                  </article>
                ))}
                {column.tasks.length === 0 ? (
                  <p className="rounded-card bg-surface-container/50 p-3 font-body text-xs leading-5 text-on-surface-variant">
                    Nothing scheduled here.
                  </p>
                ) : null}
              </div>
            </div>
          ))}
        </div>
      </section>
    </div>
  )
}
