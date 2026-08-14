import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { SessionGuard } from '../components/SessionGuard'
import { useNotifications } from '../components/Notifications'
import { SelectDropdown } from '../components/SelectDropdown'
import {
  ApiError,
  createGroup,
  deleteGroup,
  getSessionStatus,
  listGroups,
  updateGroup,
  type GroupSummary,
} from '../lib/api'
import {
  refreshTaskScreenQueries,
  TASK_SCREEN_GC_TIME_MS,
  TASK_SCREEN_STALE_TIME_MS,
} from '../lib/taskScreenCache'
import { requireCsrfToken } from '../lib/sessionSecurity'

function buildFriendlyMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message
  }

  return fallback
}

type GroupDraft = { name: string; description: string }

type ManageGroupCardProps = {
  group: GroupSummary
  groups: GroupSummary[]
  draft?: GroupDraft
  deleteTarget: string
  onEdit: (group: GroupSummary) => void
  onCancel: (groupId: string) => void
  onDraftChange: (groupId: string, draft: GroupDraft) => void
  onDeleteTargetChange: (groupId: string, targetId: string) => void
  onSave: (groupId: string) => void
  onDelete: (groupId: string) => void
}

function GroupCardHeader({ group, isEditing, onToggle }: { group: GroupSummary; isEditing: boolean; onToggle: () => void }) {
  return <div className="flex items-start justify-between gap-4"><div className="min-w-0 flex-1"><h3 className="truncate font-display text-lg font-medium leading-tight text-on-surface">{group.name}</h3>{group.description ? <p className="mt-1 line-clamp-2 font-body text-xs text-on-surface-variant">{group.description}</p> : null}</div><div className="flex shrink-0 flex-col items-end gap-2"><div className="flex items-center gap-2"><span className="rounded-pill bg-surface-dim px-2 py-0.5 font-body text-[0.65rem] uppercase tracking-widest text-on-surface-variant">{group.open_task_count} TASKS</span>{group.is_system ? <span className="rounded-pill bg-primary/20 px-2 py-0.5 font-body text-[0.65rem] uppercase tracking-widest text-primary">LOCKED</span> : null}</div>{!group.is_system ? <button type="button" onClick={onToggle} className="mt-1 rounded-pill bg-surface-dim px-3 py-1 font-body text-[0.65rem] font-bold uppercase tracking-widest text-on-surface shadow-[0_4px_12px_rgba(0,0,0,0.5),_inset_0_2px_4px_rgba(255,255,255,0.1)] transition-all hover:-translate-y-0.5 active:scale-95" aria-label={isEditing ? 'Cancel editing' : 'Edit group'}>{isEditing ? 'Cancel' : 'Edit'}</button> : null}</div></div>
}

function GroupDangerZone({ groupId, groups, value, onChange, onDelete }: { groupId: string; groups: GroupSummary[]; value: string; onChange: (value: string) => void; onDelete: () => void }) {
  const options = groups.filter((candidate) => candidate.id !== groupId).map((candidate) => ({ value: candidate.id, label: candidate.name }))
  return <div className="rounded-card bg-surface-dim p-4"><div className="space-y-4"><p className="font-body text-[0.65rem] font-bold uppercase tracking-widest text-error">Danger Zone</p><SelectDropdown label="" value={value} onChange={(next) => onChange(String(next))} placeholder="Move all tasks to..." options={options} /><button type="button" onClick={onDelete} className="w-full rounded-pill bg-error/20 px-4 py-2 text-sm font-medium text-error shadow-[0_4px_12px_rgba(0,0,0,0.5)] transition-all hover:-translate-y-0.5 active:scale-95">Delete Group &amp; Reassign Tasks</button></div></div>
}

