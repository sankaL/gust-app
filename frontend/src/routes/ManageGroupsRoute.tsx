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
  const [feedback, setFeedback] = useState<string | null>(null)

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
      setFeedback('Group created.')
      void refreshGroups()
    },
    onError: (error) => {
      setFeedback(buildFriendlyMessage(error, 'Group could not be created.'))
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
      setFeedback('Group updated.')
      void refreshGroups()
    },
    onError: (error) => {
      setFeedback(buildFriendlyMessage(error, 'Group could not be updated.'))
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
      setFeedback('Group deleted.')
      void refreshGroups()
    },
    onError: (error) => {
      setFeedback(buildFriendlyMessage(error, 'Group could not be deleted.'))
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
      <section className="space-y-6">
        <div className="flex items-center justify-between">
          <div className="space-y-3">
            <p className="font-body text-sm uppercase tracking-[0.25em] text-on-surface-variant">
              Task organization
            </p>
            <h2 className="font-display text-3xl text-on-surface">Manage Groups</h2>
            <p className="max-w-sm font-body text-base leading-7 text-on-surface-variant">
              Create specialized destinations for capture routing and manual task cleanup.
            </p>
          </div>
          <Link
            to={`/tasks${activeGroupSearch}`}
            className="rounded-pill bg-surface-container px-4 py-3 text-sm text-on-surface"
          >
            Back to Tasks
          </Link>
        </div>

        {feedback ? (
          <p className="rounded-card border border-primary/20 bg-primary/10 px-4 py-3 font-body text-sm text-on-surface">
            {feedback}
          </p>
        ) : null}

        <div className="rounded-soft bg-surface-container p-6 shadow-ambient">
          <div className="space-y-4">
            <p className="font-display text-2xl text-on-surface">Add a new group</p>
            <input
              value={newGroupName}
              onChange={(event) => setNewGroupName(event.target.value)}
              placeholder="Group name"
              className="w-full rounded-card border border-outline/20 bg-surface-dim px-4 py-4 text-on-surface outline-none focus:border-primary"
            />
            <textarea
              value={newGroupDescription}
              onChange={(event) => setNewGroupDescription(event.target.value)}
              placeholder="Optional description for AI routing"
              rows={3}
              className="w-full rounded-card border border-outline/20 bg-surface-dim px-4 py-4 text-on-surface outline-none focus:border-primary"
            />
            <button
              type="button"
              onClick={() => createGroupMutation.mutate()}
              disabled={!newGroupName.trim()}
              className="rounded-pill bg-primary px-5 py-3 text-sm font-medium text-surface disabled:opacity-50"
            >
              Create Group
            </button>
          </div>
        </div>

        <div className="space-y-4">
          {groupsQuery.data?.map((group) => {
            const draft = drafts[group.id] ?? {
              name: group.name,
              description: group.description ?? ''
            }
            const deletionOptions = (groupsQuery.data ?? []).filter(
              (candidate) => candidate.id !== group.id
            )

            return (
              <section key={group.id} className="rounded-soft bg-surface-container p-6 shadow-ambient">
                <div className="space-y-4">
                  <div className="flex items-center justify-between gap-4">
                    <div>
                      <p className="font-display text-2xl text-on-surface">{group.name}</p>
                      <p className="mt-2 font-body text-sm text-on-surface-variant">
                        {group.open_task_count} open tasks
                      </p>
                    </div>
                    {group.is_system ? (
                      <span className="rounded-pill bg-primary/20 px-3 py-2 text-xs uppercase tracking-[0.18em] text-primary">
                        Locked Inbox
                      </span>
                    ) : null}
                  </div>

                  <div className="grid gap-4">
                    <input
                      value={draft.name}
                      disabled={group.is_system}
                      onChange={(event) =>
                        setDrafts({
                          ...drafts,
                          [group.id]: {
                            ...draft,
                            name: event.target.value
                          }
                        })
                      }
                      className="w-full rounded-card border border-outline/20 bg-surface-dim px-4 py-4 text-on-surface outline-none focus:border-primary disabled:opacity-50"
                    />
                    <textarea
                      value={draft.description}
                      disabled={group.is_system}
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
                      className="w-full rounded-card border border-outline/20 bg-surface-dim px-4 py-4 text-on-surface outline-none focus:border-primary disabled:opacity-50"
                    />
                  </div>

                  <div className="flex flex-wrap gap-3">
                    <button
                      type="button"
                      disabled={group.is_system}
                      onClick={() => updateGroupMutation.mutate(group.id)}
                      className="rounded-pill bg-primary px-5 py-3 text-sm font-medium text-surface disabled:opacity-50"
                    >
                      Save Group
                    </button>
                  </div>

                  {!group.is_system ? (
                    <div className="rounded-card bg-surface-dim p-4">
                      <div className="space-y-3">
                        <p className="font-body text-xs uppercase tracking-[0.18em] text-on-surface-variant">
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
                          className="w-full rounded-card border border-outline/20 bg-surface-container px-4 py-4 text-on-surface outline-none focus:border-primary"
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
                          className="rounded-pill border border-outline/30 px-5 py-3 text-sm text-on-surface-variant"
                        >
                          Delete and Reassign
                        </button>
                      </div>
                    </div>
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
