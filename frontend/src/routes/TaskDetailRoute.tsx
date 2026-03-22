import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom'

import { SessionGuard } from '../components/SessionGuard'
import {
  ApiError,
  createSubtask,
  deleteSubtask,
  getSessionStatus,
  getTaskDetail,
  listGroups,
  updateSubtask,
  updateTask,
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

  const isBusy =
    saveTaskMutation.isPending ||
    createSubtaskMutation.isPending ||
    updateSubtaskMutation.isPending ||
    deleteSubtaskMutation.isPending

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
      <section className="space-y-6">
        <div className="flex items-center justify-between">
          <Link
            to={`/tasks${backSearch}`}
            className="rounded-pill bg-surface-container px-4 py-3 text-sm text-on-surface"
          >
            Back to Tasks
          </Link>
          <button
            type="button"
            onClick={() => {
              void navigate(`/tasks${backSearch}`)
            }}
            className="rounded-pill border border-outline/30 px-4 py-3 text-sm text-on-surface-variant"
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
          <div className="space-y-6">
            <div className="rounded-soft bg-surface-container p-6 shadow-ambient">
              <div className="space-y-5">
                <div className="space-y-2">
                  <p className="font-body text-xs uppercase tracking-[0.2em] text-on-surface-variant">
                    Current task
                  </p>
                  <input
                    value={draft.title}
                    onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                    className="w-full rounded-card border border-outline/20 bg-surface-dim px-4 py-4 font-display text-3xl text-on-surface outline-none focus:border-primary"
                    aria-label="Task title"
                  />
                </div>

                <div className="grid gap-4">
                  <label className="space-y-2">
                    <span className="font-body text-xs uppercase tracking-[0.18em] text-on-surface-variant">
                      Group
                    </span>
                    <select
                      value={draft.groupId}
                      onChange={(event) => setDraft({ ...draft, groupId: event.target.value })}
                      className="w-full rounded-card border border-outline/20 bg-surface-dim px-4 py-4 text-on-surface outline-none focus:border-primary"
                    >
                      {groupsQuery.data?.map((group) => (
                        <option key={group.id} value={group.id}>
                          {group.name}
                        </option>
                      ))}
                    </select>
                  </label>

                  <label className="space-y-2">
                    <span className="font-body text-xs uppercase tracking-[0.18em] text-on-surface-variant">
                      Due date
                    </span>
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
                      className="w-full rounded-card border border-outline/20 bg-surface-dim px-4 py-4 text-on-surface outline-none focus:border-primary"
                    />
                  </label>

                  <label className="space-y-2">
                    <span className="font-body text-xs uppercase tracking-[0.18em] text-on-surface-variant">
                      Reminder
                    </span>
                    <input
                      type="datetime-local"
                      value={draft.reminderAt}
                      onChange={(event) => setDraft({ ...draft, reminderAt: event.target.value })}
                      disabled={!draft.dueDate}
                      className="w-full rounded-card border border-outline/20 bg-surface-dim px-4 py-4 text-on-surface outline-none focus:border-primary disabled:opacity-50"
                    />
                  </label>
                </div>
              </div>
            </div>

            <div className="rounded-soft bg-surface-container p-6 shadow-ambient">
              <div className="space-y-4">
                <div>
                  <p className="font-body text-xs uppercase tracking-[0.2em] text-on-surface-variant">
                    Recurrence
                  </p>
                  <p className="mt-2 font-body text-sm text-on-surface-variant">
                    Daily, weekly, and monthly only. Clearing the due date disables recurrence.
                  </p>
                </div>

                <div className="grid grid-cols-3 gap-3">
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
                        'rounded-card px-4 py-4 text-sm transition',
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
              </div>
            </div>

            <div className="rounded-soft bg-surface-container p-6 shadow-ambient">
              <div className="space-y-4">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="font-display text-2xl text-on-surface">Subtasks</p>
                    <p className="mt-2 font-body text-sm text-on-surface-variant">
                      Add, rename, complete, or remove checklist items.
                    </p>
                  </div>
                  <span className="rounded-pill bg-surface-container-high px-3 py-2 text-xs uppercase tracking-[0.18em] text-on-surface-variant">
                    {taskQuery.data.subtasks.length} items
                  </span>
                </div>

                <div className="space-y-3">
                  {taskQuery.data.subtasks.map((subtask) => (
                    <div key={subtask.id} className="rounded-card bg-surface-dim p-4">
                      <div className="flex items-start gap-3">
                        <button
                          type="button"
                          onClick={() =>
                            updateSubtaskMutation.mutate({
                              subtaskId: subtask.id,
                              is_completed: !subtask.is_completed
                            })
                          }
                          className={[
                            'mt-1 h-6 w-6 rounded-pill border',
                            subtask.is_completed
                              ? 'border-primary bg-primary'
                              : 'border-outline/25 bg-surface-container-high'
                          ].join(' ')}
                          aria-label={`Toggle ${subtask.title}`}
                        />
                        <div className="flex-1 space-y-3">
                          <input
                            value={subtaskDrafts[subtask.id] ?? subtask.title}
                            onChange={(event) =>
                              setSubtaskDrafts({
                                ...subtaskDrafts,
                                [subtask.id]: event.target.value
                              })
                            }
                            className="w-full rounded-card border border-outline/15 bg-surface-container px-4 py-3 text-on-surface outline-none focus:border-primary"
                            aria-label={`Subtask ${subtask.title}`}
                          />
                          <div className="flex gap-3">
                            <button
                              type="button"
                              onClick={() =>
                                updateSubtaskMutation.mutate({
                                  subtaskId: subtask.id,
                                  title: subtaskDrafts[subtask.id]
                                })
                              }
                              className="rounded-pill bg-primary px-4 py-2 text-sm font-medium text-surface"
                            >
                              Save
                            </button>
                            <button
                              type="button"
                              onClick={() => deleteSubtaskMutation.mutate(subtask.id)}
                              className="rounded-pill border border-outline/30 px-4 py-2 text-sm text-on-surface-variant"
                            >
                              Delete
                            </button>
                          </div>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>

                <div className="flex gap-3">
                  <input
                    value={newSubtaskTitle}
                    onChange={(event) => setNewSubtaskTitle(event.target.value)}
                    placeholder="Add a subtask..."
                    className="flex-1 rounded-card border border-dashed border-outline/30 bg-surface-dim px-4 py-4 text-on-surface outline-none focus:border-primary"
                  />
                  <button
                    type="button"
                    onClick={() => createSubtaskMutation.mutate()}
                    disabled={!newSubtaskTitle.trim()}
                    className="rounded-pill bg-primary px-5 py-3 text-sm font-medium text-surface disabled:opacity-50"
                  >
                    Add
                  </button>
                </div>
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
            </div>
          </div>
        )}
      </section>
    </SessionGuard>
  )
}