function GroupEditPanel({ group, groups, draft, deleteTarget, onDraftChange, onDeleteTargetChange, onSave, onCancel, onDelete }: Omit<ManageGroupCardProps, 'onEdit'> & { draft: GroupDraft }) {
  return <><div className="grid gap-3 border-t border-white/5 pt-4"><input value={draft.name} onChange={(event) => onDraftChange(group.id, { ...draft, name: event.target.value })} className="w-full rounded-card bg-surface-dim px-3 py-3 text-on-surface outline-none transition-all placeholder:text-on-surface-variant/40 focus:ring-1 focus:ring-primary" placeholder="Group name" /><textarea value={draft.description} onChange={(event) => onDraftChange(group.id, { ...draft, description: event.target.value })} rows={3} className="w-full rounded-card bg-surface-dim px-3 py-3 text-on-surface outline-none transition-all placeholder:text-on-surface-variant/40 focus:ring-1 focus:ring-primary" placeholder="Group description" /></div><div className="flex flex-wrap justify-end gap-2"><button type="button" onClick={() => onSave(group.id)} className="rounded-pill bg-primary px-4 py-2 text-sm font-medium text-surface">Save Group</button><button type="button" onClick={() => onCancel(group.id)} className="rounded-pill border border-outline/30 px-4 py-2 text-sm text-on-surface-variant">Cancel</button></div><GroupDangerZone groupId={group.id} groups={groups} value={deleteTarget} onChange={(value) => onDeleteTargetChange(group.id, value)} onDelete={() => onDelete(group.id)} /></>
}

function ManageGroupCard(props: ManageGroupCardProps) {
  const { group, draft } = props
  return <section className="flex flex-col gap-4 rounded-card border border-white/5 bg-surface-container-high p-4"><GroupCardHeader group={group} isEditing={Boolean(draft)} onToggle={() => draft ? props.onCancel(group.id) : props.onEdit(group)} />{draft ? <GroupEditPanel {...props} draft={draft} /> : null}</section>
}

