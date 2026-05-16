import { useEffect, useState } from 'react'
import { X, Trash2, Save, Plus } from 'lucide-react'
import { useMutation } from '@tanstack/react-query'

import { ApiError, createGroup, deleteGroup, updateGroup, type GroupSummary, type SessionStatus } from '../lib/api'
import { useNotifications } from './Notifications'
import { SelectDropdown } from './SelectDropdown'

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

  useEffect(() => {
    if (!isOpen) return

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') onClose()
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

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

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end justify-center bg-black/65 p-3 backdrop-blur-md sm:items-center sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="group-modal-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div className="w-full max-w-lg overflow-hidden rounded-[1.7rem] bg-[radial-gradient(circle_at_top_left,_rgba(186,158,255,0.18),_rgba(32,32,31,0.98)_42%,_rgba(14,14,14,1)_100%)] shadow-[0_28px_80px_rgba(0,0,0,0.62)]">
        <div className="flex flex-col">
          <div className="flex items-start justify-between gap-4 p-5 pb-3 sm:p-6 sm:pb-4">
            <div className="min-w-0 space-y-2">
              <span className="rounded-pill bg-white/6 px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">
                {isEditing ? 'Edit Group' : 'New Group'}
              </span>
              <h2 id="group-modal-title" className="font-display text-2xl leading-tight text-on-surface sm:text-3xl">
                {isEditing ? group?.name : 'Create Group'}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/8 text-on-surface-variant transition hover:bg-white/12 hover:text-on-surface active:scale-[0.98]"
              aria-label="Close"
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>

          <form
            onSubmit={(event) => {
              event.preventDefault()
              if (name.trim()) saveMutation.mutate()
            }}
            className="px-5 pb-4 sm:px-6"
          >
            <div className="space-y-4">
              <label className="block space-y-1">
                <span className="font-body text-[0.68rem] uppercase tracking-[0.16em] text-on-surface-variant">
                  Name
                </span>
                <input
                  value={name}
                  onChange={(e) => setName(e.target.value)}
                  className="w-full rounded-card bg-surface-dim px-4 py-3 font-body text-sm text-on-surface outline-none ring-1 ring-white/10 transition focus:ring-primary"
                  placeholder="e.g. Work, Errands, Home"
                  autoFocus
                />
              </label>

              <label className="block space-y-1">
                <span className="font-body text-[0.68rem] uppercase tracking-[0.16em] text-on-surface-variant">
                  Description
                </span>
                <textarea
                  value={description}
                  onChange={(e) => setDescription(e.target.value)}
                  rows={3}
                  className="w-full resize-none rounded-card bg-surface-dim px-4 py-3 font-body text-sm text-on-surface outline-none ring-1 ring-white/10 transition focus:ring-primary"
                  placeholder="Optional details about this group."
                />
              </label>
            </div>

            <div className="mt-6">
              <button
                type="submit"
                disabled={!name.trim() || saveMutation.isPending}
                className="flex w-full items-center justify-center gap-2 rounded-pill bg-primary px-4 py-3 font-body text-sm font-semibold text-surface transition hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50"
              >
                {isEditing ? (
                  <Save className="h-4 w-4" strokeWidth={2} />
                ) : (
                  <Plus className="h-4 w-4" strokeWidth={2} />
                )}
                {saveMutation.isPending ? 'Saving...' : 'Save Group'}
              </button>
            </div>
          </form>

          {isEditing && !isSystem ? (
            <div className="border-t border-white/5 bg-[rgba(20,20,20,0.86)] p-5 backdrop-blur-xl sm:px-6">
              <div className="space-y-3">
                <div>
                  <h3 className="font-display text-lg text-error">Delete Group</h3>
                  <p className="mt-1 font-body text-xs text-on-surface-variant">
                    Deleting this group requires moving its existing tasks to another group to prevent accidental data loss.
                  </p>
                </div>
                
                <div className="flex flex-wrap items-center gap-3">
                  <div className="flex-1 min-w-[14rem]">
                    <SelectDropdown
                      label=""
                      placeholder="Move tasks to..."
                      options={deletionOptions.map((candidate) => ({
                        value: candidate.id,
                        label: candidate.name,
                      }))}
                      value={deleteTargetId}
                      onChange={(value) => setDeleteTargetId(String(value))}
                      className="space-y-0"
                      triggerClassName="bg-surface-dim px-4 py-3 font-body text-sm ring-1 ring-white/10 focus:ring-error/50"
                    />
                  </div>
                  <button
                    type="button"
                    onClick={() => deleteMutation.mutate()}
                    disabled={!deleteTargetId || deleteMutation.isPending}
                    className="flex shrink-0 items-center gap-2 rounded-pill bg-error/20 px-4 py-3 font-body text-sm font-semibold text-error transition hover:bg-error/30 active:scale-[0.98] disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" strokeWidth={2} />
                    {deleteMutation.isPending ? 'Deleting...' : 'Delete'}
                  </button>
                </div>
              </div>
            </div>
          ) : null}
        </div>
      </div>
    </div>
  )
}
