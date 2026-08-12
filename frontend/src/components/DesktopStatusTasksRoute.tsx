import { useCallback, useMemo, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { useOutletContext } from 'react-router-dom'

import { useDesktopTaskActions } from '../hooks/useDesktopTaskActions'
import { useDesktopTaskPreview } from '../hooks/useDesktopTaskPreview'
import { fetchAllDesktopTasks, getTodayIsoDate, type DesktopTaskStatus } from '../lib/desktopData'
import { TASK_SCREEN_GC_TIME_MS, TASK_SCREEN_STALE_TIME_MS } from '../lib/taskScreenCache'
import { DesktopTaskDetailModal } from './DesktopTaskDetailModal'
import { useDesktopHeader, type DesktopOutletContext } from './DesktopShellContext'
import { DesktopTaskTable } from './DesktopTaskTable'

type DesktopStatusTasksRouteProps = {
  status: DesktopTaskStatus
  eyebrow: string
  title: string
  errorTitle: string
}

function StatusTaskContent({ status, title, tasks, groups, session, taskActions, preview, onVisibleCountChange }: {
  status: DesktopTaskStatus; title: string; tasks: Awaited<ReturnType<typeof fetchAllDesktopTasks>>;
  groups: DesktopOutletContext['groups']; session: DesktopOutletContext['session'];
  taskActions: ReturnType<typeof useDesktopTaskActions>; preview: ReturnType<typeof useDesktopTaskPreview>;
  onVisibleCountChange: (visible: number, total: number) => void
}) {
  const open = status === 'open'
  const tableActions = open
    ? { onComplete: taskActions.completeTask, onMoveDueDate: taskActions.moveTaskDueDate }
    : { onReopen: taskActions.reopenTask }
  const detailActions = open
    ? { onComplete: (task: (typeof tasks)[number]) => { taskActions.completeTask(task); preview.closeTaskPreview() } }
    : { onRestore: (task: (typeof tasks)[number]) => { taskActions.reopenTask(task); preview.closeTaskPreview() } }
  return <><DesktopTaskTable title={title} tasks={tasks} groups={groups} status={status} todayIso={getTodayIsoDate(session.timezone)} hideHeader busyTaskIds={taskActions.busyTaskIds} onTaskOpen={preview.openTaskPreview} onVisibleCountChange={onVisibleCountChange} {...tableActions} /><DesktopTaskDetailModal taskId={preview.selectedTaskId} isOpen={Boolean(preview.selectedTaskId)} onClose={preview.closeTaskPreview} session={session} groups={groups} busyTaskIds={taskActions.busyTaskIds} {...detailActions} /></>
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
  const preview = useDesktopTaskPreview()
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

  return <StatusTaskContent status={status} title={title} tasks={tasks} groups={groups} session={session} taskActions={taskActions} preview={preview} onVisibleCountChange={handleVisibleCountChange} />
}
