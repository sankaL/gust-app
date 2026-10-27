import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import { ChevronRight, Folder, Inbox, ListTodo, Lock, Pencil, Plus, Trash2 } from 'lucide-react'
import { Link } from 'react-router-dom'

import { ScreenHeader } from '../components/AppShellView'
import { Button } from '../components/Button'
import { SessionGuard } from '../components/SessionGuard'
import { BottomSheet, SheetHeader } from '../components/ui/BottomSheet'
import { Chip } from '../components/ui/controls'
import { groupTone, type ChipTone } from '../components/ui/chipStyles'
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

const FIELD_CLASS = 'w-full rounded-card bg-surface-container-high px-4 py-3 text-on-surface outline-none ring-1 ring-inset ring-outline/50 transition-shadow placeholder:text-on-surface-variant/60 focus:ring-2 focus:ring-primary/60'

const TONE_TILE: Record<ChipTone, string> = {
  neutral: 'bg-chip-neutral text-chip-neutral-ink',
  blue: 'bg-chip-blue text-chip-blue-ink',
  violet: 'bg-chip-violet text-chip-violet-ink',
  amber: 'bg-chip-amber text-chip-amber-ink',
  green: 'bg-chip-green text-chip-green-ink',
  rose: 'bg-chip-rose text-chip-rose-ink',
}

// While the card is closed the link's ::after stretches over the whole card (padding included), so any tap opens the
// group; it fills the card's own rounded rect, which is why the press tint and focus ring live on it.
const STRETCHED_LINK = "after:absolute after:inset-0 after:rounded-[1.4rem] after:transition-colors after:duration-200 after:content-[''] hover:after:bg-on-surface/[0.03] focus-visible:after:ring-2 focus-visible:after:ring-primary/60 active:after:bg-on-surface/[0.05]"
// While editing, only the header row links out so the edit fields stay usable.
const HEADER_LINK = 'rounded-2xl transition-colors duration-200 hover:bg-on-surface/[0.03] focus-visible:ring-2 focus-visible:ring-primary/60 active:bg-on-surface/[0.05]'

function GroupCardHeader({ group, isEditing, onToggle }: { group: GroupSummary; isEditing: boolean; onToggle: () => void }) {
  const Icon = group.is_system ? Inbox : Folder
  return (
    <div className="flex items-start gap-3">
      <Link
        to={`/tasks?group=${encodeURIComponent(group.id)}`}
        aria-label={`Show ${group.name} tasks`}
        className={`group/link -m-2 flex min-w-0 flex-1 items-start gap-3.5 p-2 outline-none ${isEditing ? HEADER_LINK : STRETCHED_LINK}`}
      >
        <span className={`flex h-12 w-12 shrink-0 items-center justify-center rounded-2xl transition-transform duration-300 ease-spring group-active/link:scale-90 ${TONE_TILE[groupTone(group.name)]}`}>
          <Icon className="h-5 w-5" strokeWidth={2.1} aria-hidden="true" />
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex items-center gap-1">
            <h3 className="truncate font-display text-[1.05rem] font-bold leading-tight text-on-surface">{group.name}</h3>
            <ChevronRight className="h-4 w-4 shrink-0 text-on-surface-variant/60 transition-transform duration-200 group-hover/link:translate-x-0.5" strokeWidth={2.2} aria-hidden="true" />
          </span>
          {group.description ? <span className="mt-1 line-clamp-2 block font-body text-[0.82rem] leading-5 text-on-surface-variant">{group.description}</span> : null}
          <span className="mt-2.5 flex flex-wrap items-center gap-1.5">
            <Chip icon={ListTodo}>{`${group.open_task_count} ${group.open_task_count === 1 ? 'task' : 'tasks'}`}</Chip>
            {group.is_system ? <Chip tone="violet" icon={Lock}>Locked</Chip> : null}
          </span>
        </span>
      </Link>
      {!group.is_system ? (
        // Sits above the stretched link; the ::before widens the tap target without changing the pill's size.
        <Button variant={isEditing ? 'ghost' : 'secondary'} size="sm" onClick={onToggle} aria-label={isEditing ? 'Cancel editing' : 'Edit group'} className="relative z-10 before:absolute before:-inset-x-3 before:-inset-y-2.5 before:content-['']">
          {isEditing ? 'Cancel' : <><Pencil className="h-3.5 w-3.5" strokeWidth={2.4} />Edit</>}
        </Button>
      ) : null}
    </div>
  )
}

function GroupDangerZone({ groupId, groups, value, onChange, onDelete }: { groupId: string; groups: GroupSummary[]; value: string; onChange: (value: string) => void; onDelete: () => void }) {
  const options = groups.filter((candidate) => candidate.id !== groupId).map((candidate) => ({ value: candidate.id, label: candidate.name }))
  return (
    <div className="space-y-3 rounded-[1.1rem] bg-chip-rose/60 p-4 ring-1 ring-inset ring-tertiary/20">
      <p className="font-body text-[0.7rem] font-bold uppercase tracking-[0.14em] text-chip-rose-ink">Danger Zone</p>
      <SelectDropdown label="" value={value} onChange={(next) => onChange(String(next))} placeholder="Move all tasks to..." options={options} />
      <Button variant="danger" size="md" fullWidth onClick={onDelete}><Trash2 className="h-4 w-4" />Delete Group &amp; Reassign Tasks</Button>
    </div>
  )
}

