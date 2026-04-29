import { useQuery } from '@tanstack/react-query'
import { useOutletContext } from 'react-router-dom'

import type { DesktopOutletContext } from '../../components/DesktopShell'
import { DesktopTaskTable } from '../../components/DesktopTaskTable'
import { useDesktopTaskActions } from '../../hooks/useDesktopTaskActions'
import { fetchAllDesktopTasks } from '../../lib/desktopData'
import { TASK_SCREEN_GC_TIME_MS, TASK_SCREEN_STALE_TIME_MS } from '../../lib/taskScreenCache'

export function DesktopTasksRoute() {
  const { session, groups } = useOutletContext<DesktopOutletContext>()
  const taskActions = useDesktopTaskActions(session)

  const tasksQuery = useQuery({
    queryKey: ['desktop', 'tasks', 'all', 'open'],
    queryFn: () => fetchAllDesktopTasks('open'),
    staleTime: TASK_SCREEN_STALE_TIME_MS,
    gcTime: TASK_SCREEN_GC_TIME_MS,
  })

  if (tasksQuery.isLoading) {
    return <div className="h-96 animate-pulse rounded-soft bg-surface-container" aria-busy="true" />
  }

  if (tasksQuery.isError) {
    return (
      <section className="rounded-soft bg-[rgba(80,18,18,0.92)] p-6">
        <h1 className="font-display text-3xl text-on-surface">Open tasks could not load</h1>
        <p className="mt-2 font-body text-sm text-red-100">Refresh and try again.</p>
      </section>
    )
  }

  return (
    <DesktopTaskTable
      title="All Open Tasks"
      tasks={tasksQuery.data ?? []}
      groups={groups}
      status="open"
      busyTaskIds={taskActions.busyTaskIds}
      onComplete={taskActions.completeTask}
      onMoveDueDate={taskActions.moveTaskDueDate}
    />
  )
}
