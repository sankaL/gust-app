import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CalendarDays, CheckCircle2, ClipboardList, Settings2 } from 'lucide-react'
import { Link, useOutletContext, useParams } from 'react-router-dom'

import type { DesktopOutletContext } from '../../components/DesktopShell'
import { DesktopTaskTable } from '../../components/DesktopTaskTable'
import { useDesktopTaskActions } from '../../hooks/useDesktopTaskActions'
import {
  buildWeeklyBoardColumns,
  fetchAllDesktopTasks,
  formatIsoDateLabel,
} from '../../lib/desktopData'
import { TASK_SCREEN_GC_TIME_MS, TASK_SCREEN_STALE_TIME_MS } from '../../lib/taskScreenCache'

export function DesktopGroupDetailRoute() {
  const { groupId } = useParams()
  const { session, groups } = useOutletContext<DesktopOutletContext>()
  const taskActions = useDesktopTaskActions(session)
  const group = groups.find((candidate) => candidate.id === groupId)

  const openTasksQuery = useQuery({
    queryKey: ['desktop', 'tasks', groupId, 'open'],
    queryFn: () => fetchAllDesktopTasks('open', groupId ?? null),
    enabled: Boolean(groupId),
    staleTime: TASK_SCREEN_STALE_TIME_MS,
    gcTime: TASK_SCREEN_GC_TIME_MS,
  })

  const completedTasksQuery = useQuery({
    queryKey: ['desktop', 'tasks', groupId, 'completed'],
    queryFn: () => fetchAllDesktopTasks('completed', groupId ?? null),
    enabled: Boolean(groupId),
    staleTime: TASK_SCREEN_STALE_TIME_MS,
    gcTime: TASK_SCREEN_GC_TIME_MS,
  })

  const openTasks = useMemo(() => openTasksQuery.data ?? [], [openTasksQuery.data])
  const completedTasks = completedTasksQuery.data ?? []
  const weeklyColumns = useMemo(
    () => buildWeeklyBoardColumns(openTasks, session.timezone),
    [openTasks, session.timezone]
  )
  const datedThisWeek = weeklyColumns
    .filter((column) => column.date)
    .reduce((sum, column) => sum + column.tasks.length, 0)

  if (!group) {
    return (
      <section className="rounded-soft bg-surface-container p-6 shadow-ambient">
        <h1 className="font-display text-3xl text-on-surface">Group not found</h1>
        <p className="mt-2 font-body text-sm text-on-surface-variant">
          Choose a group from the left navigation or return to group configuration.
        </p>
        <Link
          to="/desktop/groups"
          className="mt-5 inline-flex rounded-pill bg-primary px-4 py-2 font-body text-sm font-semibold text-surface"
        >
          Open Groups
        </Link>
      </section>
    )
  }

  if (openTasksQuery.isLoading || completedTasksQuery.isLoading) {
    return <div className="h-96 animate-pulse rounded-soft bg-surface-container" aria-busy="true" />
  }

  if (openTasksQuery.isError || completedTasksQuery.isError) {
    return (
      <section className="rounded-soft bg-[rgba(80,18,18,0.92)] p-6">
        <h1 className="font-display text-3xl text-on-surface">Group tasks could not load</h1>
        <p className="mt-2 font-body text-sm text-red-100">Refresh and try again.</p>
      </section>
    )
  }

  return (
    <div className="space-y-6">
      <section className="grid grid-cols-[minmax(0,1fr)_auto] gap-5 rounded-soft bg-surface-container p-5 shadow-ambient max-lg:grid-cols-1">
        <div>
          <p className="font-body text-[0.68rem] uppercase tracking-[0.18em] text-primary">
            Group workspace
          </p>
          <h1 className="mt-1 font-display text-4xl tracking-tight text-on-surface">
            {group.name}
          </h1>
          <p className="mt-2 max-w-3xl font-body text-sm leading-6 text-on-surface-variant">
            {group.description || 'No description yet. Add one from group configuration to improve routing context.'}
          </p>
        </div>
        <Link
          to="/desktop/groups"
          className="inline-flex h-10 items-center gap-2 rounded-pill bg-surface-dim px-4 font-body text-sm font-semibold text-on-surface-variant transition hover:bg-surface-container-highest hover:text-on-surface"
        >
          <Settings2 className="h-4 w-4" strokeWidth={1.8} />
          Configure
        </Link>
      </section>

      <section className="grid grid-cols-4 gap-3 max-xl:grid-cols-2 max-sm:grid-cols-1">
        <div className="rounded-soft bg-surface-container p-4 shadow-ambient">
          <ClipboardList className="h-5 w-5 text-primary" strokeWidth={1.8} />
          <p className="mt-3 font-display text-4xl text-on-surface">{openTasks.length}</p>
          <p className="font-body text-sm text-on-surface-variant">Open</p>
        </div>
        <div className="rounded-soft bg-surface-container p-4 shadow-ambient">
          <CalendarDays className="h-5 w-5 text-primary" strokeWidth={1.8} />
          <p className="mt-3 font-display text-4xl text-on-surface">{datedThisWeek}</p>
          <p className="font-body text-sm text-on-surface-variant">Due this week</p>
        </div>
        <div className="rounded-soft bg-surface-container p-4 shadow-ambient">
          <CheckCircle2 className="h-5 w-5 text-success" strokeWidth={1.8} />
          <p className="mt-3 font-display text-4xl text-on-surface">{completedTasks.length}</p>
          <p className="font-body text-sm text-on-surface-variant">Completed</p>
        </div>
        <div className="rounded-soft bg-surface-container p-4 shadow-ambient">
          <AlertTriangle className="h-5 w-5 text-warning" strokeWidth={1.8} />
          <p className="mt-3 font-display text-4xl text-on-surface">
            {openTasks.filter((task) => task.needs_review).length}
          </p>
          <p className="font-body text-sm text-on-surface-variant">Need review</p>
        </div>
      </section>

      <section className="rounded-soft bg-surface-container p-4 shadow-ambient">
        <div className="mb-3 flex items-center justify-between">
          <h2 className="font-display text-2xl text-on-surface">Group Week</h2>
          <p className="font-body text-sm text-on-surface-variant">
            {weeklyColumns[1]?.date ? formatIsoDateLabel(weeklyColumns[1].date) : ''}
          </p>
        </div>
        <div className="grid grid-cols-[repeat(9,minmax(12rem,1fr))] gap-3 overflow-x-auto pb-2">
          {weeklyColumns.map((column) => (
            <section key={column.key} className="min-h-56 rounded-card bg-surface-dim p-3">
              <div className="mb-3 flex items-center justify-between">
                <h3 className="font-body text-sm font-semibold text-on-surface">{column.label}</h3>
                <span className="rounded-pill bg-surface-container-high px-2 py-0.5 font-body text-[0.68rem] text-on-surface-variant">
                  {column.tasks.length}
                </span>
              </div>
              <div className="space-y-2">
                {column.tasks.slice(0, 8).map((task) => (
                  <Link
                    key={task.id}
                    to={`/desktop/tasks/${task.id}`}
                    className="block rounded-card bg-surface-container p-3 font-body text-sm font-semibold text-on-surface transition hover:bg-surface-container-high hover:text-primary"
                  >
                    {task.title}
                  </Link>
                ))}
              </div>
            </section>
          ))}
        </div>
      </section>

      <DesktopTaskTable
        title={`${group.name} Open Tasks`}
        tasks={openTasks}
        groups={groups}
        status="open"
        lockedGroupId={group.id}
        busyTaskIds={taskActions.busyTaskIds}
        onComplete={taskActions.completeTask}
        onMoveDueDate={taskActions.moveTaskDueDate}
      />

      <DesktopTaskTable
        title={`${group.name} Completed`}
        tasks={completedTasks}
        groups={groups}
        status="completed"
        lockedGroupId={group.id}
        busyTaskIds={taskActions.busyTaskIds}
        onReopen={taskActions.reopenTask}
      />
    </div>
  )
}
