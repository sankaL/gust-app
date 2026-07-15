import { useMemo } from 'react'
import { Settings2 } from 'lucide-react'
import { Link, useOutletContext, useParams } from 'react-router-dom'

import { DesktopGroupDetailView } from '../../components/DesktopGroupDetailView'
import { useDesktopHeader, type DesktopOutletContext } from '../../components/DesktopShellContext'
import { useDesktopTaskActions } from '../../hooks/useDesktopTaskActions'
import { useDesktopTaskCollections } from '../../hooks/useDesktopTaskCollections'
import { useDesktopTaskPreview } from '../../hooks/useDesktopTaskPreview'
import { addDaysIso, getTodayIsoDate } from '../../lib/desktopData'

function GroupMissing() {
  return <section className="rounded-soft bg-surface-container p-6 shadow-ambient"><h1 className="font-display text-3xl text-on-surface">Group not found</h1><p className="mt-2 font-body text-sm text-on-surface-variant">Choose a group from the left navigation or return to group configuration.</p><Link to="/desktop/groups" className="mt-5 inline-flex rounded-pill bg-primary px-4 py-2 font-body text-sm font-semibold text-surface">Open Groups</Link></section>
}

export function DesktopGroupDetailRoute() {
  const { groupId } = useParams()
  const { session, groups } = useOutletContext<DesktopOutletContext>()
  const group = groups.find((candidate) => candidate.id === groupId)
  const actions = useDesktopTaskActions(session)
  const preview = useDesktopTaskPreview()
  const tasks = useDesktopTaskCollections({ groupId, enabled: Boolean(groupId) })
  const today = getTodayIsoDate(session.timezone)
  const weekEnd = addDaysIso(today, 6)
  const dueThisWeek = tasks.openTasks.filter((task) => task.due_date && task.due_date >= today && task.due_date <= weekEnd).length
  const description = group?.description || 'No description yet. Add one from group configuration to improve routing context.'
  const header = useMemo(() => ({ eyebrow: group ? 'Group workspace' : 'Groups', title: group?.name ?? 'Group not found', subtitle: group ? description : 'Choose a group from the left navigation or return to group configuration.', action: group ? <Link to="/desktop/groups" className="inline-flex h-10 items-center gap-2 rounded-pill bg-surface-dim px-4 font-body text-sm font-semibold text-on-surface-variant transition hover:bg-surface-container-highest hover:text-on-surface"><Settings2 className="h-4 w-4" strokeWidth={1.8} />Configure</Link> : undefined }), [description, group])
  useDesktopHeader(header)

  if (!group) return <GroupMissing />
  if (tasks.openQuery.isLoading || tasks.completedQuery.isLoading) return <div className="h-96 animate-pulse rounded-soft bg-surface-container" aria-busy="true" />
  if (tasks.openQuery.isError || tasks.completedQuery.isError) return <section className="rounded-soft bg-[rgba(80,18,18,0.92)] p-6"><h1 className="font-display text-3xl text-on-surface">Group tasks could not load</h1><p className="mt-2 font-body text-sm text-red-100">Refresh and try again.</p></section>
  return <DesktopGroupDetailView group={group} openTasks={tasks.openTasks} completedTasks={tasks.completedTasks} dueThisWeek={dueThisWeek} groups={groups} session={session} actions={actions} selectedTaskId={preview.selectedTaskId} onOpen={preview.openTaskPreview} onClose={preview.closeTaskPreview} />
}
