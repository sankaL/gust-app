import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useOutletContext } from 'react-router-dom'

import { useDesktopHeader, type DesktopOutletContext } from '../../components/DesktopShell'
import { DesktopTaskTable } from '../../components/DesktopTaskTable'
import { useDesktopTaskActions } from '../../hooks/useDesktopTaskActions'
import { fetchAllDesktopTasks } from '../../lib/desktopData'
import { TASK_SCREEN_GC_TIME_MS, TASK_SCREEN_STALE_TIME_MS } from '../../lib/taskScreenCache'

export function DesktopTasksRoute() {
  const { session, groups } = useOutletContext<DesktopOutletContext>()
  const taskActions = useDesktopTaskActions(session)
  const [visibleSummary, setVisibleSummary] = useState({ visible: 0, total: 0 })

  const tasksQuery = useQuery({
    queryKey: ['desktop', 'tasks', 'all', 'open'],
    queryFn: () => fetchAllDesktopTasks('open'),
    staleTime: TASK_SCREEN_STALE_TIME_MS,
    gcTime: TASK_SCREEN_GC_TIME_MS,
  })

  const tasks = tasksQuery.data ?? []
  const handleVisibleCountChange = useCallback((visible: number, total: number) => {
    setVisibleSummary((current) =>
      current.visible === visible && current.total === total ? current : { visible, total }
    )
  }, [])
  const header = useMemo(
    () => ({
      eyebrow: 'Open tasks',
      title: 'All Open Tasks',
      subtitle: `${visibleSummary.visible} of ${visibleSummary.total || tasks.length} tasks visible`,
    }),
    [tasks.length, visibleSummary.total, visibleSummary.visible]
  )
  useDesktopHeader(header)

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
      tasks={tasks}
      groups={groups}
      status="open"
      hideHeader
      busyTaskIds={taskActions.busyTaskIds}
      onComplete={taskActions.completeTask}
      onMoveDueDate={taskActions.moveTaskDueDate}
      onVisibleCountChange={handleVisibleCountChange}
    />
  )
}
