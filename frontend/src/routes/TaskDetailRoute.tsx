import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { SessionGuard } from '../components/SessionGuard'
import { SelectDropdown } from '../components/SelectDropdown'
import {
  ApiError,
  createSubtask,
  deleteSubtask,
  deleteTask,
  getSessionStatus,
  getTaskDetail,
  listGroups,
  restoreTask,
  updateSubtask,
  updateTask,
  type TaskDeleteScope,
  type TaskRecurrence
} from '../lib/api'

type DraftState = {
  title: string
  groupId: string
  dueDate: string
  reminderAt: string
  recurrence: TaskRecurrence | null
}

type SubtaskDetail = Awaited<ReturnType<typeof getTaskDetail>>['subtasks'][number]

function buildFriendlyMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message
  }

  return fallback
}

function toDateTimeLocalValue(value: string | null) {
  if (!value) {
    return ''
  }

  const date = new Date(value)
  const local = new Date(date.getTime() - date.getTimezoneOffset() * 60000)
  return local.toISOString().slice(0, 16)
}

function recurrenceForDueDate(
  frequency: 'daily' | 'weekly' | 'monthly',
  dueDate: string,
  current: TaskRecurrence | null
): TaskRecurrence {
  if (frequency === 'daily') {
    return { frequency, weekday: null, day_of_month: null }
  }

  if (!dueDate) {
    return current ?? { frequency, weekday: null, day_of_month: null }
  }

  const localDate = new Date(`${dueDate}T12:00:00`)
  if (frequency === 'weekly') {
    return { frequency, weekday: localDate.getDay(), day_of_month: null }
  }

  return {
    frequency,
    weekday: null,
    day_of_month: Number(dueDate.split('-')[2] ?? current?.day_of_month ?? 1)
  }
}

function buildDraftState(task: Awaited<ReturnType<typeof getTaskDetail>>): DraftState {
  return {
    title: task.title,
    groupId: task.group.id,
    dueDate: task.due_date ?? '',
    reminderAt: toDateTimeLocalValue(task.reminder_at),
    recurrence: task.recurrence
  }
}

function mergeSubtaskDrafts(
  current: Record<string, string>,
  subtasks: SubtaskDetail[]
): Record<string, string> {
  return Object.fromEntries(
    subtasks.map((subtask) => [subtask.id, current[subtask.id] ?? subtask.title])
  )
}

