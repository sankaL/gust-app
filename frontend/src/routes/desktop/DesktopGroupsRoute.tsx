import { useState } from 'react'
import { useMutation, useQueryClient } from '@tanstack/react-query'
import { Link, useOutletContext } from 'react-router-dom'

import type { DesktopOutletContext } from '../../components/DesktopShell'
import { useNotifications } from '../../components/Notifications'
import { ApiError, createGroup, deleteGroup, updateGroup } from '../../lib/api'
import { refreshTaskScreenQueries } from '../../lib/taskScreenCache'

function buildFriendlyMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message
  }
  return fallback
}

export function DesktopGroupsRoute() {
  const { session, groups, isGroupsLoading } = useOutletContext<DesktopOutletContext>()
  const queryClient = useQueryClient()
  const { notifyError, notifySuccess } = useNotifications()
  const [newGroupName, setNewGroupName] = useState('')
  const [newGroupDescription, setNewGroupDescription] = useState('')
  const [drafts, setDrafts] = useState<Record<string, { name: string; description: string }>>({})
  const [deleteTargets, setDeleteTargets] = useState<Record<string, string>>({})

  function requireCsrf() {
    const csrfToken = session.csrf_token
    if (!csrfToken) {
      throw new ApiError('Your session is missing a CSRF token.', 'csrf_missing', 403)
    }
    return csrfToken
  }

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

  const createMutation = useMutation({
    mutationFn: () =>
      createGroup(
        {
          name: newGroupName.trim(),
          description: newGroupDescription.trim() || null,
        },
        requireCsrf()
      ),
    onSuccess: () => {
      setNewGroupName('')
      setNewGroupDescription('')
      notifySuccess('Group created.')
      void refreshGroups()
    },
    onError: (error) => notifyError(buildFriendlyMessage(error, 'Group could not be created.')),
  })

  const updateMutation = useMutation({
    mutationFn: (groupId: string) => {
      const draft = drafts[groupId]
      return updateGroup(
        groupId,
        {
          name: draft?.name.trim(),
          description: draft?.description.trim() || null,
        },
        requireCsrf()
      )
    },
    onSuccess: (_group, groupId) => {
      setDrafts((current) => {
        const next = { ...current }
        delete next[groupId]
        return next
      })
      notifySuccess('Group updated.')
      void refreshGroups()
    },
    onError: (error) => notifyError(buildFriendlyMessage(error, 'Group could not be updated.')),
  })

  const deleteMutation = useMutation({
    mutationFn: (groupId: string) => {
      const destinationGroupId = deleteTargets[groupId]
      if (!destinationGroupId) {
        throw new ApiError('Choose a destination group before deleting.', 'invalid_group', 422)
      }
      return deleteGroup(groupId, destinationGroupId, requireCsrf())
    },
    onSuccess: () => {
      notifySuccess('Group deleted.')
      void refreshGroups()
    },
    onError: (error) => notifyError(buildFriendlyMessage(error, 'Group could not be deleted.')),
  })

  if (isGroupsLoading) {
    return <div className="h-96 animate-pulse rounded-soft bg-surface-container" aria-busy="true" />
  }

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <p className="font-body text-[0.68rem] uppercase tracking-[0.18em] text-primary">
            Workflow structure
          </p>
          <h1 className="mt-1 font-display text-4xl tracking-tight text-on-surface">
            Group Configuration
          </h1>
          <p className="mt-2 font-body text-sm text-on-surface-variant">
            Create, rename, describe, and safely delete groups without breaking Inbox protections.
          </p>
        </div>
        <Link
          to="/desktop/tasks"
          className="rounded-pill bg-surface-container px-4 py-2 font-body text-sm font-semibold text-on-surface-variant transition hover:bg-surface-container-high hover:text-on-surface"
        >
          View All Tasks
        </Link>
      </div>

      <section className="grid grid-cols-[minmax(18rem,0.35fr)_minmax(0,0.65fr)] gap-5 max-xl:grid-cols-1">
        <form
          className="space-y-4 rounded-soft bg-surface-container p-5 shadow-ambient"
          onSubmit={(event) => {
            event.preventDefault()
            if (newGroupName.trim()) {
              createMutation.mutate()
            }
          }}
        >
          <h2 className="font-display text-2xl text-on-surface">Add Group</h2>
          <label className="block space-y-1">
            <span className="font-body text-[0.68rem] uppercase tracking-[0.16em] text-on-surface-variant">
              Name
            </span>
            <input
              value={newGroupName}
              onChange={(event) => setNewGroupName(event.target.value)}
              className="w-full rounded-card bg-surface-dim px-3 py-2 font-body text-sm text-on-surface outline-none ring-1 ring-white/10 transition focus:ring-primary"
            />
          </label>
          <label className="block space-y-1">
            <span className="font-body text-[0.68rem] uppercase tracking-[0.16em] text-on-surface-variant">
              Description
            </span>
            <textarea
              value={newGroupDescription}
              onChange={(event) => setNewGroupDescription(event.target.value)}
              rows={4}
              className="w-full resize-none rounded-card bg-surface-dim px-3 py-2 font-body text-sm text-on-surface outline-none ring-1 ring-white/10 transition focus:ring-primary"
            />
          </label>
          <button
            type="submit"
            disabled={!newGroupName.trim() || createMutation.isPending}
            className="w-full rounded-pill bg-primary px-4 py-2.5 font-body text-sm font-semibold text-surface transition hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50"
          >
            {createMutation.isPending ? 'Creating' : 'Create Group'}
          </button>
        </form>

        <div className="space-y-3">
          {groups.map((group) => {
            const draft = drafts[group.id] ?? {
              name: group.name,
              description: group.description ?? '',
            }
            const isEditing = drafts[group.id] !== undefined
            const deletionOptions = groups.filter((candidate) => candidate.id !== group.id)

            return (
              <article key={group.id} className="rounded-soft bg-surface-container p-4 shadow-ambient">
                <div className="flex flex-wrap items-start justify-between gap-4">
                  <div className="min-w-0 flex-1">
                    {isEditing ? (
                      <div className="grid grid-cols-2 gap-3 max-lg:grid-cols-1">
                        <label className="space-y-1">
                          <span className="font-body text-[0.68rem] uppercase tracking-[0.16em] text-on-surface-variant">
                            Name
                          </span>
                          <input
                            value={draft.name}
                            onChange={(event) =>
                              setDrafts((current) => ({
                                ...current,
                                [group.id]: { ...draft, name: event.target.value },
                              }))
                            }
                            className="w-full rounded-card bg-surface-dim px-3 py-2 font-body text-sm text-on-surface outline-none ring-1 ring-white/10 transition focus:ring-primary"
                          />
                        </label>
                        <label className="space-y-1">
                          <span className="font-body text-[0.68rem] uppercase tracking-[0.16em] text-on-surface-variant">
                            Description
                          </span>
                          <input
                            value={draft.description}
                            onChange={(event) =>
                              setDrafts((current) => ({
                                ...current,
                                [group.id]: { ...draft, description: event.target.value },
                              }))
                            }
                            className="w-full rounded-card bg-surface-dim px-3 py-2 font-body text-sm text-on-surface outline-none ring-1 ring-white/10 transition focus:ring-primary"
                          />
                        </label>
                      </div>
                    ) : (
                      <>
                        <div className="flex flex-wrap items-center gap-2">
                          <h2 className="truncate font-display text-2xl text-on-surface">
                            {group.name}
                          </h2>
                          {group.is_system ? (
                            <span className="rounded-pill bg-surface-dim px-2 py-1 font-body text-[0.68rem] uppercase tracking-[0.12em] text-on-surface-variant">
                              System
                            </span>
                          ) : null}
                        </div>
                        <p className="mt-2 font-body text-sm leading-6 text-on-surface-variant">
                          {group.description || 'No description yet.'}
                        </p>
                      </>
                    )}
                  </div>

                  <div className="flex flex-wrap items-center gap-2">
                    <Link
                      to={`/desktop/groups/${group.id}`}
                      className="rounded-pill bg-surface-dim px-3 py-1.5 font-body text-xs font-semibold text-on-surface-variant transition hover:bg-surface-container-highest hover:text-on-surface"
                    >
                      Open
                    </Link>
                    {!group.is_system ? (
                      <button
                        type="button"
                        onClick={() =>
                          isEditing
                            ? setDrafts((current) => {
                                const next = { ...current }
                                delete next[group.id]
                                return next
                              })
                            : setDrafts((current) => ({
                                ...current,
                                [group.id]: {
                                  name: group.name,
                                  description: group.description ?? '',
                                },
                              }))
                        }
                        className="rounded-pill bg-surface-dim px-3 py-1.5 font-body text-xs font-semibold text-on-surface-variant transition hover:bg-surface-container-highest hover:text-on-surface"
                      >
                        {isEditing ? 'Cancel' : 'Edit'}
                      </button>
                    ) : null}
                    {isEditing ? (
                      <button
                        type="button"
                        onClick={() => updateMutation.mutate(group.id)}
                        disabled={!draft.name.trim() || updateMutation.isPending}
                        className="rounded-pill bg-primary px-3 py-1.5 font-body text-xs font-semibold text-surface transition hover:-translate-y-0.5 active:translate-y-0 disabled:opacity-50"
                      >
                        Save
                      </button>
                    ) : null}
                  </div>
                </div>

                <div className="mt-4 flex flex-wrap items-center justify-between gap-3 rounded-card bg-surface-dim p-3">
                  <span className="font-body text-sm text-on-surface-variant">
                    {group.open_task_count} open tasks
                  </span>
                  {!group.is_system ? (
                    <div className="flex flex-wrap items-center gap-2">
                      <select
                        value={deleteTargets[group.id] ?? ''}
                        onChange={(event) =>
                          setDeleteTargets((current) => ({
                            ...current,
                            [group.id]: event.target.value,
                          }))
                        }
                        className="rounded-card bg-surface-container px-3 py-2 font-body text-sm text-on-surface outline-none ring-1 ring-white/10 transition focus:ring-primary"
                      >
                        <option value="">Move tasks to...</option>
                        {deletionOptions.map((candidate) => (
                          <option key={candidate.id} value={candidate.id}>
                            {candidate.name}
                          </option>
                        ))}
                      </select>
                      <button
                        type="button"
                        onClick={() => deleteMutation.mutate(group.id)}
                        disabled={!deleteTargets[group.id] || deleteMutation.isPending}
                        className="rounded-pill bg-error/20 px-3 py-2 font-body text-xs font-semibold text-error transition hover:bg-error/30 active:scale-[0.98] disabled:opacity-50"
                      >
                        Delete
                      </button>
                    </div>
                  ) : null}
                </div>
              </article>
            )
          })}
        </div>
      </section>
    </section>
  )
}
