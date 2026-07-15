import { useEffect, useState } from 'react'
import { X, Trash2, Save, Plus } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'

import { ApiError, createGroup, deleteGroup, updateGroup, type GroupSummary, type SessionStatus } from '../lib/api'
import { useNotifications } from './Notifications'
import { SelectDropdown } from './SelectDropdown'
import { useEscapeDismiss } from '../hooks/useFloatingDismiss'

type GroupModalProps = {
  isOpen: boolean
  onClose: () => void
  group: GroupSummary | null
  groups: GroupSummary[]
  session: SessionStatus
  onSuccess: () => Promise<void> | void
}

function buildFriendlyMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError || error instanceof Error) {
    return error.message
  }
  return fallback
}

export function GroupModal({
  isOpen,
  onClose,
  group,
  groups,
  session,
  onSuccess,
}: GroupModalProps) {
  const { notifyError, notifySuccess } = useNotifications()
  const [name, setName] = useState('')
  const [description, setDescription] = useState('')
  const [deleteTargetId, setDeleteTargetId] = useState('')

  useEffect(() => {
    if (isOpen) {
      setName(group?.name ?? '')
      setDescription(group?.description ?? '')
      setDeleteTargetId('')
    }
  }, [isOpen, group])

  useEscapeDismiss(isOpen, onClose)

  const requireCsrf = () => {
    const csrfToken = session.csrf_token
    if (!csrfToken) throw new ApiError('Your session is missing a CSRF token.', 'csrf_missing', 403)
    return csrfToken
  }

  const saveMutation = useMutation({
    mutationFn: () => {
      if (group) {
        return updateGroup(
          group.id,
          {
            name: name.trim(),
            description: description.trim() || null,
          },
          requireCsrf()
        )
      }
      return createGroup(
        {
          name: name.trim(),
          description: description.trim() || null,
        },
        requireCsrf()
      )
    },
    onSuccess: async () => {
      notifySuccess(group ? 'Group updated.' : 'Group created.')
      await onSuccess()
      onClose()
    },
    onError: (error) => notifyError(buildFriendlyMessage(error, group ? 'Group could not be updated.' : 'Group could not be created.')),
  })

  const deleteMutation = useMutation({
    mutationFn: () => {
      if (!group) throw new Error('No group to delete')
      if (!deleteTargetId) throw new ApiError('Choose a destination group before deleting.', 'invalid_group', 422)
      return deleteGroup(group.id, deleteTargetId, requireCsrf())
    },
    onSuccess: async () => {
      notifySuccess('Group deleted.')
      await onSuccess()
      onClose()
    },
    onError: (error) => notifyError(buildFriendlyMessage(error, 'Group could not be deleted.')),
  })

  if (!isOpen) return null

  const isEditing = Boolean(group)
  const isSystem = group?.is_system ?? false
  const deletionOptions = groups.filter((candidate) => candidate.id !== group?.id)

  return <GroupModalView isEditing={isEditing} isSystem={isSystem} groupName={group?.name} name={name} description={description} deleteTargetId={deleteTargetId} deletionOptions={deletionOptions} saving={saveMutation.isPending} deleting={deleteMutation.isPending} onClose={onClose} onName={setName} onDescription={setDescription} onDeleteTarget={setDeleteTargetId} onSave={() => saveMutation.mutate()} onDelete={() => deleteMutation.mutate()} />
}

type GroupModalViewProps = { isEditing: boolean; isSystem: boolean; groupName?: string; name: string; description: string; deleteTargetId: string; deletionOptions: GroupSummary[]; saving: boolean; deleting: boolean; onClose: () => void; onName: (value: string) => void; onDescription: (value: string) => void; onDeleteTarget: (value: string) => void; onSave: () => void; onDelete: () => void }

function GroupModalView(props: GroupModalViewProps) {
  return <div className="fixed inset-0 z-[120] flex items-end justify-center bg-black/65 p-3 backdrop-blur-md sm:items-center sm:p-5" role="dialog" aria-modal="true" aria-labelledby="group-modal-title" onMouseDown={(event) => { if (event.target === event.currentTarget) props.onClose() }}><div className="w-full max-w-lg overflow-hidden rounded-[1.7rem] bg-[radial-gradient(circle_at_top_left,_rgba(186,158,255,0.18),_rgba(32,32,31,0.98)_42%,_rgba(14,14,14,1)_100%)] shadow-[0_28px_80px_rgba(0,0,0,0.62)]"><GroupModalHeader isEditing={props.isEditing} groupName={props.groupName} onClose={props.onClose} /><GroupForm isEditing={props.isEditing} name={props.name} description={props.description} saving={props.saving} onName={props.onName} onDescription={props.onDescription} onSave={props.onSave} />{props.isEditing && !props.isSystem ? <DeleteGroupSection deleteTargetId={props.deleteTargetId} deletionOptions={props.deletionOptions} deleting={props.deleting} onDeleteTarget={props.onDeleteTarget} onDelete={props.onDelete} /> : null}</div></div>
}

