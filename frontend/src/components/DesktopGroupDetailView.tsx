import { AlertTriangle, CalendarDays, CheckCircle2, ClipboardList } from 'lucide-react'

import type { GroupSummary, TaskSummary } from '../lib/api'
import type { useDesktopTaskActions } from '../hooks/useDesktopTaskActions'
import { DesktopTaskDetailModal } from './DesktopTaskDetailModal'
import type { DesktopOutletContext } from './DesktopShellContext'
import { DesktopTaskTable } from './DesktopTaskTable'

function SummaryCard({ label, value, icon, background, foreground }: { label: string; value: number; icon: 'open' | 'due' | 'completed' | 'review'; background: string; foreground: string }) {
  const Icon = { open: ClipboardList, due: CalendarDays, completed: CheckCircle2, review: AlertTriangle }[icon]
  return <div className="flex min-w-0 items-center gap-3 rounded-card bg-surface-dim/55 px-4 py-3"><div className={`flex h-10 w-10 shrink-0 items-center justify-center rounded-full ${background}`}><Icon className={`h-5 w-5 ${foreground}`} strokeWidth={2} /></div><div className="min-w-0 flex-1"><p className="font-display text-2xl leading-none text-on-surface">{value}</p><p className="font-body text-xs font-medium uppercase tracking-wider text-on-surface-variant">{label}</p></div></div>
}

function GroupSummary({ openTasks, completedTasks, dueThisWeek }: { openTasks: TaskSummary[]; completedTasks: TaskSummary[]; dueThisWeek: number }) {
  return <section className="grid w-full grid-cols-4 gap-3 rounded-soft bg-surface-container p-3 shadow-ambient max-xl:grid-cols-2 max-sm:grid-cols-1"><SummaryCard label="Open" value={openTasks.length} icon="open" background="bg-primary/10" foreground="text-primary" /><SummaryCard label="Due this week" value={dueThisWeek} icon="due" background="bg-primary/10" foreground="text-primary" /><SummaryCard label="Completed" value={completedTasks.length} icon="completed" background="bg-success/10" foreground="text-success" /><SummaryCard label="Need review" value={openTasks.filter((task) => task.needs_review).length} icon="review" background="bg-warning/10" foreground="text-warning" /></section>
}

export function DesktopGroupDetailView({ group, openTasks, completedTasks, dueThisWeek, groups, session, actions, selectedTaskId, onOpen, onClose }: { group: GroupSummary; openTasks: TaskSummary[]; completedTasks: TaskSummary[]; dueThisWeek: number; groups: GroupSummary[]; session: DesktopOutletContext['session']; actions: ReturnType<typeof useDesktopTaskActions>; selectedTaskId: string | null; onOpen: (taskId: string) => void; onClose: () => void }) {
  return <div className="space-y-6"><GroupSummary openTasks={openTasks} completedTasks={completedTasks} dueThisWeek={dueThisWeek} /><DesktopTaskTable title={`${group.name} Tasks`} tasks={[...openTasks, ...completedTasks]} groups={groups} status="all" lockedGroupId={group.id} hideHeader busyTaskIds={actions.busyTaskIds} onComplete={actions.completeTask} onMoveDueDate={actions.moveTaskDueDate} onReopen={actions.reopenTask} onTaskOpen={onOpen} /><DesktopTaskDetailModal taskId={selectedTaskId} isOpen={Boolean(selectedTaskId)} onClose={onClose} session={session} groups={groups} onComplete={(task) => { actions.completeTask(task); onClose() }} onRestore={(task) => { actions.reopenTask(task); onClose() }} busyTaskIds={actions.busyTaskIds} /></div>
}
