import { useMemo } from 'react'
import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, CalendarDays, CheckCircle2, ClipboardList, Settings2 } from 'lucide-react'
import { Link, useOutletContext, useParams, useSearchParams } from 'react-router-dom'

import { useDesktopHeader, type DesktopOutletContext } from '../../components/DesktopShell'
import { DesktopTaskTable } from '../../components/DesktopTaskTable'
import { DesktopTaskDetailModal } from '../../components/DesktopTaskDetailModal'
import { useDesktopTaskActions } from '../../hooks/useDesktopTaskActions'
import { addDaysIso, fetchAllDesktopTasks, getTodayIsoDate } from '../../lib/desktopData'
import { TASK_SCREEN_GC_TIME_MS, TASK_SCREEN_STALE_TIME_MS } from '../../lib/taskScreenCache'

export function DesktopGroupDetailRoute() {
  const { groupId } = useParams()
  const { session, groups } = useOutletContext<DesktopOutletContext>()
  const taskActions = useDesktopTaskActions(session)
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedTaskId = searchParams.get('task')
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
  const completedTasks = useMemo(() => completedTasksQuery.data ?? [], [completedTasksQuery.data])
  const allGroupTasks = useMemo(() => [...openTasks, ...completedTasks], [openTasks, completedTasks])
  const todayIso = getTodayIsoDate(session.timezone)
  const weekEndIso = addDaysIso(todayIso, 6)
  const datedThisWeek = openTasks.filter(
    (task) => task.due_date && task.due_date >= todayIso && task.due_date <= weekEndIso
  ).length
  const groupDescription =
    group?.description ||
    'No description yet. Add one from group configuration to improve routing context.'
  const header = useMemo(
    () => ({
      eyebrow: group ? 'Group workspace' : 'Groups',
      title: group?.name ?? 'Group not found',
      subtitle: group
        ? groupDescription
        : 'Choose a group from the left navigation or return to group configuration.',
      action: group ? (
        <Link
          to="/desktop/groups"
          className="inline-flex h-10 items-center gap-2 rounded-pill bg-surface-dim px-4 font-body text-sm font-semibold text-on-surface-variant transition hover:bg-surface-container-highest hover:text-on-surface"
        >
          <Settings2 className="h-4 w-4" strokeWidth={1.8} />
          Configure
        </Link>
      ) : undefined,
    }),
    [group, groupDescription]
  )
  useDesktopHeader(header)

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
      <section className="grid w-full grid-cols-4 gap-3 rounded-soft bg-surface-container p-3 shadow-ambient max-xl:grid-cols-2 max-sm:grid-cols-1">
        <div className="flex min-w-0 items-center gap-3 rounded-card bg-surface-dim/55 px-4 py-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
            <ClipboardList className="h-5 w-5 text-primary" strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-display text-2xl leading-none text-on-surface">{openTasks.length}</p>
            <p className="font-body text-xs font-medium uppercase tracking-wider text-on-surface-variant">Open</p>
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-3 rounded-card bg-surface-dim/55 px-4 py-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-primary/10">
            <CalendarDays className="h-5 w-5 text-primary" strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-display text-2xl leading-none text-on-surface">{datedThisWeek}</p>
            <p className="font-body text-xs font-medium uppercase tracking-wider text-on-surface-variant">Due this week</p>
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-3 rounded-card bg-surface-dim/55 px-4 py-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-success/10">
            <CheckCircle2 className="h-5 w-5 text-success" strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-display text-2xl leading-none text-on-surface">{completedTasks.length}</p>
            <p className="font-body text-xs font-medium uppercase tracking-wider text-on-surface-variant">Completed</p>
          </div>
        </div>
        <div className="flex min-w-0 items-center gap-3 rounded-card bg-surface-dim/55 px-4 py-3">
          <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-warning/10">
            <AlertTriangle className="h-5 w-5 text-warning" strokeWidth={2} />
          </div>
          <div className="min-w-0 flex-1">
            <p className="font-display text-2xl leading-none text-on-surface">
              {openTasks.filter((task) => task.needs_review).length}
            </p>
            <p className="font-body text-xs font-medium uppercase tracking-wider text-on-surface-variant">Need review</p>
          </div>
        </div>
      </section>

      <DesktopTaskTable
        title={`${group.name} Tasks`}
        tasks={allGroupTasks}
        groups={groups}
        status="all"
        lockedGroupId={group.id}
        hideHeader
        busyTaskIds={taskActions.busyTaskIds}
        onComplete={taskActions.completeTask}
        onMoveDueDate={taskActions.moveTaskDueDate}
        onReopen={taskActions.reopenTask}
        onTaskOpen={openTaskPreview}
      />

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
        onRestore={(task) => {
          taskActions.reopenTask(task)
          closeTaskPreview()
        }}
        busyTaskIds={taskActions.busyTaskIds}
      />
    </div>
  )
}
