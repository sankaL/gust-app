import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { CalendarDays, CheckCircle2, Clock3, FolderKanban, RotateCcw } from 'lucide-react'
import { Link, useOutletContext } from 'react-router-dom'

import type { DesktopOutletContext } from '../../components/DesktopShell'
import { useDesktopTaskActions } from '../../hooks/useDesktopTaskActions'
import {
  buildDesktopAnalytics,
  buildWeeklyBoardColumns,
  fetchAllDesktopTasks,
  formatDateTimeLabel,
  formatIsoDateLabel,
} from '../../lib/desktopData'
import { TASK_SCREEN_GC_TIME_MS, TASK_SCREEN_STALE_TIME_MS } from '../../lib/taskScreenCache'

function MetricTile({
  label,
  value,
  tone = 'default',
}: {
  label: string
  value: number
  tone?: 'default' | 'warning' | 'success'
}) {
  return (
    <div className="rounded-soft bg-surface-container p-4 shadow-ambient">
      <p className="font-body text-[0.68rem] uppercase tracking-[0.16em] text-on-surface-variant">
        {label}
      </p>
      <p
        className={[
          'mt-3 font-display text-4xl tracking-tight',
          tone === 'warning'
            ? 'text-warning'
            : tone === 'success'
              ? 'text-success'
              : 'text-on-surface',
        ].join(' ')}
      >
        {value}
      </p>
    </div>
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

  if (openTasksQuery.isLoading || completedTasksQuery.isLoading) {
    return (
      <section className="space-y-6" aria-busy="true">
        <div className="h-24 animate-pulse rounded-soft bg-surface-container" />
        <div className="grid grid-cols-4 gap-3">
          {[1, 2, 3, 4].map((item) => (
            <div key={item} className="h-32 animate-pulse rounded-soft bg-surface-container" />
          ))}
        </div>
        <div className="h-96 animate-pulse rounded-soft bg-surface-container" />
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
      <section className="grid grid-cols-[minmax(0,1.4fr)_minmax(18rem,0.6fr)] gap-5 max-xl:grid-cols-1">
        <div className="rounded-soft bg-surface-container p-5 shadow-ambient">
          <div className="flex flex-wrap items-start justify-between gap-4">
            <div>
              <p className="font-body text-[0.68rem] uppercase tracking-[0.18em] text-primary">
                Mission board
              </p>
              <h1 className="mt-2 max-w-4xl font-display text-4xl tracking-tight text-on-surface">
                Desktop command center for tasks, groups, and weekly momentum.
              </h1>
            </div>
            <Link
              to="/desktop/tasks"
              className="rounded-pill bg-primary px-4 py-2 font-body text-sm font-semibold text-surface transition hover:-translate-y-0.5 active:translate-y-0"
            >
              Open All Tasks
            </Link>
          </div>
        </div>
        <div className="rounded-soft bg-surface-container p-5 shadow-ambient">
          <p className="font-body text-[0.68rem] uppercase tracking-[0.16em] text-on-surface-variant">
            This week
          </p>
          <p className="mt-3 font-display text-2xl text-on-surface">
            {formatIsoDateLabel(analytics.todayIso)} to {formatIsoDateLabel(analytics.weekEndIso)}
          </p>
          <p className="mt-2 font-body text-sm leading-6 text-on-surface-variant">
            {analytics.counts.dueThisWeek} due this week, {analytics.counts.noDate} without dates.
          </p>
        </div>
      </section>

      <section className="grid grid-cols-6 gap-3 max-2xl:grid-cols-3 max-md:grid-cols-1">
        <MetricTile label="Open" value={analytics.counts.open} />
        <MetricTile label="Overdue" value={analytics.counts.overdue} tone="warning" />
        <MetricTile label="Due Today" value={analytics.counts.dueToday} />
        <MetricTile label="This Week" value={analytics.counts.dueThisWeek} />
        <MetricTile label="Needs Review" value={analytics.counts.needsReview} tone="warning" />
        <MetricTile label="Completed" value={analytics.counts.completed} tone="success" />
      </section>

      <section className="grid grid-cols-[minmax(0,1fr)_22rem] gap-5 max-2xl:grid-cols-1">
        <div className="space-y-3 rounded-soft bg-surface-container p-4 shadow-ambient">
          <div className="flex items-center justify-between gap-4">
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
              <section key={column.key} className="min-h-80 rounded-card bg-surface-dim p-3">
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
              </section>
            ))}
          </div>
        </div>

        <div className="space-y-5">
          <section className="rounded-soft bg-surface-container p-4 shadow-ambient">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-2xl text-on-surface">Completion Trend</h2>
              <Clock3 className="h-5 w-5 text-primary" strokeWidth={1.8} />
            </div>
            <div className="mt-5 flex h-36 items-end gap-2">
              {analytics.completionTrend.map((point) => (
                <div key={point.date} className="flex flex-1 flex-col items-center gap-2">
                  <div
                    className="w-full rounded-t-card bg-success/70"
                    style={{ height: `${Math.max(8, (point.count / maxTrendCount) * 120)}px` }}
                    title={`${point.count} completed`}
                  />
                  <span className="font-body text-[0.65rem] text-on-surface-variant">
                    {point.label}
                  </span>
                </div>
              ))}
            </div>
          </section>

          <section className="rounded-soft bg-surface-container p-4 shadow-ambient">
            <div className="flex items-center justify-between">
              <h2 className="font-display text-2xl text-on-surface">Recently Done</h2>
              <CheckCircle2 className="h-5 w-5 text-success" strokeWidth={1.8} />
            </div>
            <div className="mt-4 space-y-2">
              {analytics.recentlyCompletedTasks.map((task) => (
                <div key={task.id} className="rounded-card bg-surface-dim p-3">
                  <p className="font-body text-sm font-semibold text-on-surface">{task.title}</p>
                  <p className="mt-1 font-body text-xs text-on-surface-variant">
                    {task.group.name} &middot; {formatDateTimeLabel(task.completed_at)}
                  </p>
                  <button
                    type="button"
                    onClick={() => taskActions.reopenTask(task)}
                    className="mt-3 inline-flex items-center gap-1 rounded-pill bg-surface-container-high px-3 py-1.5 font-body text-xs font-semibold text-on-surface-variant transition hover:text-on-surface active:scale-[0.98]"
                  >
                    <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} />
                    Restore
                  </button>
                </div>
              ))}
              {analytics.recentlyCompletedTasks.length === 0 ? (
                <p className="font-body text-sm text-on-surface-variant">
                  Completed work will collect here.
                </p>
              ) : null}
            </div>
          </section>
        </div>
      </section>

      <section className="grid grid-cols-[minmax(0,0.65fr)_minmax(0,0.35fr)] gap-5 max-2xl:grid-cols-1">
        <div className="rounded-soft bg-surface-container p-4 shadow-ambient">
          <h2 className="font-display text-2xl text-on-surface">Upcoming Tasks</h2>
          <div className="mt-4 grid grid-cols-2 gap-3 max-xl:grid-cols-1">
            {analytics.upcomingTasks.map((task) => (
              <Link
                key={task.id}
                to={`/desktop/tasks/${task.id}`}
                className="rounded-card bg-surface-dim p-3 transition hover:bg-surface-container-high active:scale-[0.99]"
              >
                <p className="font-body text-sm font-semibold text-on-surface">{task.title}</p>
                <p className="mt-1 font-body text-xs text-on-surface-variant">
                  {task.group.name} &middot;{' '}
                  {task.due_date ? formatIsoDateLabel(task.due_date) : 'No date'}
                </p>
              </Link>
            ))}
            {analytics.upcomingTasks.length === 0 ? (
              <p className="font-body text-sm text-on-surface-variant">No upcoming dated tasks.</p>
            ) : null}
          </div>
        </div>

        <div className="rounded-soft bg-surface-container p-4 shadow-ambient">
          <div className="flex items-center justify-between">
            <h2 className="font-display text-2xl text-on-surface">Groups</h2>
            <FolderKanban className="h-5 w-5 text-primary" strokeWidth={1.8} />
          </div>
          <div className="mt-4 space-y-2">
            {analytics.groupAnalytics.map((item) => (
              <Link
                key={item.group.id}
                to={`/desktop/groups/${item.group.id}`}
                className="grid grid-cols-[minmax(0,1fr)_auto] gap-3 rounded-card bg-surface-dim p-3 transition hover:bg-surface-container-high active:scale-[0.99]"
              >
                <div className="min-w-0">
                  <p className="truncate font-body text-sm font-semibold text-on-surface">
                    {item.group.name}
                  </p>
                  <p className="mt-1 font-body text-xs text-on-surface-variant">
                    {item.dueThisWeekCount} due this week &middot; {item.completedCount} done
                  </p>
                </div>
                <span className="rounded-pill bg-surface-container-high px-2 py-1 font-body text-xs text-on-surface-variant">
                  {item.openCount}
                </span>
              </Link>
            ))}
          </div>
        </div>
      </section>
    </div>
  )
}
