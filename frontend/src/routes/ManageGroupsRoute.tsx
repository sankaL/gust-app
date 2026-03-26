import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'

import { SessionGuard } from '../components/SessionGuard'
import { SelectDropdown } from '../components/SelectDropdown'
import {
  ApiError,
  createGroup,
  deleteGroup,
  getSessionStatus,
  listGroups,
  updateGroup
} from '../lib/api'

function buildFriendlyMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message
  }

  return fallback
}

export function ManageGroupsRoute() {
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupDescription, setNewGroupDescription] = useState('')
  const [drafts, setDrafts] = useState<Record<string, { name: string; description: string }>>({})
  const [deleteTargets, setDeleteTargets] = useState<Record<string, string>>({})
  const [feedback, setFeedback] = useState<{ message: string; type: 'success' | 'error' } | null>(null)
  const [showAddGroupModal, setShowAddGroupModal] = useState(false)

  const sessionQuery = useQuery({
    queryKey: ['session-status'],
    queryFn: getSessionStatus
  })

  const groupsQuery = useQuery({
    queryKey: ['groups'],
    queryFn: listGroups,
    enabled: sessionQuery.data?.signed_in === true
  })

  function requireCsrf() {
    const csrfToken = sessionQuery.data?.csrf_token
    if (!csrfToken) {
      throw new ApiError('Your session is missing a CSRF token.', 'csrf_missing', 403)
    }
    return csrfToken
  }

  async function refreshGroups() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['groups'] }),
      queryClient.invalidateQueries({ queryKey: ['tasks'] }),
      queryClient.invalidateQueries({ queryKey: ['task-detail'] })
    ])
  }

  const createGroupMutation = useMutation({
    mutationFn: async () => {
      const csrfToken = requireCsrf()
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
      setFeedback({ message: 'Group created.', type: 'success' })
      void refreshGroups()
    },
    onError: (error) => {
      setFeedback({ message: buildFriendlyMessage(error, 'Group could not be created.'), type: 'error' })
    }
  })

  const updateGroupMutation = useMutation({
    mutationFn: async (groupId: string) => {
      const csrfToken = requireCsrf()
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
      setFeedback({ message: 'Group updated.', type: 'success' })
      void refreshGroups()
    },
    onError: (error) => {
      setFeedback({ message: buildFriendlyMessage(error, 'Group could not be updated.'), type: 'error' })
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
      const csrfToken = requireCsrf()
      return deleteGroup(groupId, destinationGroupId, csrfToken)
    },
    onSuccess: () => {
      setFeedback({ message: 'Group deleted.', type: 'success' })
      void refreshGroups()
    },
    onError: (error) => {
      setFeedback({ message: buildFriendlyMessage(error, 'Group could not be deleted.'), type: 'error' })
    }
  })

  const activeGroupSearch = searchParams.get('group') ? `?group=${searchParams.get('group')}` : ''

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
        <div className="flex items-center justify-between">
          <h2 className="font-display text-2xl text-on-surface">Manage Groups</h2>
          <Link
            to={`/tasks${activeGroupSearch}`}
            className="inline-flex items-center gap-2 rounded-pill bg-primary/20 px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/30"
          >
            &larr; Back to Tasks
          </Link>
        </div>

        {feedback ? (
          <div className={`flex items-start gap-3 rounded-card border p-4 shadow-ambient ${
            feedback.type === 'success'
              ? 'bg-primary/10 border-primary/20 text-primary'
              : 'bg-error/10 border-error/20 text-error'
          }`}>
            <svg className="w-5 h-5 shrink-0 mt-0.5" fill="none" viewBox="0 0 24 24" stroke="currentColor">
              {feedback.type === 'success' ? (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M5 13l4 4L19 7" />
              ) : (
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z" />
              )}
            </svg>
            <p className="font-body text-sm font-medium leading-relaxed">{feedback.message}</p>
          </div>
        ) : null}

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
          {groupsQuery.data?.map((group) => {
            const draft = drafts[group.id] ?? {
              name: group.name,
              description: group.description ?? ''
            }
            const deletionOptions = (groupsQuery.data ?? []).filter(
              (candidate) => candidate.id !== group.id
            )
            const isEditing = drafts[group.id] !== undefined

            return (
              <section key={group.id} className="rounded-card bg-surface-container-high border border-white/5 p-4 flex flex-col gap-4">
                <div className="flex items-start justify-between gap-4">
                  {/* Left Column: Title & Metadata */}
                  <div className="flex-1 min-w-0">
                    <h3 className="font-display text-lg font-medium text-on-surface truncate leading-tight">
                      {group.name}
                    </h3>
                    {group.description && (
                      <p className="font-body text-xs text-on-surface-variant line-clamp-2 mt-1">
                        {group.description}
                      </p>
                    )}
                  </div>

                  {/* Right Column: Badges & Actions */}
                  <div className="flex flex-col items-end gap-2 shrink-0">
                    <div className="flex items-center gap-2">
                      <span className="font-body text-[0.65rem] uppercase tracking-widest px-2 py-0.5 rounded-pill bg-surface-dim text-on-surface-variant">
                        {group.open_task_count > 0 ? `${group.open_task_count} TASKS` : '0 TASKS'}
                      </span>
                      {group.is_system && (
                        <span className="font-body text-[0.65rem] uppercase tracking-widest px-2 py-0.5 rounded-pill bg-primary/20 text-primary">
                          LOCKED
                        </span>
                      )}
                    </div>

                    {!group.is_system && (
                      <button
                        type="button"
                        onClick={() => {
                          if (isEditing) {
                            setDrafts((current) => {
                              const { [group.id]: _, ...rest } = current
                              return rest
                            })
                          } else {
                            setDrafts({
                              ...drafts,
                              [group.id]: {
                                name: group.name,
                                description: group.description ?? ''
                              }
                            })
                          }
                        }}
                        className="rounded-pill bg-surface-dim px-3 py-1 font-body text-[0.65rem] font-bold uppercase tracking-widest text-on-surface shadow-[0_4px_12px_rgba(0,0,0,0.5),_inset_0_2px_4px_rgba(255,255,255,0.1)] hover:-translate-y-0.5 transition-all active:scale-95 mt-1"
                        aria-label={isEditing ? 'Cancel editing' : 'Edit group'}
                      >
                        {isEditing ? 'Cancel' : 'Edit'}
                      </button>
                    )}
                  </div>
                </div>

                  {isEditing ? (
                    <>
                      <div className="grid gap-3 pt-4 border-t border-white/5">
                        <input
                          value={draft.name}
                          onChange={(event) =>
                            setDrafts({
                              ...drafts,
                              [group.id]: {
                                ...draft,
                                name: event.target.value
                              }
                            })
                          }
                          className="w-full rounded-card bg-surface-dim px-3 py-3 text-on-surface outline-none focus:ring-1 focus:ring-primary placeholder:text-on-surface-variant/40 transition-all"
                          placeholder="Group name"
                        />
                        <textarea
                          value={draft.description}
                          onChange={(event) =>
                            setDrafts({
                              ...drafts,
                              [group.id]: {
                                ...draft,
                                description: event.target.value
                              }
                            })
                          }
                          rows={3}
                          className="w-full rounded-card bg-surface-dim px-3 py-3 text-on-surface outline-none focus:ring-1 focus:ring-primary placeholder:text-on-surface-variant/40 transition-all"
                          placeholder="Group description"
                        />
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={() => updateGroupMutation.mutate(group.id)}
                          className="rounded-pill bg-primary px-4 py-2 text-sm font-medium text-surface"
                        >
                          Save Group
                        </button>
                        <button
                          type="button"
                          onClick={() => {
                            setDrafts((current) => {
                              const { [group.id]: _, ...rest } = current
                              return rest
                            })
                          }}
                          className="rounded-pill border border-outline/30 px-4 py-2 text-sm text-on-surface-variant"
                        >
                          Cancel
                        </button>
                      </div>

                      <div className="rounded-card bg-surface-dim p-4">
                        <div className="space-y-4">
                          <p className="font-body text-[0.65rem] font-bold uppercase tracking-widest text-error">
                            Danger Zone
                          </p>
                          <SelectDropdown
                            label=""
                            value={deleteTargets[group.id] ?? ''}
                            onChange={(val) => 
                              setDeleteTargets({
                                ...deleteTargets,
                                [group.id]: String(val)
                              })
                            }
                            placeholder="Move all tasks to..."
                            options={deletionOptions.map(c => ({ value: c.id, label: c.name }))}
                          />
                          <button
                            type="button"
                            onClick={() => deleteGroupMutation.mutate(group.id)}
                            className="rounded-pill bg-error/20 px-4 py-2 text-sm text-error font-medium w-full shadow-[0_4px_12px_rgba(0,0,0,0.5)] hover:-translate-y-0.5 transition-all active:scale-95"
                          >
                            Delete Group & Reassign Tasks
                          </button>
                        </div>
                      </div>
                    </>
                  ) : null}
              </section>
            )
          })}
        </div>
      </section>
    </SessionGuard>
  )
}
