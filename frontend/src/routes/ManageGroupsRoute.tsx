import { useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useSearchParams } from 'react-router-dom'

import { SessionGuard } from '../components/SessionGuard'
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
          <div className="space-y-2">
            <p className="font-body text-xs uppercase tracking-[0.15em] text-on-surface-variant">
              Task organization
            </p>
            <h2 className="font-display text-2xl text-on-surface">Manage Groups</h2>
          </div>
          <Link
            to={`/tasks${activeGroupSearch}`}
            className="inline-flex items-center gap-2 rounded-pill bg-primary/20 px-4 py-2 text-sm font-medium text-primary transition-colors hover:bg-primary/30"
          >
            <svg className="h-4 w-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10 19l-7-7m0 0l7-7m-7 7h18" />
            </svg>
            Back to Tasks
          </Link>
        </div>

        {feedback ? (
          <p className={`rounded-card border px-4 py-3 font-body text-sm ${
            feedback.type === 'success'
              ? 'border-green-500/30 bg-green-500/10 text-green-400'
              : 'border-red-500/30 bg-red-500/10 text-red-400'
          }`}>
            {feedback.message}
          </p>
        ) : null}

        <button
          type="button"
          onClick={() => setShowAddGroupModal(true)}
          className="flex w-full items-center justify-center gap-2 rounded-soft bg-primary p-4 text-surface shadow-ambient transition-all duration-200 hover:bg-primary/90 hover:shadow-lg active:scale-[0.98]"
        >
          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          <span className="font-body text-sm font-medium">Add Group</span>
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
                    <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                  </button>
                </div>
                <input
                  value={newGroupName}
                  onChange={(event) => setNewGroupName(event.target.value)}
                  placeholder="Group name"
                  className="w-full rounded-card border border-outline/20 bg-surface-dim px-3 py-3 text-on-surface outline-none focus:border-primary"
                />
                <textarea
                  value={newGroupDescription}
                  onChange={(event) => setNewGroupDescription(event.target.value)}
                  placeholder="Optional description for AI routing"
                  rows={3}
                  className="w-full rounded-card border border-outline/20 bg-surface-dim px-3 py-3 text-on-surface outline-none focus:border-primary"
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
              <section key={group.id} className="rounded-soft bg-surface-container p-4 shadow-ambient">
                <div className="space-y-3">
                  <div className="flex items-center justify-between gap-3">
                    <div className="flex-1">
                      <div className="flex items-center gap-2">
                        <p className="font-display text-xl text-on-surface">{group.name}</p>
                        {group.is_system ? (
                          <span className="rounded-pill bg-primary/20 px-2 py-1 text-xs uppercase tracking-[0.1em] text-primary">
                            Locked Inbox
                          </span>
                        ) : null}
                      </div>
                      <p className="mt-1 font-body text-xs text-on-surface-variant">
                        {group.open_task_count} open tasks
                      </p>
                    </div>
                    {!group.is_system ? (
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
                        className="rounded-full bg-surface-container-high p-2 text-on-surface-variant transition-colors hover:bg-surface-container-highest"
                        aria-label={isEditing ? 'Cancel editing' : 'Edit group'}
                      >
                        {isEditing ? (
                          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                          </svg>
                        ) : (
                          <svg className="h-5 w-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z" />
                          </svg>
                        )}
                      </button>
                    ) : null}
                  </div>

                  {isEditing ? (
                    <>
                      <div className="grid gap-3">
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
                          className="w-full rounded-card border border-outline/20 bg-surface-dim px-3 py-3 text-on-surface outline-none focus:border-primary"
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
                          className="w-full rounded-card border border-outline/20 bg-surface-dim px-3 py-3 text-on-surface outline-none focus:border-primary"
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

                      <div className="rounded-card bg-surface-dim p-3">
                        <div className="space-y-2">
                          <p className="font-body text-xs uppercase tracking-[0.1em] text-on-surface-variant">
                            Delete group
                          </p>
                          <select
                            value={deleteTargets[group.id] ?? ''}
                            onChange={(event) =>
                              setDeleteTargets({
                                ...deleteTargets,
                                [group.id]: event.target.value
                              })
                            }
                            className="w-full rounded-card border border-outline/20 bg-surface-container px-3 py-3 text-on-surface outline-none focus:border-primary"
                          >
                            <option value="">Choose destination group</option>
                            {deletionOptions.map((candidate) => (
                              <option key={candidate.id} value={candidate.id}>
                                {candidate.name}
                              </option>
                            ))}
                          </select>
                          <button
                            type="button"
                            onClick={() => deleteGroupMutation.mutate(group.id)}
                            className="rounded-pill border border-outline/30 px-4 py-2 text-sm text-on-surface-variant"
                          >
                            Delete and Reassign
                          </button>
                        </div>
                      </div>
                    </>
                  ) : null}
                </div>
              </section>
            )
          })}
        </div>
      </section>
    </SessionGuard>
  )
}
