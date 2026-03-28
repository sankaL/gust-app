import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { useNotifications } from '../components/Notifications'
import { SessionGuard } from '../components/SessionGuard'
import { SelectDropdown } from '../components/SelectDropdown'
import { TaskDeleteDialog } from '../components/TaskDeleteDialog'
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
  description: string
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
    description: task.description ?? '',
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
  const [isEditMode, setIsEditMode] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<{ scope: TaskDeleteScope } | null>(null)
  const { dismissNotification, notifyError, notifySuccess, showNotification, updateNotification } =
    useNotifications()

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
          description: draft.description || null,
          group_id: draft.groupId,
          due_date: draft.dueDate || null,
          reminder_at: draft.reminderAt ? new Date(draft.reminderAt).toISOString() : null,
          recurrence: draft.recurrence
        },
        csrfToken
      )
    },
    onSuccess: (task) => {
      notifySuccess('Task saved.')
      setDraft(buildDraftState(task))
      void refreshTaskData()
    },
    onError: (error) => {
      notifyError(buildFriendlyMessage(error, 'Task changes could not be saved.'))
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
      notifySuccess('Subtask added.')
      void refreshTaskData()
    },
    onError: (error) => {
      notifyError(buildFriendlyMessage(error, 'Subtask could not be added.'))
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
      notifySuccess('Subtask updated.')
      void refreshTaskData()
    },
    onError: (error) => {
      notifyError(buildFriendlyMessage(error, 'Subtask could not be updated.'))
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
      notifySuccess('Subtask deleted.')
      void refreshTaskData()
    },
    onError: (error) => {
      notifyError(buildFriendlyMessage(error, 'Subtask could not be deleted.'))
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
      const taskTitle = taskQuery.data?.title ?? 'task'
      const deletedTaskId = taskId as string
      const csrfToken = requireCsrf()
      const notificationId = showNotification({
        type: 'warning',
        message: `Deleted ${taskTitle}`,
        actionLabel: 'Undo',
        onAction: async () => {
          updateNotification(notificationId, {
            type: 'loading',
            message: `Restoring ${taskTitle}...`,
            actionLabel: undefined,
            onAction: undefined,
            dismissible: false,
            durationMs: null,
          })

          try {
            await restoreTask(deletedTaskId, csrfToken)
            dismissNotification(notificationId)
            notifySuccess(`Restored ${taskTitle}.`)
            await Promise.all([
              queryClient.invalidateQueries({ queryKey: ['tasks'] }),
              queryClient.invalidateQueries({ queryKey: ['groups'] }),
              queryClient.invalidateQueries({ queryKey: ['task-detail', deletedTaskId] }),
            ])
          } catch (error) {
            updateNotification(notificationId, {
              type: 'error',
              message: buildFriendlyMessage(error, 'Task could not be restored.'),
              dismissible: true,
              durationMs: 3000,
            })
          }
        },
      })
      void refreshTaskData()
      void navigate(`/tasks${backSearch}`)
    },
    onError: (error) => {
      notifyError(buildFriendlyMessage(error, 'Task could not be deleted.'))
      setPendingDelete(null)
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
    deleteTaskMutation.isPending

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
                      <div className="space-y-3">
                        <input
                          value={draft.title}
                          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                          className="w-full rounded-card border border-outline/20 bg-surface-dim px-3 py-3 font-display text-2xl text-on-surface outline-none focus:border-primary"
                          aria-label="Task title"
                        />
                        <textarea
                          value={draft.description}
                          onChange={(event) =>
                            setDraft({ ...draft, description: event.target.value })
                          }
                          rows={3}
                          className="w-full rounded-card border border-outline/20 bg-surface-dim px-3 py-3 text-sm text-on-surface outline-none focus:border-primary resize-none"
                          aria-label="Task description"
                          placeholder="Optional short context"
                        />
                      </div>
                    ) : (
                      <div className="space-y-2">
                        <p className="font-display text-2xl text-on-surface">{draft.title}</p>
                        {draft.description ? (
                          <p className="text-sm leading-relaxed text-on-surface-variant">
                            {draft.description}
                          </p>
                        ) : null}
                      </div>
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

            <TaskDeleteDialog
              isOpen={pendingDelete !== null}
              taskTitle={taskQuery.data?.title ?? ''}
              isRecurring={Boolean(taskQuery.data?.series_id || taskQuery.data?.recurrence_frequency)}
              isDeleting={deleteTaskMutation.isPending}
              onDeleteOccurrence={() => deleteTaskMutation.mutate('occurrence')}
              onDeleteSeries={() => deleteTaskMutation.mutate('series')}
              onClose={() => setPendingDelete(null)}
            />
          </div>
        )}
      </section>
    </SessionGuard>
  )
}
