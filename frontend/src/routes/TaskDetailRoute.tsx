import { useEffect, useState } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { useNavigate, useParams, useSearchParams } from 'react-router-dom'

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
  type TaskRecurrence,
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

function formatDueDate(value: string) {
  if (!value) {
    return 'No due date'
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(`${value}T12:00:00`))
}

function formatReminderValue(value: string) {
  if (!value) {
    return 'No reminder'
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return 'No reminder'
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function formatRecurrenceValue(recurrence: TaskRecurrence | null) {
  if (!recurrence) {
    return 'One-off'
  }

  return recurrence.frequency.charAt(0).toUpperCase() + recurrence.frequency.slice(1)
}

function formatSubtaskCount(count: number) {
  return `${count} ${count === 1 ? 'subtask' : 'subtasks'}`
}

function buildReturnPath(searchParams: URLSearchParams) {
  const params = new URLSearchParams()
  const group = searchParams.get('group')

  if (group) {
    params.set('group', group)
  }

  const nextSearch = params.toString()
  return nextSearch ? `/tasks?${nextSearch}` : '/tasks'
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
    day_of_month: Number(dueDate.split('-')[2] ?? current?.day_of_month ?? 1),
  }
}

function buildDraftState(task: Awaited<ReturnType<typeof getTaskDetail>>): DraftState {
  return {
    title: task.title,
    description: task.description ?? '',
    groupId: task.group.id,
    dueDate: task.due_date ?? '',
    reminderAt: toDateTimeLocalValue(task.reminder_at),
    recurrence: task.recurrence,
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
  const [isGroupDropdownOpen, setIsGroupDropdownOpen] = useState(false)
  const [pendingDelete, setPendingDelete] = useState<{ scope: TaskDeleteScope } | null>(null)
  const { dismissNotification, notifyError, notifySuccess, showNotification, updateNotification } =
    useNotifications()

  const sessionQuery = useQuery({
    queryKey: ['session-status'],
    queryFn: getSessionStatus,
  })

  const groupsQuery = useQuery({
    queryKey: ['groups'],
    queryFn: listGroups,
    enabled: sessionQuery.data?.signed_in === true,
  })

  const taskQuery = useQuery({
    queryKey: ['task-detail', taskId],
    queryFn: () => getTaskDetail(taskId as string),
    enabled: sessionQuery.data?.signed_in === true && Boolean(taskId),
  })

  useEffect(() => {
    setDraft(null)
    setSubtaskDrafts({})
    setNewSubtaskTitle('')
    setIsEditMode(false)
    setIsGroupDropdownOpen(false)
  }, [taskId])

  useEffect(() => {
    if (!taskQuery.data) {
      return
    }

    setDraft((current) => current ?? buildDraftState(taskQuery.data))
    setSubtaskDrafts((current) => mergeSubtaskDrafts(current, taskQuery.data.subtasks))
    setIsEditMode((current) => current || taskQuery.data.needs_review)
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
      queryClient.invalidateQueries({ queryKey: ['task-detail', taskId] }),
    ])
  }

  const returnPath = buildReturnPath(searchParams)

  async function returnToTasks(replace = false) {
    await navigate(returnPath, { replace })
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
          recurrence: draft.recurrence,
        },
        csrfToken
      )
    },
    onSuccess: async () => {
      notifySuccess('Task saved.')
      await refreshTaskData()
      await returnToTasks(true)
    },
    onError: (error) => {
      notifyError(buildFriendlyMessage(error, 'Task changes could not be saved.'))
    },
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
    },
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
    },
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
    },
  })

  const deleteTaskMutation = useMutation({
    mutationFn: async (scope: TaskDeleteScope) => {
      if (!taskId) {
        throw new Error('Task detail is not ready.')
      }
      const csrfToken = requireCsrf()
      return deleteTask(taskId, csrfToken, scope)
    },
    onSuccess: async () => {
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
      await refreshTaskData()
      await returnToTasks(true)
    },
    onError: (error) => {
      notifyError(buildFriendlyMessage(error, 'Task could not be deleted.'))
      setPendingDelete(null)
    },
  })

  function handleDeleteTask() {
    const task = taskQuery.data
    if (!task) return
    setPendingDelete({ scope: 'occurrence' })
  }

  const isBusy =
    saveTaskMutation.isPending ||
    createSubtaskMutation.isPending ||
    updateSubtaskMutation.isPending ||
    deleteSubtaskMutation.isPending ||
    deleteTaskMutation.isPending

  const groupName =
    groupsQuery.data?.find((group) => group.id === draft?.groupId)?.name ??
    taskQuery.data?.group.name ??
    'Unknown group'
  const recurrenceLabel = draft ? formatRecurrenceValue(draft.recurrence) : 'One-off'
  const dueLabel = draft ? formatDueDate(draft.dueDate) : 'No due date'
  const reminderLabel = draft ? formatReminderValue(draft.reminderAt) : 'No reminder'
  const subtaskCount = taskQuery.data?.subtasks.length ?? 0

  return (
    <SessionGuard
      session={sessionQuery.data}
      isLoading={sessionQuery.isLoading}
      isError={sessionQuery.isError}
      title="Task Detail"
      eyebrow="Focused editing"
      description="Refine the title, group, dates, reminders, and subtasks for a single task."
    >
      <section
        className="space-y-5"
        style={{ paddingBottom: 'calc(12.5rem + var(--safe-area-bottom))' }}
      >
        {taskQuery.isError ? (
          <div className="rounded-card bg-[rgba(80,18,18,0.92)] p-6 text-sm text-red-100 shadow-[0_18px_36px_rgba(0,0,0,0.4)]">
            {buildFriendlyMessage(taskQuery.error, 'Task detail could not be loaded.')}
          </div>
        ) : taskQuery.isLoading || !draft || !taskQuery.data ? (
          <div className="rounded-card bg-surface-container p-6 text-sm text-on-surface-variant">
            Loading task detail.
          </div>
        ) : (
          <>
            <div className="relative z-20 rounded-[1.7rem] bg-[radial-gradient(circle_at_top_left,_rgba(186,158,255,0.16),_rgba(32,32,31,0.98)_40%,_rgba(14,14,14,1)_100%)] p-5 shadow-[0_24px_60px_rgba(0,0,0,0.48)]">
              <div className="space-y-5">
                <div className="space-y-3">
                  <div className="flex flex-wrap items-center gap-2">
                    <span className="rounded-pill bg-white/6 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">
                      {isEditMode ? 'Editing task' : 'Task summary'}
                    </span>
                    <span className="rounded-pill bg-surface-container-high px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">
                      {groupName}
                    </span>
                    {taskQuery.data.needs_review ? (
                      <span className="rounded-pill bg-warning/20 px-3 py-1 text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-warning">
                        Needs review
                      </span>
                    ) : null}
                  </div>

                  <div className="space-y-3">
                    {isEditMode ? (
                      <>
                        <input
                          value={draft.title}
                          onChange={(event) => setDraft({ ...draft, title: event.target.value })}
                          className="w-full rounded-[1.25rem] bg-surface/60 px-4 py-3 font-display text-[1.85rem] leading-tight text-on-surface outline-none placeholder:text-on-surface-variant/40 focus:bg-surface/75 focus:text-white sm:text-[2rem]"
                          aria-label="Task title"
                          placeholder="Task title"
                        />
                        <textarea
                          value={draft.description}
                          onChange={(event) =>
                            setDraft({ ...draft, description: event.target.value })
                          }
                          rows={3}
                          className="w-full rounded-[1.25rem] bg-surface/55 px-4 py-3 text-sm leading-6 text-on-surface-variant outline-none placeholder:text-on-surface-variant/45 resize-none focus:bg-surface/70 focus:text-on-surface"
                          aria-label="Task description"
                          placeholder="Add context that helps you act on this later"
                        />
                      </>
                    ) : (
                      <>
                        <h2 className="font-display text-[2.15rem] leading-tight text-on-surface">
                          {draft.title}
                        </h2>
                        <p className="max-w-sm text-sm leading-6 text-on-surface-variant">
                          {draft.description || 'No additional context yet. Edit this task to add the detail that helps you act faster later.'}
                        </p>
                      </>
                    )}
                  </div>
                </div>

                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="rounded-[1.35rem] bg-black/20 p-4 backdrop-blur-sm">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">
                      Due date
                    </p>
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
                              recurrence: null,
                            })
                            return
                          }

                          let nextRecurrence = draft.recurrence
                          if (draft.recurrence?.frequency === 'weekly') {
                            nextRecurrence = recurrenceForDueDate(
                              'weekly',
                              nextDueDate,
                              draft.recurrence
                            )
                          }
                          if (draft.recurrence?.frequency === 'monthly') {
                            nextRecurrence = recurrenceForDueDate(
                              'monthly',
                              nextDueDate,
                              draft.recurrence
                            )
                          }
                          setDraft({
                            ...draft,
                            dueDate: nextDueDate,
                            recurrence: nextRecurrence,
                          })
                        }}
                        className="mt-3 w-full rounded-card bg-surface-dim px-3 py-3 pr-10 text-[0.88rem] font-medium text-on-surface outline-none focus:bg-surface-container-high sm:text-[0.95rem]"
                      />
                    ) : (
                      <p className="mt-3 text-base font-medium text-on-surface">{dueLabel}</p>
                    )}
                  </div>

                  <div className="rounded-[1.35rem] bg-black/20 p-4 backdrop-blur-sm">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">
                      Reminder
                    </p>
                    {isEditMode ? (
                      <input
                        type="datetime-local"
                        value={draft.reminderAt}
                        onChange={(event) =>
                          setDraft({ ...draft, reminderAt: event.target.value })
                        }
                        disabled={!draft.dueDate}
                        className="mt-3 w-full rounded-card bg-surface-dim px-3 py-3 pr-10 text-[0.82rem] font-medium text-on-surface outline-none focus:bg-surface-container-high disabled:opacity-50 sm:text-[0.9rem]"
                      />
                    ) : (
                      <p className="mt-3 text-base font-medium text-on-surface">{reminderLabel}</p>
                    )}
                  </div>

                  <div
                    className={[
                      'rounded-[1.35rem] bg-black/20 p-4 backdrop-blur-sm',
                      isGroupDropdownOpen ? 'relative z-40' : '',
                    ].join(' ')}
                  >
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">
                      Group
                    </p>
                    {isEditMode ? (
                      <div className="mt-3">
                        <SelectDropdown
                          label=""
                          options={
                            groupsQuery.data?.map((group) => ({
                              value: group.id,
                              label: group.name,
                            })) ?? []
                          }
                          value={draft.groupId}
                          onChange={(value) => setDraft({ ...draft, groupId: value as string })}
                          onOpenChange={setIsGroupDropdownOpen}
                          placeholder="No Group"
                        />
                      </div>
                    ) : (
                      <p className="mt-3 text-base font-medium text-on-surface">{groupName}</p>
                    )}
                  </div>

                  <div className="relative z-0 rounded-[1.35rem] bg-black/20 p-4 backdrop-blur-sm sm:col-span-2">
                    <p className="text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">
                      Recurrence
                    </p>
                    <p className="mt-3 text-base font-medium text-on-surface">{recurrenceLabel}</p>
                    {isEditMode ? (
                      <p className="mt-2 text-xs leading-5 text-on-surface-variant">
                        Choose a cadence only when this task should recreate itself after completion.
                      </p>
                    ) : null}
                  </div>
                </div>

                <div className="rounded-[1.35rem] bg-surface/45 p-4 text-sm text-on-surface-variant shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]">
                  {isEditMode
                    ? 'Save and return closes this detail view after your changes are written.'
                    : 'Open edit mode when you want to change details. Delete still asks for confirmation before it removes this task.'}
                </div>
              </div>
            </div>

            <div className="rounded-soft bg-surface-container p-4 shadow-ambient">
              <div className="space-y-3">
                <div>
                  <p className="font-display text-xl text-on-surface">Recurrence</p>
                  <p className="mt-1 font-body text-xs text-on-surface-variant">
                    {isEditMode
                      ? 'Daily, weekly, and monthly only. Clearing the due date also clears reminder timing and recurrence.'
                      : 'This task keeps a simple cadence. Edit it if you need to change how often it repeats.'}
                  </p>
                </div>

                {isEditMode ? (
                  <div className="grid grid-cols-3 gap-2">
                    {[
                      { label: 'Daily', value: 'daily' },
                      { label: 'Weekly', value: 'weekly' },
                      { label: 'Monthly', value: 'monthly' },
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
                                  ),
                          })
                        }
                        className={[
                          'rounded-card px-3 py-3 text-sm transition',
                          draft.recurrence?.frequency === option.value
                            ? 'bg-primary text-surface'
                            : 'bg-surface-dim text-on-surface-variant',
                          !draft.dueDate ? 'opacity-50' : '',
                        ].join(' ')}
                      >
                        {option.label}
                      </button>
                    ))}
                  </div>
                ) : (
                  <div className="rounded-card bg-surface-dim px-4 py-4">
                    <p className="text-on-surface">{recurrenceLabel}</p>
                  </div>
                )}
              </div>
            </div>

            <div className="rounded-soft bg-surface-container p-4 shadow-ambient">
              <div className="space-y-3">
                <div className="flex items-center justify-between gap-3">
                  <div>
                    <p className="font-display text-xl text-on-surface">Subtasks</p>
                    <p className="mt-1 font-body text-xs text-on-surface-variant">
                      {isEditMode
                        ? 'Add, rename, complete, or remove checklist items.'
                        : 'These are the smaller actions that drive this task forward.'}
                    </p>
                  </div>
                  <span className="inline-flex shrink-0 whitespace-nowrap rounded-pill bg-surface-container-high px-3 py-1 text-xs uppercase tracking-[0.12em] text-on-surface-variant">
                    {formatSubtaskCount(subtaskCount)}
                  </span>
                </div>

                <div className="space-y-2">
                  {taskQuery.data.subtasks.length === 0 ? (
                    <div className="rounded-card bg-surface-dim px-4 py-4 text-sm text-on-surface-variant">
                      No subtasks yet.
                    </div>
                  ) : (
                    taskQuery.data.subtasks.map((subtask) => (
                      <div key={subtask.id} className="rounded-card bg-surface-dim p-3">
                        <div className="flex items-start gap-2">
                          <button
                            type="button"
                            onClick={() =>
                              updateSubtaskMutation.mutate({
                                subtaskId: subtask.id,
                                is_completed: !subtask.is_completed,
                              })
                            }
                            className={[
                              'mt-0.5 h-5 w-5 rounded-pill border',
                              subtask.is_completed
                                ? 'border-primary bg-primary'
                                : 'border-outline/25 bg-surface-container-high',
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
                                    [subtask.id]: event.target.value,
                                  })
                                }
                                className="w-full rounded-card bg-surface-container px-3 py-2 text-on-surface outline-none focus:bg-surface-container-high"
                                aria-label={`Subtask ${subtask.title}`}
                              />
                            ) : (
                              <p
                                className={[
                                  'text-on-surface',
                                  subtask.is_completed ? 'line-through text-on-surface-variant' : '',
                                ].join(' ')}
                              >
                                {subtask.title}
                              </p>
                            )}
                            {isEditMode ? (
                              <div className="flex flex-wrap gap-2">
                                <button
                                  type="button"
                                  onClick={() =>
                                    updateSubtaskMutation.mutate({
                                      subtaskId: subtask.id,
                                      title: subtaskDrafts[subtask.id],
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
                    ))
                  )}
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

            <TaskDeleteDialog
              isOpen={pendingDelete !== null}
              taskTitle={taskQuery.data.title}
              isRecurring={Boolean(taskQuery.data.series_id || taskQuery.data.recurrence_frequency)}
              isDeleting={deleteTaskMutation.isPending}
              followUpMessage="After delete, you'll return to the task list."
              onDeleteOccurrence={() => deleteTaskMutation.mutate('occurrence')}
              onDeleteSeries={() => deleteTaskMutation.mutate('series')}
              onClose={() => setPendingDelete(null)}
            />
          </>
        )}

        {taskQuery.data && draft ? (
          <div className="pointer-events-none fixed inset-x-0 bottom-0 z-40">
            <div
              className="mx-auto w-full max-w-md px-3"
              style={{ paddingBottom: 'max(var(--safe-area-bottom), 0.75rem)' }}
            >
              <div className="pointer-events-auto rounded-[1.8rem] bg-[rgba(20,20,20,0.9)] p-3 shadow-[0_24px_60px_rgba(0,0,0,0.6)] backdrop-blur-xl">
                <p className="px-1 pb-3 text-[0.7rem] font-semibold uppercase tracking-[0.14em] text-on-surface-variant">
                  {isEditMode
                    ? 'Save writes your changes and closes this detail view.'
                    : 'Edit unlocks every field. Delete asks before it removes this task.'}
                </p>

                <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                  <button
                    type="button"
                    onClick={() => {
                      void returnToTasks(false)
                    }}
                    className="flex items-start justify-start gap-2 rounded-pill border border-white/10 bg-white/5 px-3 py-3 text-left text-sm font-medium text-on-surface transition hover:bg-white/10"
                  >
                    <span aria-hidden="true" className="pt-0.5 text-base leading-none">
                      ←
                    </span>
                    <span className="leading-tight">Back to tasks</span>
                  </button>

                  {isEditMode ? (
                    <button
                      type="button"
                      onClick={() => saveTaskMutation.mutate()}
                      disabled={isBusy}
                      className="rounded-pill bg-[radial-gradient(circle_at_top,_#c4b5fd_10%,_#7c3aed_90%)] px-4 py-3 text-sm font-semibold text-white shadow-[0_8px_0_#4c1d95,_0_16px_22px_rgba(0,0,0,0.35),_inset_0_2px_3px_rgba(255,255,255,0.38)] transition-all hover:-translate-y-[1px] active:translate-y-[4px] active:shadow-[0_0px_0_#4c1d95,_0_4px_10px_rgba(0,0,0,0.35),_inset_0_2px_4px_rgba(0,0,0,0.18)] disabled:opacity-50 disabled:hover:translate-y-0 disabled:active:translate-y-0"
                    >
                      Save and return
                    </button>
                  ) : (
                    <button
                      type="button"
                      onClick={() => setIsEditMode(true)}
                      className="rounded-pill bg-[radial-gradient(circle_at_top,_rgba(196,181,253,0.32),_rgba(124,58,237,0.92)_88%)] px-4 py-3 text-sm font-semibold text-white shadow-[0_8px_20px_rgba(76,29,149,0.32),_inset_0_1px_2px_rgba(255,255,255,0.32)] transition-transform hover:-translate-y-[1px] active:translate-y-[1px]"
                    >
                      Edit task
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={handleDeleteTask}
                    disabled={isBusy}
                    className="col-span-2 rounded-pill border border-tertiary/35 bg-tertiary/10 px-4 py-3 text-sm font-medium text-tertiary transition hover:bg-tertiary/15 disabled:opacity-50 sm:col-span-1"
                  >
                    Delete task
                  </button>
                </div>
              </div>
            </div>
          </div>
        ) : null}
      </section>
    </SessionGuard>
  )
}
