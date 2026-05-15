import { useMemo } from 'react'
import { Link, useOutletContext, useParams } from 'react-router-dom'
import { ArrowLeft } from 'lucide-react'

import { DesktopTaskDetailModal } from '../../components/DesktopTaskDetailModal'
import { useDesktopHeader, type DesktopOutletContext } from '../../components/DesktopShell'
import { useDesktopTaskActions } from '../../hooks/useDesktopTaskActions'

export function DesktopTaskDetailRoute() {
  const { taskId } = useParams()
  const { session, groups } = useOutletContext<DesktopOutletContext>()
  const taskActions = useDesktopTaskActions(session)

  const header = useMemo(
    () => ({
      eyebrow: 'Desktop task',
      title: 'Task Editor',
      subtitle: 'Edit task details, reminders, recurrence, and subtasks without switching to mobile layout.',
    }),
    []
  )
  useDesktopHeader(header)

  return (
    <div className="space-y-4">
      <Link
        to="/desktop/tasks"
        className="inline-flex h-10 items-center gap-2 rounded-pill bg-surface-dim px-4 font-body text-sm font-semibold text-on-surface-variant transition hover:bg-surface-container-highest hover:text-on-surface"
      >
        <ArrowLeft className="h-4 w-4" strokeWidth={1.8} />
        Back to open tasks
      </Link>

      <DesktopTaskDetailModal
        taskId={taskId ?? null}
        isOpen={Boolean(taskId)}
        session={session}
        groups={groups}
        mode="page"
        onComplete={taskActions.completeTask}
        onRestore={taskActions.reopenTask}
        busyTaskIds={taskActions.busyTaskIds}
      />
    </div>
  )
}