function GroupEditPanel({ group, groups, draft, deleteTarget, onDraftChange, onDeleteTargetChange, onSave, onCancel, onDelete }: Omit<ManageGroupCardProps, 'onEdit'> & { draft: GroupDraft }) {
  return (
    <div className="animate-rise-in space-y-4 border-t border-outline/60 pt-4">
      <div className="grid gap-3">
        <input value={draft.name} onChange={(event) => onDraftChange(group.id, { ...draft, name: event.target.value })} className={FIELD_CLASS} placeholder="Group name" aria-label="Group name" />
        <textarea value={draft.description} onChange={(event) => onDraftChange(group.id, { ...draft, description: event.target.value })} rows={3} className={`${FIELD_CLASS} resize-none`} placeholder="Group description" aria-label="Group description" />
      </div>
      <div className="flex gap-2">
        <Button variant="ghost" size="md" className="flex-1" onClick={() => onCancel(group.id)}>Cancel</Button>
        <Button variant="primary" size="md" className="flex-[1.4]" onClick={() => onSave(group.id)}>Save Group</Button>
      </div>
      <GroupDangerZone groupId={group.id} groups={groups} value={deleteTarget} onChange={(value) => onDeleteTargetChange(group.id, value)} onDelete={() => onDelete(group.id)} />
    </div>
  )
}

function ManageGroupCard(props: ManageGroupCardProps) {
  const { group, draft } = props
  return (
    <section className={`relative flex flex-col gap-4 rounded-[1.4rem] p-4 shadow-card ring-1 ring-inset transition-colors duration-300 ${draft ? 'bg-card-active ring-card-active-line/30' : 'bg-surface-container-high ring-outline/40'}`}>
      <GroupCardHeader group={group} isEditing={Boolean(draft)} onToggle={() => draft ? props.onCancel(group.id) : props.onEdit(group)} />
      {draft ? <GroupEditPanel {...props} draft={draft} /> : null}
    </section>
  )
}

function AddGroupSheet({ open, name, description, onNameChange, onDescriptionChange, onClose, onCreate }: { open: boolean; name: string; description: string; onNameChange: (value: string) => void; onDescriptionChange: (value: string) => void; onClose: () => void; onCreate: () => void }) {
  return (
    <BottomSheet
      open={open}
      onClose={onClose}
      labelledBy="add-group-title"
      header={<SheetHeader eyebrow="Organize" title="Add a new group" titleId="add-group-title" onClose={onClose} closeLabel="Close modal" />}
      footer={<div className="flex gap-2.5"><Button variant="secondary" size="lg" className="flex-1" onClick={onClose}>Cancel</Button><Button variant="primary" size="lg" className="flex-[1.4]" onClick={onCreate} disabled={!name.trim()}>Create Group</Button></div>}
    >
      <div className="space-y-3 pt-1">
        <input value={name} onChange={(event) => onNameChange(event.target.value)} placeholder="Group name" aria-label="Group name" className={FIELD_CLASS} autoFocus />
        <textarea value={description} onChange={(event) => onDescriptionChange(event.target.value)} placeholder="Optional description for AI routing" aria-label="Group description" rows={4} className={`${FIELD_CLASS} resize-none`} />
        <p className="px-1 font-body text-xs leading-5 text-on-surface-variant">Gust uses the description to decide which captured tasks belong in this group.</p>
      </div>
    </BottomSheet>
  )
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
      <ScreenHeader eyebrow="Organize" title="Groups" />
      <section className="space-y-3 pt-2">
        <button
          type="button"
          onClick={() => setShowAddGroupModal(true)}
          className="group flex w-full items-center gap-3.5 rounded-[1.4rem] border-2 border-dashed border-outline p-4 text-left outline-none transition-all duration-200 hover:border-primary/60 hover:bg-primary/[0.04] focus-visible:ring-2 focus-visible:ring-primary/60 active:scale-[0.99]"
        >
          <span className="flex h-12 w-12 items-center justify-center rounded-2xl bg-primary text-on-primary shadow-card transition-transform duration-300 ease-spring group-hover:rotate-90">
            <Plus className="h-5 w-5" strokeWidth={2.5} aria-hidden="true" />
          </span>
          <span>
            <span className="block font-display text-[1.02rem] font-bold text-on-surface">Add Group</span>
            <span className="block font-body text-xs text-on-surface-variant">Projects, areas, people, or anything you sort by</span>
          </span>
        </button>

        <AddGroupSheet
          open={showAddGroupModal}
          name={newGroupName}
          description={newGroupDescription}
          onNameChange={setNewGroupName}
          onDescriptionChange={setNewGroupDescription}
          onClose={() => {
            setShowAddGroupModal(false)
            setNewGroupName('')
            setNewGroupDescription('')
          }}
          onCreate={() => {
            createGroupMutation.mutate()
            setShowAddGroupModal(false)
          }}
        />

        {groupsQuery.data?.map((group, index) => <div key={group.id} className="animate-rise-in" style={{ ['--stagger' as string]: Math.min(index, 8) }}><ManageGroupCard group={group} groups={groupsQuery.data ?? []} draft={drafts[group.id]} deleteTarget={deleteTargets[group.id] ?? ''} onEdit={(value) => setDrafts((current) => ({ ...current, [value.id]: { name: value.name, description: value.description ?? '' } }))} onCancel={(groupId) => setDrafts((current) => { const next = { ...current }; delete next[groupId]; return next })} onDraftChange={(groupId, value) => setDrafts((current) => ({ ...current, [groupId]: value }))} onDeleteTargetChange={(groupId, value) => setDeleteTargets((current) => ({ ...current, [groupId]: value }))} onSave={(groupId) => updateGroupMutation.mutate(groupId)} onDelete={(groupId) => deleteGroupMutation.mutate(groupId)} /></div>)}
      </section>
    </SessionGuard>
  )
}
