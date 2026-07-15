import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useOutletContext, useSearchParams } from 'react-router-dom'

import { useDesktopTaskActions } from '../hooks/useDesktopTaskActions'
import { fetchAllDesktopTasks, type DesktopTaskStatus } from '../lib/desktopData'
import { TASK_SCREEN_GC_TIME_MS, TASK_SCREEN_STALE_TIME_MS } from '../lib/taskScreenCache'
import { DesktopTaskDetailModal } from './DesktopTaskDetailModal'
import { useDesktopHeader, type DesktopOutletContext } from './DesktopShell'
import { DesktopTaskTable } from './DesktopTaskTable'

type DesktopStatusTasksRouteProps = {
  status: DesktopTaskStatus
  eyebrow: string
  title: string
  errorTitle: string
}

export function DesktopStatusTasksRoute({
  status,
  eyebrow,
  title,
  errorTitle,
}: DesktopStatusTasksRouteProps) {
  const { session, groups } = useOutletContext<DesktopOutletContext>()
  const taskActions = useDesktopTaskActions(session)
  const [visibleSummary, setVisibleSummary] = useState({ visible: 0, total: 0 })
  const [searchParams, setSearchParams] = useSearchParams()
  const selectedTaskId = searchParams.get('task')
  const tasksQuery = useQuery({
    queryKey: ['desktop', 'tasks', 'all', status],
    queryFn: () => fetchAllDesktopTasks(status),
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
      eyebrow,
      title,
      subtitle: `${visibleSummary.visible} of ${visibleSummary.total || tasks.length} tasks visible`,
    }),
    [eyebrow, tasks.length, title, visibleSummary.total, visibleSummary.visible]
  )
  useDesktopHeader(header)

  function setSelectedTask(taskId: string | null) {
    const next = new URLSearchParams(searchParams)
    if (taskId) next.set('task', taskId)
    else next.delete('task')
    setSearchParams(next, taskId ? undefined : { replace: true })
  }

  if (tasksQuery.isLoading) {
    return <div className="h-96 animate-pulse rounded-soft bg-surface-container" aria-busy="true" />
  }
  if (tasksQuery.isError) {
    return (
      <section className="rounded-soft bg-[rgba(80,18,18,0.92)] p-6">
        <h1 className="font-display text-3xl text-on-surface">{errorTitle}</h1>
        <p className="mt-2 font-body text-sm text-red-100">Refresh and try again.</p>
      </section>
    )
  }

  const isOpenStatus = status === 'open'
  return (
    <>
      <DesktopTaskTable
        title={title}
        tasks={tasks}
        groups={groups}
        status={status}
        hideHeader
        busyTaskIds={taskActions.busyTaskIds}
        onComplete={isOpenStatus ? taskActions.completeTask : undefined}
        onReopen={isOpenStatus ? undefined : taskActions.reopenTask}
        onMoveDueDate={isOpenStatus ? taskActions.moveTaskDueDate : undefined}
        onTaskOpen={setSelectedTask}
        onVisibleCountChange={handleVisibleCountChange}
      />

      <DesktopTaskDetailModal
        taskId={selectedTaskId}
        isOpen={Boolean(selectedTaskId)}
        onClose={() => setSelectedTask(null)}
        session={session}
        groups={groups}
        onComplete={isOpenStatus ? (task) => {
          taskActions.completeTask(task)
          setSelectedTask(null)
        } : undefined}
        onRestore={isOpenStatus ? undefined : (task) => {
          taskActions.reopenTask(task)
          setSelectedTask(null)
        }}
        busyTaskIds={taskActions.busyTaskIds}
      />
    </>
  )
}