export function TaskDetailRoute() {
  const { taskId } = useParams()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const [draft, setDraft] = useState<DraftState | null>(null)
  const [newSubtaskTitle, setNewSubtaskTitle] = useState('')
  const [subtaskDrafts, setSubtaskDrafts] = useState<Record<string, string>>({})
  const [feedback, setFeedback] = useState<string | null>(null)
  const [isEditMode, setIsEditMode] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<{ scope: TaskDeleteScope } | null>(null)
  const [showUndoToast, setShowUndoToast] = useState(false)
  const [deletedTaskTitle, setDeletedTaskTitle] = useState<string | null>(null)

  const sessionQuery = useQuery({
    queryKey: ['session-status'],
    queryFn: getSessionStatus
  })

  const groupsQuery = useQuery({
    queryKey: ['groups'],
    queryFn: listGroups,
    enabled: sessionQuery.data?.signed_in === true
  })

  const taskQuery = useQuery({
    queryKey: ['task-detail', taskId],
    queryFn: () => getTaskDetail(taskId as string),
    enabled: sessionQuery.data?.signed_in === true && Boolean(taskId)
  })

  useEffect(() => {
    setDraft(null)
    setSubtaskDrafts({})
  }, [taskId])

  useEffect(() => {
    if (!taskQuery.data) {
      return
    }

    setDraft((current) => current ?? buildDraftState(taskQuery.data))
    setSubtaskDrafts((current) => mergeSubtaskDrafts(current, taskQuery.data.subtasks))
    // Set edit mode based on needs_review flag
    setIsEditMode(taskQuery.data.needs_review)
  }, [taskQuery.data])

  function requireCsrf() {
    const csrfToken = sessionQuery.data?.csrf_token
    if (!csrfToken) {
      throw new ApiError('Your session is missing a CSRF token.', 'csrf_missing', 403)
    }
    return csrfToken
  }

  async function refreshTaskData() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['tasks'] }),
      queryClient.invalidateQueries({ queryKey: ['groups'] }),
      queryClient.invalidateQueries({ queryKey: ['task-detail', taskId] })
    ])
  }

  const saveTaskMutation = useMutation({
    mutationFn: async () => {
      if (!taskId || !draft) {
        throw new Error('Task detail is not ready.')
      }

      const csrfToken = requireCsrf()
      return updateTask(
        taskId,
        {
          title: draft.title,
          group_id: draft.groupId,
          due_date: draft.dueDate || null,
          reminder_at: draft.reminderAt ? new Date(draft.reminderAt).toISOString() : null,
          recurrence: draft.recurrence
        },
        csrfToken
      )
    },
    onSuccess: (task) => {
      setFeedback('Task saved.')
      setDraft(buildDraftState(task))
      void refreshTaskData()
    },
    onError: (error) => {
      setFeedback(buildFriendlyMessage(error, 'Task changes could not be saved.'))
    }
  })

  const createSubtaskMutation = useMutation({
    mutationFn: async () => {
      if (!taskId) {
        throw new Error('Task detail is not ready.')
      }
      const csrfToken = requireCsrf()
      return createSubtask(taskId, newSubtaskTitle, csrfToken)
    },
    onSuccess: () => {
      setNewSubtaskTitle('')
      setFeedback('Subtask added.')
      void refreshTaskData()
    },
    onError: (error) => {
      setFeedback(buildFriendlyMessage(error, 'Subtask could not be added.'))
    }
  })

  const updateSubtaskMutation = useMutation({
    mutationFn: async (payload: { subtaskId: string; title?: string; is_completed?: boolean }) => {
      if (!taskId) {
        throw new Error('Task detail is not ready.')
      }
      const csrfToken = requireCsrf()
      return updateSubtask(taskId, payload.subtaskId, payload, csrfToken)
    },
    onSuccess: () => {
      setFeedback('Subtask updated.')
      void refreshTaskData()
    },
    onError: (error) => {
      setFeedback(buildFriendlyMessage(error, 'Subtask could not be updated.'))
    }
  })

  const deleteSubtaskMutation = useMutation({
    mutationFn: async (subtaskId: string) => {
      if (!taskId) {
        throw new Error('Task detail is not ready.')
      }
      const csrfToken = requireCsrf()
      return deleteSubtask(taskId, subtaskId, csrfToken)
    },
    onSuccess: () => {
      setFeedback('Subtask deleted.')
      void refreshTaskData()
    },
    onError: (error) => {
      setFeedback(buildFriendlyMessage(error, 'Subtask could not be deleted.'))
    }
  })

  const deleteTaskMutation = useMutation({
    mutationFn: async (scope: TaskDeleteScope) => {
      if (!taskId) {
        throw new Error('Task detail is not ready.')
      }
      const csrfToken = requireCsrf()
      return deleteTask(taskId, csrfToken, scope)
    },
    onSuccess: () => {
      setPendingDelete(null)
      setDeletedTaskTitle(taskQuery.data?.title ?? null)
      setShowUndoToast(true)
      // Navigate after a delay to allow undo
      setTimeout(() => {
        setShowUndoToast(false)
        void refreshTaskData()
        void navigate(`/tasks${backSearch}`)
      }, 5000)
    },
    onError: (error) => {
      setFeedback(buildFriendlyMessage(error, 'Task could not be deleted.'))
      setPendingDelete(null)
    }
  })

  const restoreTaskMutation = useMutation({
    mutationFn: async () => {
      if (!taskId) {
        throw new Error('Task detail is not ready.')
      }
      const csrfToken = requireCsrf()
      return restoreTask(taskId, csrfToken)
    },
    onSuccess: () => {
      setShowUndoToast(false)
      setDeletedTaskTitle(null)
      setFeedback('Task restored.')
      void refreshTaskData()
    },
    onError: (error) => {
      setFeedback(buildFriendlyMessage(error, 'Task could not be restored.'))
    }
  })

  function handleDeleteTask() {
    const task = taskQuery.data
    if (!task) return
    // Show confirmation dialog - modal handles recurring vs single task UI
    setPendingDelete({ scope: 'occurrence' })
  }

  const isBusy =
    saveTaskMutation.isPending ||
    createSubtaskMutation.isPending ||
    updateSubtaskMutation.isPending ||
    deleteSubtaskMutation.isPending ||
    deleteTaskMutation.isPending ||
    restoreTaskMutation.isPending

  const backSearch = searchParams.get('group') ? `?group=${searchParams.get('group')}` : ''

  return (
    <SessionGuard
      session={sessionQuery.data}
      isLoading={sessionQuery.isLoading}
      isError={sessionQuery.isError}
      title="Task Detail"
      eyebrow="Focused editing"
      description="Refine the title, group, dates, reminders, and subtasks for a single task."
    >
      <section className="space-y-4">
        <div className="flex items-center justify-between">
          <Link
            to={`/tasks${backSearch}`}
            className="rounded-pill bg-surface-container px-3 py-2 text-sm text-on-surface"
          >
            Back to Tasks
          </Link>
          <button
            type="button"
            onClick={() => {
              void navigate(`/tasks${backSearch}`)
            }}
            className="rounded-pill border border-outline/30 px-3 py-2 text-sm text-on-surface-variant"
          >
            Close
          </button>
        </div>

        {feedback ? (
          <p className="rounded-card border border-primary/20 bg-primary/10 px-4 py-3 font-body text-sm text-on-surface">
            {feedback}
          </p>
        ) : null}

        {taskQuery.isLoading || !draft || !taskQuery.data ? (
          <div className="rounded-card bg-surface-container p-6 text-sm text-on-surface-variant">
            Loading task detail.
          </div>
        ) : (
          <div className="space-y-4">
            <div className="rounded-soft bg-surface-container p-4 shadow-ambient">
              <div className="space-y-4">
                <div className="flex items-start justify-between gap-3">
                  <div className="space-y-1 flex-1">
                    <p className="font-body text-xs uppercase tracking-[0.15em] text-on-surface-variant">
                      Current task
                    </p>
                    {isEditMode ? (
                      <input
                        value={draft.title}
                        onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                        className="w-full rounded-card border border-outline/20 bg-surface-dim px-3 py-3 font-display text-2xl text-on-surface outline-none focus:border-primary"
                        aria-label="Task title"
                      />
                    ) : (
                      <p className="font-display text-2xl text-on-surface">{draft.title}</p>
                    )}
                  </div>
                  <button
                    type="button"
                    onClick={() => setIsEditMode((current) => !current)}
                    className="rounded-full bg-primary/20 p-2 text-primary transition-colors hover:bg-primary/30"
                    aria-label={isEditMode ? 'Switch to view mode' : 'Switch to edit mode'}
                  >
                    {isEditMode ? (
                      <span className="font-body text-[0.65rem] font-bold uppercase tracking-widest text-primary">View</span>
                    ) : (
                      <span className="font-body text-[0.65rem] font-bold uppercase tracking-widest text-primary">Edit</span>
                    )}
                  </button>
                </div>

                <div className="grid gap-3">
                  <label className="space-y-1">
                    <span className="font-body text-xs uppercase tracking-[0.1em] text-on-surface-variant">
                      Group
                    </span>
                    {isEditMode ? (
                      <SelectDropdown
                        label=""
                        options={groupsQuery.data?.map((group) => ({ value: group.id, label: group.name })) ?? []}
                        value={draft.groupId}
                        onChange={(value) => setDraft({ ...draft, groupId: value as string })}
                        placeholder="No Group"
                      />
                    ) : (
                      <p className="rounded-card bg-surface-dim px-3 py-3 text-on-surface">
                        {groupsQuery.data?.find((g) => g.id === draft.groupId)?.name ?? 'Unknown'}
                      </p>
                    )}
                  </label>

                  <label className="space-y-1">
                    <span className="font-body text-xs uppercase tracking-[0.1em] text-on-surface-variant">
                      Due date
                    </span>
                    {isEditMode ? (
                      <input
                        type="date"
                        value={draft.dueDate}
                        onChange={(event) => {
                          const nextDueDate = event.target.value
                          if (!nextDueDate) {
                            setDraft({
                              ...draft,
                              dueDate: '',
                              reminderAt: '',
                              recurrence: null
                            })
                            return
                          }

                          let nextRecurrence = draft.recurrence
                          if (draft.recurrence?.frequency === 'weekly') {
                            nextRecurrence = recurrenceForDueDate('weekly', nextDueDate, draft.recurrence)
                          }
                          if (draft.recurrence?.frequency === 'monthly') {
                            nextRecurrence = recurrenceForDueDate('monthly', nextDueDate, draft.recurrence)
                          }
                          setDraft({
                            ...draft,
                            dueDate: nextDueDate,
                            recurrence: nextRecurrence
                          })
                        }}
                        className="w-full rounded-card border border-outline/20 bg-surface-dim px-3 py-3 text-on-surface outline-none focus:border-primary"
                      />
                    ) : (
                      <p className="rounded-card bg-surface-dim px-3 py-3 text-on-surface">
                        {draft.dueDate || 'No due date'}
                      </p>
                    )}
                  </label>

                  <label className="space-y-1">
                    <span className="font-body text-xs uppercase tracking-[0.1em] text-on-surface-variant">
                      Reminder
                    </span>
                    {isEditMode ? (
                      <input
                        type="datetime-local"
                        value={draft.reminderAt}
                        onChange={(event) => setDraft({ ...draft, reminderAt: event.target.value })}
                        disabled={!draft.dueDate}
                        className="w-full rounded-card border border-outline/20 bg-surface-dim px-3 py-3 text-on-surface outline-none focus:border-primary disabled:opacity-50"
                      />
                    ) : (
                      <p className="rounded-card bg-surface-dim px-3 py-3 text-on-surface">
                        {draft.reminderAt ? new Date(draft.reminderAt).toLocaleString() : 'No reminder'}
                      </p>
                    )}
                  </label>
                </div>
              </div>
            </div>

            <div className="rounded-soft bg-surface-container p-4 shadow-ambient">
              <div className="space-y-3">
                <div>
                  <p className="font-body text-xs uppercase tracking-[0.15em] text-on-surface-variant">
                    Recurrence
                  </p>
                  {isEditMode ? (
                    <p className="mt-1 font-body text-xs text-on-surface-variant">
                      Daily, weekly, and monthly only. Clearing the due date disables recurrence.
                    </p>
                  ) : null}
                </div>

                {isEditMode ? (
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: 'Daily', value: 'daily' },
                      { label: 'Weekly', value: 'weekly' },
                      { label: 'Monthly', value: 'monthly' }
                    ].map((option) => (
                      <button
                        key={option.value}
                        type="button"
                        disabled={!draft.dueDate}
                        onClick={() =>
                          setDraft({
                            ...draft,
                            recurrence:
                              draft.recurrence?.frequency === option.value
                                ? null
                                : recurrenceForDueDate(
                                    option.value as 'daily' | 'weekly' | 'monthly',
                                    draft.dueDate,
                                    draft.recurrence
                                  )
                          })
                        }
                        className={[
                          'rounded-card px-3 py-3 text-sm transition',
                          draft.recurrence?.frequency === option.value
                            ? 'bg-primary text-surface'
                            : 'bg-surface-dim text-on-surface-variant',
                          !draft.dueDate ? 'opacity-50' : ''
                        ].join(' ')}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <p className="rounded-card bg-surface-dim px-3 py-3 text-on-surface">
                    {draft.recurrence?.frequency
                      ? draft.recurrence.frequency.charAt(0).toUpperCase() + draft.recurrence.frequency.slice(1)
                      : 'No recurrence'}
                  </p>
                )}
              </div>
            </div>

            <div className="rounded-soft bg-surface-container p-4 shadow-ambient">
              <div className="space-y-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-display text-xl text-on-surface">Subtasks</p>
                    {isEditMode ? (
                      <p className="mt-1 font-body text-xs text-on-surface-variant">
                        Add, rename, complete, or remove checklist items.
                      </p>
                    ) : null}
                  </div>
                  <span className="rounded-pill bg-surface-container-high px-2 py-1 text-xs uppercase tracking-[0.1em] text-on-surface-variant">
                    {taskQuery.data.subtasks.length} items
                  </span>
                </div>

                <div className="space-y-2">
                  {taskQuery.data.subtasks.map((subtask) => (
                    <div key={subtask.id} className="rounded-card bg-surface-dim p-3">
                      <div className="flex items-start gap-2">
                        <button
                          type="button"
                          onClick={() =>
                            updateSubtaskMutation.mutate({
                              subtaskId: subtask.id,
                              is_completed: !subtask.is_completed
                            })
                          }
                          className={[
                            'mt-0.5 h-5 w-5 rounded-pill border',
                            subtask.is_completed
                              ? 'border-primary bg-primary'
                              : 'border-outline/25 bg-surface-container-high'
                          ].join(' ')}
                          aria-label={`Toggle ${subtask.title}`}
                        />
                        <div className="flex-1 space-y-2">
                          {isEditMode ? (
                            <input
                              value={subtaskDrafts[subtask.id] ?? subtask.title}
                              onChange={(event) =>
                                setSubtaskDrafts({
                                  ...subtaskDrafts,
                                  [subtask.id]: event.target.value
                                })
                              }
                              className="w-full rounded-card border border-outline/15 bg-surface-container px-3 py-2 text-on-surface outline-none focus:border-primary"
                              aria-label={`Subtask ${subtask.title}`}
                            />
                          ) : (
                            <p className="text-on-surface">{subtask.title}</p>
                          )}
                          {isEditMode ? (
                            <div className="flex gap-2">
                              <button
                                type="button"
                                onClick={() =>
                                  updateSubtaskMutation.mutate({
                                    subtaskId: subtask.id,
                                    title: subtaskDrafts[subtask.id]
                                  })
                                }
                                className="rounded-pill bg-primary px-3 py-1.5 text-sm font-medium text-surface"
                              >
                                Save
                              </button>
                              <button
                                type="button"
                                onClick={() => deleteSubtaskMutation.mutate(subtask.id)}
                                className="rounded-pill border border-outline/30 px-3 py-1.5 text-sm text-on-surface-variant"
                              >
                                Delete
                              </button>
                            </div>
                          ) : null}
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                {isEditMode ? (
                  <div className="flex gap-2">
                    <input
                      value={newSubtaskTitle}
                      onChange={(event) => setNewSubtaskTitle(event.target.value)}
                      placeholder="Add a subtask..."
                      className="flex-1 rounded-card border border-dashed border-outline/30 bg-surface-dim px-3 py-3 text-on-surface outline-none focus:border-primary"
                    />
                    <button
                      type="button"
                      onClick={() => createSubtaskMutation.mutate()}
                      disabled={!newSubtaskTitle.trim()}
                      className="rounded-pill bg-primary px-4 py-2 text-sm font-medium text-surface disabled:opacity-50"
                    >
                      Add
                    </button>
                  </div>
                ) : null}
              </div>
            </div>

            <div className="flex gap-3">
              <button
                type="button"
                onClick={() => saveTaskMutation.mutate()}
                disabled={isBusy}
                className="rounded-pill bg-primary px-5 py-3 text-sm font-medium text-surface disabled:opacity-50"
              >
                Save Changes
              </button>
              <button
                type="button"
                onClick={() => {
                  void navigate(`/tasks${backSearch}`)
                }}
                className="rounded-pill border border-outline/30 px-5 py-3 text-sm text-on-surface-variant"
              >
                Back to List
              </button>
              <button
                type="button"
                onClick={() => handleDeleteTask()}
                disabled={isBusy}
                className="rounded-pill border border-tertiary/30 px-5 py-3 text-sm text-tertiary hover:bg-tertiary/10 disabled:opacity-50"
              >
                Delete Task
              </button>
            </div>

            {pendingDelete ? (
              <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/60 p-4 sm:items-center">
                <div className="w-full max-w-md rounded-card bg-surface-container p-4 shadow-ambient">
                  {(taskQuery.data?.series_id || taskQuery.data?.recurrence_frequency) ? (
                    <>
                      <p className="font-display text-xl text-on-surface">Delete recurring task</p>
                      <p className="mt-2 font-body text-sm text-on-surface-variant">
                        Choose whether to delete only this occurrence or this and future open occurrences.
                      </p>
                      <p className="mt-2 truncate font-body text-sm text-on-surface">
                        {taskQuery.data?.title}
                      </p>
                      <div className="mt-4 flex flex-col gap-2">
                        <button
                          type="button"
                          onClick={() => deleteTaskMutation.mutate('occurrence')}
                          disabled={deleteTaskMutation.isPending}
                          className="w-full rounded-pill bg-surface-container-high px-4 py-2 text-sm font-medium text-on-surface transition hover:bg-surface-container-highest disabled:opacity-50"
                        >
                          Delete this occurrence
                        </button>
                        <button
                          type="button"
                          onClick={() => deleteTaskMutation.mutate('series')}
                          disabled={deleteTaskMutation.isPending}
                          className="w-full rounded-pill bg-tertiary px-4 py-2 text-sm font-medium text-surface transition hover:bg-tertiary/85 disabled:opacity-50"
                        >
                          Delete this and future
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingDelete(null)}
                          disabled={deleteTaskMutation.isPending}
                          className="w-full rounded-pill bg-transparent px-4 py-2 text-sm font-medium text-on-surface-variant transition hover:bg-surface-container-high disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </>
                  ) : (
                    <>
                      <p className="font-display text-xl text-on-surface">Delete task</p>
                      <p className="mt-2 truncate font-body text-sm text-on-surface">
                        {taskQuery.data?.title}
                      </p>
                      <p className="mt-2 font-body text-sm text-on-surface-variant">
                        Are you sure you want to delete this task?
                      </p>
                      <div className="mt-4 flex flex-col gap-2">
                        <button
                          type="button"
                          onClick={() => deleteTaskMutation.mutate('occurrence')}
                          disabled={deleteTaskMutation.isPending}
                          className="w-full rounded-pill bg-tertiary px-4 py-2 text-sm font-medium text-surface transition hover:bg-tertiary/85 disabled:opacity-50"
                        >
                          Delete
                        </button>
                        <button
                          type="button"
                          onClick={() => setPendingDelete(null)}
                          disabled={deleteTaskMutation.isPending}
                          className="w-full rounded-pill bg-transparent px-4 py-2 text-sm font-medium text-on-surface-variant transition hover:bg-surface-container-high disabled:opacity-50"
                        >
                          Cancel
                        </button>
                      </div>
                    </>
                  )}
                </div>
              </div>
            ) : null}
          </div>
        )}
      </section>

      {showUndoToast ? (
        <div className="fixed bottom-0 left-0 right-0 z-50 mx-auto max-w-md rounded-t-soft p-4 shadow-ambient bg-surface-container-highest border-t-2 border-error/50">
          <div className="flex items-center justify-between">
            <span className="text-sm font-medium text-on-surface">Deleted "{deletedTaskTitle}"</span>
            <button
              type="button"
              onClick={() => restoreTaskMutation.mutate()}
              disabled={restoreTaskMutation.isPending}
              className="rounded-pill bg-tertiary px-4 py-1.5 text-sm font-medium text-surface hover:bg-tertiary/80 disabled:opacity-50"
            >
              {restoreTaskMutation.isPending ? 'Restoring...' : 'Undo'}
            </button>
          </div>
        </div>
      ) : null}
    </SessionGuard>
  )
}