type GroupModalHeaderProps = { isEditing: boolean; groupName?: string; onClose: () => void }
function GroupModalHeader(props: GroupModalHeaderProps) {
  return <div className="flex items-start justify-between gap-4 p-5 pb-3 sm:p-6 sm:pb-4"><div className="min-w-0 space-y-2"><span className="rounded-pill bg-white/6 px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">{props.isEditing ? 'Edit Group' : 'New Group'}</span><h2 id="group-modal-title" className="font-display text-2xl text-on-surface sm:text-3xl">{props.isEditing ? props.groupName : 'Create Group'}</h2></div><button type="button" onClick={props.onClose} className="flex h-10 w-10 items-center justify-center rounded-full bg-white/8" aria-label="Close"><X className="h-4 w-4" /></button></div>
}

type GroupFormProps = { isEditing: boolean; name: string; description: string; saving: boolean; onName: (value: string) => void; onDescription: (value: string) => void; onSave: () => void }
function GroupForm(props: GroupFormProps) {
  return <form onSubmit={(event) => { event.preventDefault(); if (props.name.trim()) props.onSave() }} className="space-y-4 px-5 pb-4 sm:px-6"><GroupTextField label="Name" value={props.name} onChange={props.onName} placeholder="e.g. Work, Errands, Home" /><GroupTextField label="Description" value={props.description} onChange={props.onDescription} placeholder="Optional details about this group." multiline /><button type="submit" disabled={!props.name.trim() || props.saving} className="flex w-full items-center justify-center gap-2 rounded-pill bg-primary px-4 py-3 text-sm font-semibold text-surface disabled:opacity-50">{props.isEditing ? <Save className="h-4 w-4" /> : <Plus className="h-4 w-4" />}{props.saving ? 'Saving...' : 'Save Group'}</button></form>
}

function GroupTextField({ label, value, onChange, placeholder, multiline = false }: { label: string; value: string; onChange: (value: string) => void; placeholder: string; multiline?: boolean }) {
  const shared = { value, onChange: (event: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => onChange(event.target.value), placeholder, className: 'w-full rounded-card bg-surface-dim px-4 py-3 text-sm text-on-surface outline-none ring-1 ring-white/10 focus:ring-primary' }
  return <label className="block space-y-1"><span className="text-[0.68rem] uppercase tracking-[0.16em] text-on-surface-variant">{label}</span>{multiline ? <textarea {...shared} rows={3} /> : <input {...shared} autoFocus />}</label>
}

type DeleteGroupSectionProps = { deleteTargetId: string; deletionOptions: GroupSummary[]; deleting: boolean; onDeleteTarget: (value: string) => void; onDelete: () => void }
function DeleteGroupSection(props: DeleteGroupSectionProps) {
  return <div className="border-t border-white/5 bg-[rgba(20,20,20,0.86)] p-5 sm:px-6"><h3 className="font-display text-lg text-error">Delete Group</h3><p className="mt-1 text-xs text-on-surface-variant">Deleting this group requires moving its existing tasks to another group to prevent accidental data loss.</p><div className="mt-3 flex flex-wrap items-center gap-3"><div className="min-w-[14rem] flex-1"><SelectDropdown label="" placeholder="Move tasks to..." options={props.deletionOptions.map((candidate) => ({ value: candidate.id, label: candidate.name }))} value={props.deleteTargetId} onChange={(value) => props.onDeleteTarget(String(value))} className="space-y-0" /></div><button type="button" onClick={props.onDelete} disabled={!props.deleteTargetId || props.deleting} className="flex items-center gap-2 rounded-pill bg-error/20 px-4 py-3 text-sm font-semibold text-error disabled:opacity-50"><Trash2 className="h-4 w-4" />{props.deleting ? 'Deleting...' : 'Delete'}</button></div></div>
}