export function ManageGroupsRoute() {
  const queryClient = useQueryClient()
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupDescription, setNewGroupDescription] = useState('')
  const [drafts, setDrafts] = useState<Record<string, { name: string; description: string }>>({})
  const [deleteTargets, setDeleteTargets] = useState<Record<string, string>>({})
  const [showAddGroupModal, setShowAddGroupModal] = useState(false)
  const { notifyError, notifySuccess } = useNotifications()

  const sessionQuery = useQuery({
    queryKey: ['session-status'],
    queryFn: getSessionStatus,
    retry: false,
  })

  const groupsQuery = useQuery({
    queryKey: ['groups'],
    queryFn: listGroups,
    enabled: sessionQuery.data?.signed_in === true,
    staleTime: TASK_SCREEN_STALE_TIME_MS,
    gcTime: TASK_SCREEN_GC_TIME_MS,
  })

  async function refreshGroups() {
    await refreshTaskScreenQueries(queryClient, {
      statuses: ['open', 'completed'],
      includeAllOpen: true,
      includeAllCompleted: true,
      includeGroupedTaskLists: true,
      includeTaskDetails: true,
    })
  }

  const createGroupMutation = useMutation({
    mutationFn: async () => {
      const csrfToken = requireCsrfToken(sessionQuery.data)
      return createGroup(
        {
          name: newGroupName,
          description: newGroupDescription || null
        },
        csrfToken
      )
    },
    onSuccess: () => {
      setNewGroupName('')
      setNewGroupDescription('')
      notifySuccess('Group created.')
      void refreshGroups()
    },
    onError: (error) => {
      notifyError(buildFriendlyMessage(error, 'Group could not be created.'))
    }
  })

  const updateGroupMutation = useMutation({
    mutationFn: async (groupId: string) => {
      const csrfToken = requireCsrfToken(sessionQuery.data)
      const draft = drafts[groupId]
      return updateGroup(
        groupId,
        {
          name: draft?.name,
          description: draft?.description ?? null
        },
        csrfToken
      )
    },
    onSuccess: () => {
      notifySuccess('Group updated.')
      void refreshGroups()
    },
    onError: (error) => {
      notifyError(buildFriendlyMessage(error, 'Group could not be updated.'))
    }
  })

  const deleteGroupMutation = useMutation({
    mutationFn: async (groupId: string) => {
      const destinationGroupId = deleteTargets[groupId]
      if (!destinationGroupId) {
        throw new ApiError(
          'Choose a destination group before deleting.',
          'invalid_group',
          422
        )
      }
      const csrfToken = requireCsrfToken(sessionQuery.data)
      return deleteGroup(groupId, destinationGroupId, csrfToken)
    },
    onSuccess: () => {
      notifySuccess('Group deleted.')
      void refreshGroups()
    },
    onError: (error) => {
      notifyError(buildFriendlyMessage(error, 'Group could not be deleted.'))
    }
  })

  return (
    <SessionGuard
      session={sessionQuery.data}
      isLoading={sessionQuery.isLoading}
      isError={sessionQuery.isError}
      title="Manage Groups"
      eyebrow="Workflow structure"
      description="Create, rename, describe, and safely delete groups without breaking Inbox protections."
    >
      <section className="space-y-4">
        <button
          type="button"
          onClick={() => setShowAddGroupModal(true)}
          className="group relative flex w-full items-center justify-center gap-2 rounded-soft p-4 transition-all duration-200 outline-none select-none bg-[radial-gradient(circle_at_top_left,_#5b21b6_0%,_#2e1065_100%)] text-white shadow-[0_6px_0_#171033,_0_8px_15px_rgba(0,0,0,0.4),_inset_0_1px_2px_rgba(255,255,255,0.2)] hover:-translate-y-[1px] hover:shadow-[0_7px_0_#171033,_0_12px_20px_rgba(0,0,0,0.5),_inset_0_1px_2px_rgba(255,255,255,0.2)] active:translate-y-[6px] active:shadow-[0_0px_0_#171033,_0_2px_4px_rgba(0,0,0,0.4),_inset_0_2px_6px_rgba(0,0,0,0.3)]"
        >
          <span className="font-display text-lg drop-shadow-sm">+</span>
          <span className="font-body text-sm font-medium drop-shadow-sm">Add Group</span>
        </button>

        {showAddGroupModal ? (
          <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4">
            <div className="w-full max-w-md rounded-soft bg-surface-container p-6 shadow-ambient">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <p className="font-display text-xl text-on-surface">Add a new group</p>
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddGroupModal(false)
                      setNewGroupName('')
                      setNewGroupDescription('')
                    }}
                    className="rounded-full bg-surface-container-high p-2 text-on-surface-variant transition-colors hover:bg-surface-container-highest"
                    aria-label="Close modal"
                  >
                      <span className="font-body text-xs font-bold uppercase tracking-widest">Close</span>
                  </button>
                </div>
                <input
                  value={newGroupName}
                  onChange={(event) => setNewGroupName(event.target.value)}
                  placeholder="Group name"
                  className="w-full rounded-card bg-surface-dim px-3 py-3 text-on-surface outline-none focus:ring-1 focus:ring-primary placeholder:text-on-surface-variant/40 transition-all"
                />
                <textarea
                  value={newGroupDescription}
                  onChange={(event) => setNewGroupDescription(event.target.value)}
                  placeholder="Optional description for AI routing"
                  rows={3}
                  className="w-full rounded-card bg-surface-dim px-3 py-3 text-on-surface outline-none focus:ring-1 focus:ring-primary placeholder:text-on-surface-variant/40 transition-all"
                />
                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={() => {
                      setShowAddGroupModal(false)
                      setNewGroupName('')
                      setNewGroupDescription('')
                    }}
                    className="flex-1 rounded-pill border border-outline/30 px-4 py-2 text-sm text-on-surface-variant"
                  >
                    Cancel
                  </button>
                  <button
                    type="button"
                    onClick={() => {
                      createGroupMutation.mutate()
                      setShowAddGroupModal(false)
                    }}
                    disabled={!newGroupName.trim()}
                    className="flex-1 rounded-pill bg-primary px-4 py-2 text-sm font-medium text-surface disabled:opacity-50"
                  >
                    Create Group
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}

        <div className="space-y-3">
          {groupsQuery.data?.map((group) => <ManageGroupCard key={group.id} group={group} groups={groupsQuery.data ?? []} draft={drafts[group.id]} deleteTarget={deleteTargets[group.id] ?? ''} onEdit={(value) => setDrafts((current) => ({ ...current, [value.id]: { name: value.name, description: value.description ?? '' } }))} onCancel={(groupId) => setDrafts((current) => { const next = { ...current }; delete next[groupId]; return next })} onDraftChange={(groupId, value) => setDrafts((current) => ({ ...current, [groupId]: value }))} onDeleteTargetChange={(groupId, value) => setDeleteTargets((current) => ({ ...current, [groupId]: value }))} onSave={(groupId) => updateGroupMutation.mutate(groupId)} onDelete={(groupId) => deleteGroupMutation.mutate(groupId)} />)}
        </div>
      </section>
    </SessionGuard>
  )
}
