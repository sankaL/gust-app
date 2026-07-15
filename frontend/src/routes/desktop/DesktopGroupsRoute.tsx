import { useCallback, useMemo, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useNavigate, useOutletContext } from 'react-router-dom'
import { CheckCircle2, ChevronRight, CircleDashed, FolderKanban, PenLine, Plus } from 'lucide-react'

import { useDesktopHeader, type DesktopOutletContext } from '../../components/DesktopShellContext'
import { refreshTaskScreenQueries } from '../../lib/taskScreenCache'
import { GroupModal } from '../../components/GroupModal'
import { GroupSummary } from '../../lib/api'

export function DesktopGroupsRoute() {
  const { session, groups, isGroupsLoading } = useOutletContext<DesktopOutletContext>()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  
  const [isModalOpen, setIsModalOpen] = useState(false)
  const [editingGroup, setEditingGroup] = useState<GroupSummary | null>(null)

  const handleOpenNewGroup = useCallback(() => {
    setEditingGroup(null)
    setIsModalOpen(true)
  }, [])

  const header = useMemo(
    () => ({
      eyebrow: 'Workflow structure',
      title: 'Group Configuration',
      subtitle: 'Create, rename, describe, and safely delete groups without breaking Inbox protections.',
      action: (
        <button
          type="button"
          onClick={handleOpenNewGroup}
          className="inline-flex items-center gap-2 rounded-pill bg-primary px-4 py-2 font-body text-sm font-semibold text-surface transition hover:-translate-y-0.5 active:translate-y-0"
        >
          <Plus className="h-4 w-4" strokeWidth={2.5} />
          Add Group
        </button>
      ),
    }),
    [handleOpenNewGroup]
  )
  useDesktopHeader(header)

  async function refreshGroups() {
    await refreshTaskScreenQueries(queryClient, {
      statuses: ['open', 'completed'],
      includeAllOpen: true,
      includeAllCompleted: true,
      includeGroupedTaskLists: true,
      includeTaskDetails: true,
    })
    await queryClient.invalidateQueries({ queryKey: ['desktop'] })
  }

  const handleOpenEditGroup = (group: GroupSummary) => {
    setEditingGroup(group)
    setIsModalOpen(true)
  }

  if (isGroupsLoading) {
    return (
      <div className="space-y-4">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          <div className="h-40 animate-pulse rounded-soft bg-surface-container" />
          <div className="h-40 animate-pulse rounded-soft bg-surface-container" />
          <div className="h-40 animate-pulse rounded-soft bg-surface-container" />
        </div>
      </div>
    )
  }

  return (
    <section className="space-y-6">
      {/* Stacked Cards Layout */}
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {groups.map((group) => {
          return (
            <article 
              key={group.id} 
              className="group relative flex cursor-pointer flex-col overflow-hidden rounded-soft bg-surface-container shadow-ambient transition hover:-translate-y-1 hover:shadow-[0_12px_24px_rgba(0,0,0,0.4)] active:translate-y-0"
              onClick={() => void navigate(`/desktop/groups/${group.id}`)}
            >
              <div className="flex flex-1 flex-col p-5">
                <div className="flex items-start justify-between gap-4">
                  <div className="flex items-center gap-3">
                    <div className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-dim text-primary">
                      <FolderKanban className="h-5 w-5" strokeWidth={1.8} />
                    </div>
                    <div>
                      <h3 className="truncate font-display text-lg text-on-surface group-hover:text-primary transition-colors">
                        {group.name}
                      </h3>
                      {group.is_system ? (
                        <span className="mt-1 inline-block rounded-pill bg-surface-dim px-2 py-0.5 font-body text-[0.62rem] uppercase tracking-[0.12em] text-on-surface-variant">
                          System
                        </span>
                      ) : null}
                    </div>
                  </div>

                  {!group.is_system ? (
                    <button
                      type="button"
                      onClick={(e) => {
                        e.stopPropagation()
                        handleOpenEditGroup(group)
                      }}
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-surface-dim text-on-surface-variant opacity-0 transition hover:bg-surface-container-high hover:text-on-surface group-hover:opacity-100 max-lg:opacity-100"
                      aria-label={`Edit ${group.name}`}
                    >
                      <PenLine className="h-3.5 w-3.5" strokeWidth={2} />
                    </button>
                  ) : null}
                </div>

                <p className="mt-4 line-clamp-2 min-h-[3rem] font-body text-sm leading-6 text-on-surface-variant">
                  {group.description || 'No description yet.'}
                </p>

                <div className="mt-6 flex flex-wrap items-center gap-4">
                  <div className="flex items-center gap-1.5 rounded-pill bg-[rgba(30,30,30,0.5)] px-3 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                    <CircleDashed className="h-3.5 w-3.5 text-warning" strokeWidth={2.5} />
                    <span className="font-body text-[0.7rem] font-semibold tracking-wide text-on-surface">
                      {group.open_task_count}
                    </span>
                    <span className="font-body text-[0.65rem] uppercase tracking-[0.1em] text-on-surface-variant">
                      open
                    </span>
                  </div>
                  <div className="flex items-center gap-1.5 rounded-pill bg-[rgba(30,30,30,0.5)] px-3 py-1.5 shadow-[inset_0_1px_0_rgba(255,255,255,0.05)]">
                    <CheckCircle2 className="h-3.5 w-3.5 text-success" strokeWidth={2.5} />
                    <span className="font-body text-[0.7rem] font-semibold tracking-wide text-on-surface">
                      {group.completed_task_count ?? 0}
                    </span>
                    <span className="font-body text-[0.65rem] uppercase tracking-[0.1em] text-on-surface-variant">
                      done
                    </span>
                  </div>
                </div>
              </div>
              
              {/* Card Footer / Interaction Hint */}
              <div className="border-t border-white/5 bg-[rgba(20,20,20,0.4)] px-5 py-3 transition-colors group-hover:bg-[rgba(30,30,30,0.6)]">
                <div className="flex items-center justify-between">
                  <span className="font-body text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-primary">
                    View Tasks
                  </span>
                  <ChevronRight className="h-4 w-4 text-primary transition-transform group-hover:translate-x-1" strokeWidth={2} />
                </div>
              </div>
            </article>
          )
        })}
      </div>

      <GroupModal
        isOpen={isModalOpen}
        onClose={() => setIsModalOpen(false)}
        group={editingGroup}
        groups={groups}
        session={session}
        onSuccess={refreshGroups}
      />
    </section>
  )
}
