import { useEffect, useState, useRef } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { Link, useNavigate, useSearchParams } from 'react-router-dom'

import {
  ApiError,
  completeTask,
  deleteTask,
  getTaskDetail,
  getSessionStatus,
  listGroups,
  listTasks,
  reopenTask,
  restoreTask,
  type TaskDeleteScope,
  type SessionStatus,
  type TaskSummary,
  type GroupSummary
} from '../lib/api'
import {
  adjustGroupOpenCount,
  applyTaskListMutation,
  prependTaskToMatchingLists,
  restoreQuerySnapshots,
  snapshotTaskQueries,
  updateTaskDetailCache,
} from '../lib/taskQueryCache'
import { TASK_SCREEN_GC_TIME_MS, TASK_SCREEN_STALE_TIME_MS } from '../lib/queryTuning'
import { AllTasksView } from '../components/AllTasksView'
import { EditExtractedTaskModal } from '../components/EditExtractedTaskModal'
import { useNotifications } from '../components/Notifications'
import { OpenTaskCard } from '../components/OpenTaskCard'
import { SessionGuard } from '../components/SessionGuard'
import { TaskDeleteDialog } from '../components/TaskDeleteDialog'

// Icon Components (inline SVGs for consistency with codebase)
function LayersIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <polygon points="12 2 2 7 12 12 22 7 12 2" />
      <polyline points="2 17 12 22 22 17" />
      <polyline points="2 12 12 17 22 12" />
    </svg>
  )
}

function InboxIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <polyline points="22 12 16 12 14 15 10 15 8 12 2 12" />
      <path d="M5.45 5.11L2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.45-6.89A2 2 0 0 0 16.76 4H7.24a2 2 0 0 0-1.79 1.11z" />
    </svg>
  )
}

function ChevronDownIcon({ className = 'w-4 h-4' }: { className?: string }) {
  return (
    <svg className={className} width="16" height="16" fill="none" stroke="currentColor" viewBox="0 0 24 24" strokeWidth={2}>
      <polyline points="6 9 12 15 18 9" />
    </svg>
  )
}

// Group Tabs Component
interface GroupTabsProps {
  groups: GroupSummary[]
  inboxGroupId: string | null | undefined
  selectedGroupId: string | null
  onSelectGroup: (groupId: string) => void
}

function GroupTabs({ groups, inboxGroupId, selectedGroupId, onSelectGroup }: GroupTabsProps) {
  const [isDropdownOpen, setIsDropdownOpen] = useState(false)
  const dropdownRef = useRef<HTMLDivElement>(null)

  // Find inbox group
  const inboxGroup = groups.find(g => g.id === inboxGroupId)
  
  // Get non-inbox groups for dropdown
  const otherGroups = groups.filter(g => g.id !== inboxGroupId)
  
  // Check if a non-inbox group is currently selected
  const selectedOtherGroup = otherGroups.find(g => g.id === selectedGroupId)
  
  // Check current selection state
  const isAllSelected = selectedGroupId === 'all'
  const isInboxSelected = selectedGroupId === inboxGroupId
  const isOtherGroupSelected = selectedOtherGroup !== undefined

  // Close dropdown when clicking outside
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsDropdownOpen(false)
      }
    }

    if (isDropdownOpen) {
      document.addEventListener('mousedown', handleClickOutside)
    }

    return () => {
      document.removeEventListener('mousedown', handleClickOutside)
    }
  }, [isDropdownOpen])

  // Base styles for pills
  const basePillClass = 'rounded-pill px-3 py-1.5 font-body text-xs font-medium transition-all duration-200 active:scale-95 outline-none flex items-center gap-1.5 sm:px-4 sm:py-2 sm:text-sm sm:gap-2'
  
  const activePillClass = 'bg-[radial-gradient(circle_at_top_left,_#5b21b6_0%,_#2e1065_100%)] text-white shadow-[0_2px_0_#171033,_0_4px_8px_rgba(0,0,0,0.3),_inset_0_1px_2px_rgba(255,255,255,0.15)] -translate-y-[1px]'
  
  const inactivePillClass = 'bg-surface-container-high text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] border border-white/5'

  // Dropdown item styles
  const dropdownBaseClass = 'flex items-center justify-between px-3 py-2 cursor-pointer transition-colors text-sm'
  const dropdownHoverClass = 'hover:bg-surface-container-highest text-on-surface'

  return (
    <div className="flex w-full min-w-0 gap-1.5 sm:gap-2">
      {/* All Tab */}
      <button
        type="button"
        onClick={() => onSelectGroup('all')}
        className={`${basePillClass} ${isAllSelected ? activePillClass : inactivePillClass}`}
      >
        <LayersIcon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
        <span className="truncate">All</span>
      </button>

      {/* Inbox Tab */}
      {inboxGroup && (
        <button
          type="button"
          onClick={() => onSelectGroup(inboxGroup.id)}
          className={`${basePillClass} ${isInboxSelected ? activePillClass : inactivePillClass}`}
        >
          <InboxIcon className="h-3.5 w-3.5 sm:h-4 sm:w-4" />
          <span className="truncate">Inbox</span>
          <span className="shrink-0 text-[0.68rem] opacity-70 sm:text-xs">· {inboxGroup.open_task_count}</span>
        </button>
      )}

      {/* Other Dropdown - Takes 50% width */}
      <div ref={dropdownRef} className="relative min-w-0 flex-1 max-w-[52%] sm:max-w-[50%]">
        <button
          type="button"
          onClick={() => setIsDropdownOpen(!isDropdownOpen)}
          className={`${basePillClass} w-full min-w-0 justify-between ${isOtherGroupSelected ? activePillClass : inactivePillClass}`}
        >
          {isOtherGroupSelected ? (
            <span className="flex min-w-0 items-center gap-1.5">
              <span className="truncate">{selectedOtherGroup.name}</span>
              <span className="shrink-0 text-[0.68rem] opacity-70 sm:text-xs">· {selectedOtherGroup.open_task_count}</span>
            </span>
          ) : (
            <span className="text-current">Other</span>
          )}
          <ChevronDownIcon className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 sm:h-4 sm:w-4 ${isDropdownOpen ? 'rotate-180' : ''}`} />
        </button>

        {/* Dropdown Menu */}
        {isDropdownOpen && otherGroups.length > 0 && (
          <ul
            className="
              absolute z-50 mt-2 w-full overflow-hidden rounded-card
              bg-[linear-gradient(180deg,_rgb(38,38,38)_0%,_rgb(26,26,26)_100%)]
              shadow-[0_18px_40px_rgba(0,0,0,0.58),_inset_0_1px_0_rgba(255,255,255,0.05)]
              max-h-60 overflow-y-auto py-1
            "
          >
            {otherGroups.map((group) => (
              <li key={group.id}>
                <button
                  type="button"
                  onClick={() => {
                    onSelectGroup(group.id)
                    setIsDropdownOpen(false)
                  }}
                  className={`${dropdownBaseClass} ${dropdownHoverClass} w-full ${group.id === selectedGroupId ? 'bg-surface-container-highest' : ''}`}
                >
                  <span className="truncate">{group.name}</span>
                  <span className="text-on-surface-variant text-xs shrink-0">{group.open_task_count}</span>
                </button>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  )
}

type UndoState =
  | {
      kind: 'complete'
      taskId: string
      title: string
    }
  | {
      kind: 'delete'
      taskId: string
      title: string
    }
  | null

type SwipeTaskCardProps = {
  task: TaskSummary
  onOpen: (taskId: string) => void
  onPrepareOpen?: (taskId: string) => void
  onComplete: (taskId: string) => void
  onDelete: (task: TaskSummary) => void
  isBusy: boolean
}

function buildFriendlyMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message
  }

  return fallback
}

function normalizeOpenTaskItems(data: unknown): TaskSummary[] {
  if (Array.isArray(data)) {
    return data as TaskSummary[]
  }

  if (
    data &&
    typeof data === 'object' &&
    'items' in data &&
    Array.isArray((data as { items?: unknown }).items)
  ) {
    return (data as { items: TaskSummary[] }).items
  }

  return []
}

function SwipeTaskCard({ task, onOpen, onPrepareOpen, onComplete, onDelete, isBusy }: SwipeTaskCardProps) {
  return (
    <OpenTaskCard
      task={task}
      onOpen={onOpen}
      onPrepareOpen={onPrepareOpen}
      onComplete={(currentTask) => onComplete(currentTask.id)}
      onDelete={onDelete}
      isBusy={isBusy}
      enableSwipe
    />
  )
}

export function TasksRoute() {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [searchParams, setSearchParams] = useSearchParams()
  const [isAddTaskModalOpen, setIsAddTaskModalOpen] = useState(false)
  const [pendingDeleteTask, setPendingDeleteTask] = useState<TaskSummary | null>(null)
  const [pendingTaskIds, setPendingTaskIds] = useState<string[]>([])
  const { dismissNotification, notifyError, notifySuccess, showNotification, updateNotification } =
    useNotifications()

  const sessionQuery = useQuery({
    queryKey: ['session-status'],
    queryFn: getSessionStatus,
    retry: false,
  })

  const groupsQuery = useQuery({
    queryKey: ['groups'],
    queryFn: listGroups,
    enabled: sessionQuery.data?.signed_in === true,
    staleTime: TASK_SCREEN_STALE_TIME_MS,
    gcTime: TASK_SCREEN_GC_TIME_MS,
  })

  const selectedGroupId = searchParams.get('group')
  const effectiveGroupId = selectedGroupId ?? 'all'
  const isAllView = effectiveGroupId === 'all'
  const resolvedGroupId = isAllView ? null : effectiveGroupId

  useEffect(() => {
    if (!sessionQuery.data?.signed_in || selectedGroupId) {
      return
    }

    setSearchParams({ group: 'all' }, { replace: true })
  }, [selectedGroupId, sessionQuery.data, setSearchParams])

  const tasksQuery = useQuery({
    queryKey: ['tasks', resolvedGroupId, 'open'],
    queryFn: () => listTasks(resolvedGroupId as string),
    enabled: sessionQuery.data?.signed_in === true && Boolean(resolvedGroupId) && !isAllView,
    staleTime: TASK_SCREEN_STALE_TIME_MS,
    gcTime: TASK_SCREEN_GC_TIME_MS,
  })

  function requireCsrf(session: SessionStatus | undefined) {
    const csrfToken = session?.csrf_token
    if (!csrfToken) {
      throw new ApiError('Your session is missing a CSRF token.', 'csrf_missing', 403)
    }
    return csrfToken
  }

  async function refreshTaskData() {
    await Promise.all([
      queryClient.invalidateQueries({ queryKey: ['groups'] }),
      queryClient.invalidateQueries({ queryKey: ['tasks', resolvedGroupId, 'open'] }),
      queryClient.invalidateQueries({ queryKey: ['tasks', 'all', 'open'] })
    ])
  }

  function markTaskPending(taskId: string, isPending: boolean) {
    setPendingTaskIds((current) => {
      if (isPending) {
        return current.includes(taskId) ? current : [...current, taskId]
      }
      return current.filter((candidate) => candidate !== taskId)
    })
  }

  function prefetchTaskDetail(taskId: string) {
    void queryClient.prefetchQuery({
      queryKey: ['task-detail', taskId],
      queryFn: () => getTaskDetail(taskId),
    })
  }

  function syncTaskCaches(task: TaskSummary) {
    applyTaskListMutation(queryClient, (currentTask, statusSegment) => {
      if (currentTask.id !== task.id) {
        return currentTask
      }

      if (task.deleted_at) {
        return null
      }

      return statusSegment === task.status ? { ...currentTask, ...task } : null
    })

    if (!task.deleted_at) {
      prependTaskToMatchingLists(queryClient, task, task.status)
    }

    updateTaskDetailCache(queryClient, task)
  }

  async function invalidateTaskViews(
    taskId: string,
    groupId: string,
    shouldRefetchOpenLists: boolean
  ) {
    const invalidations = [
      queryClient.invalidateQueries({
        queryKey: ['task-detail', taskId],
        refetchType: 'inactive' as const,
      }),
    ]

    if (shouldRefetchOpenLists) {
      invalidations.push(
        queryClient.invalidateQueries({ queryKey: ['groups'] }),
        queryClient.invalidateQueries({ queryKey: ['tasks', groupId, 'open'] }),
        queryClient.invalidateQueries({ queryKey: ['tasks', 'all', 'open'] }),
        queryClient.invalidateQueries({ queryKey: ['tasks', 'all', 'open', 'infinite'] }),
      )
    } else {
      invalidations.push(
        queryClient.invalidateQueries({ queryKey: ['groups'], refetchType: 'inactive' as const })
      )
    }

    await Promise.all(invalidations)
  }

  function canCreateFollowUpOccurrence(task: TaskSummary) {
    return Boolean(task.series_id || task.recurrence_frequency)
  }

  function shouldRefetchOpenListsAfterDelete(scope: TaskDeleteScope, task: TaskSummary) {
    return scope === 'series' || (scope === 'occurrence' && canCreateFollowUpOccurrence(task))
  }

  const completeMutation = useMutation({
    onMutate: async (task) => {
      markTaskPending(task.id, true)
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ['groups'] }),
        queryClient.cancelQueries({ queryKey: ['tasks'] }),
        queryClient.cancelQueries({ queryKey: ['task-detail', task.id] }),
      ])

      const snapshots = snapshotTaskQueries(queryClient, task.id)
      const optimisticTask: TaskSummary = {
        ...task,
        status: 'completed',
        completed_at: new Date().toISOString(),
      }

      applyTaskListMutation(queryClient, (currentTask, statusSegment) => {
        if (currentTask.id !== task.id) {
          return currentTask
        }
        return statusSegment === 'completed' ? optimisticTask : null
      })
      prependTaskToMatchingLists(queryClient, optimisticTask, 'completed')
      adjustGroupOpenCount(queryClient, task.group.id, -1)
      updateTaskDetailCache(queryClient, optimisticTask)

      return { snapshots }
    },
    mutationFn: async (task: TaskSummary) => {
      const csrfToken = requireCsrf(sessionQuery.data)
      return completeTask(task.id, csrfToken)
    },
    onSuccess: (task) => {
      syncTaskCaches(task)
      const undo: Exclude<UndoState, null> = { kind: 'complete', taskId: task.id, title: task.title }
      const notificationId = showNotification({
        type: 'success',
        message: `Completed ${task.title}`,
        actionLabel: 'Undo',
        onAction: async () => {
          updateNotification(notificationId, {
            type: 'loading',
            message: `Undoing ${task.title}...`,
            actionLabel: undefined,
            onAction: undefined,
            dismissible: false,
            durationMs: null,
          })

          try {
            const csrfToken = requireCsrf(sessionQuery.data)
            if (undo.kind === 'complete') {
              const reopenedTask = await reopenTask(undo.taskId, csrfToken)
              adjustGroupOpenCount(queryClient, reopenedTask.group.id, 1)
              syncTaskCaches(reopenedTask)
            }
            dismissNotification(notificationId)
            notifySuccess(`Moved ${task.title} back to To-do.`)
            await invalidateTaskViews(task.id, task.group.id, canCreateFollowUpOccurrence(task))
          } catch (error) {
            updateNotification(notificationId, {
              type: 'error',
              message: buildFriendlyMessage(error, 'Undo failed.'),
              dismissible: true,
              durationMs: 3000,
            })
          }
        },
      })
      void invalidateTaskViews(task.id, task.group.id, canCreateFollowUpOccurrence(task))
    },
    onError: (error, task, context) => {
      if (context?.snapshots) {
        restoreQuerySnapshots(queryClient, context.snapshots)
      }
      markTaskPending(task.id, false)
      notifyError(buildFriendlyMessage(error, 'Task could not be completed.'))
    },
    onSettled: (_result, _error, task) => {
      markTaskPending(task.id, false)
    }
  })

  const deleteTaskMutation = useMutation({
    onMutate: async ({ task }) => {
      markTaskPending(task.id, true)
      await Promise.all([
        queryClient.cancelQueries({ queryKey: ['groups'] }),
        queryClient.cancelQueries({ queryKey: ['tasks'] }),
        queryClient.cancelQueries({ queryKey: ['task-detail', task.id] }),
      ])

      const snapshots = snapshotTaskQueries(queryClient, task.id)
      applyTaskListMutation(queryClient, (currentTask) =>
        currentTask.id === task.id ? null : currentTask
      )
      if (task.status === 'open') {
        adjustGroupOpenCount(queryClient, task.group.id, -1)
      }
      updateTaskDetailCache(queryClient, {
        ...task,
        deleted_at: new Date().toISOString(),
      })

      return { snapshots }
    },
    mutationFn: async ({ task, scope }: { task: TaskSummary; scope: TaskDeleteScope }) => {
      const csrfToken = requireCsrf(sessionQuery.data)
      return deleteTask(task.id, csrfToken, scope)
    },
    onSuccess: (deletedTask, variables) => {
      syncTaskCaches(deletedTask)
      setPendingDeleteTask(null)
      const undo: Exclude<UndoState, null> = {
        kind: 'delete',
        taskId: variables.task.id,
        title: variables.task.title,
      }
      const notificationId = showNotification({
        type: 'warning',
        message: `Deleted ${variables.task.title}`,
        actionLabel: 'Undo',
        onAction: async () => {
          updateNotification(notificationId, {
            type: 'loading',
            message: `Restoring ${variables.task.title}...`,
            actionLabel: undefined,
            onAction: undefined,
            dismissible: false,
            durationMs: null,
          })

          try {
            const csrfToken = requireCsrf(sessionQuery.data)
            if (undo.kind === 'delete') {
              const restoredTask = await restoreTask(undo.taskId, csrfToken)
              adjustGroupOpenCount(queryClient, restoredTask.group.id, 1)
              syncTaskCaches(restoredTask)
            }
            dismissNotification(notificationId)
            notifySuccess(`Restored ${variables.task.title}.`)
            await invalidateTaskViews(
              variables.task.id,
              variables.task.group.id,
              shouldRefetchOpenListsAfterDelete(variables.scope, variables.task)
            )
          } catch (error) {
            updateNotification(notificationId, {
              type: 'error',
              message: buildFriendlyMessage(error, 'Undo failed.'),
              dismissible: true,
              durationMs: 3000,
            })
          }
        },
      })
      void invalidateTaskViews(
        variables.task.id,
        variables.task.group.id,
        shouldRefetchOpenListsAfterDelete(variables.scope, variables.task)
      )
    },
    onError: (error, variables, context) => {
      if (context?.snapshots) {
        restoreQuerySnapshots(queryClient, context.snapshots)
      }
      markTaskPending(variables.task.id, false)
      notifyError(buildFriendlyMessage(error, 'Task could not be deleted.'))
      setPendingDeleteTask(null)
    },
    onSettled: (_result, _error, variables) => {
      markTaskPending(variables.task.id, false)
    }
  })

  const bucketSections = [
    { key: 'overdue', label: 'Overdue' },
    { key: 'due_soon', label: 'Due Soon' },
    { key: 'no_date', label: 'No Date' }
  ] as const
  const openTaskItems = normalizeOpenTaskItems(tasksQuery.data)


  return (
    <SessionGuard
      session={sessionQuery.data}
      isLoading={sessionQuery.isLoading}
      isError={sessionQuery.isError}
      title="Tasks"
      eyebrow="Focused task surface"
      description="Review, sort, and correct extracted tasks without leaving the protected backend session."
    >
      <section className="space-y-4">
        {groupsQuery.data?.length ? (
          <GroupTabs
            groups={groupsQuery.data}
            inboxGroupId={sessionQuery.data?.inbox_group_id}
            selectedGroupId={effectiveGroupId}
            onSelectGroup={(groupId) => setSearchParams({ group: groupId })}
          />
        ) : null}

        {isAllView ? (
          <AllTasksView
            userTimezone={sessionQuery.data?.timezone ?? null}
            onTaskOpen={(taskId) =>
              void navigate({
                pathname: `/tasks/${taskId}`,
                search: '?group=all'
              })
            }
            onTaskComplete={(task) => {
              completeMutation.mutate(task)
            }}
            onTaskPrepareOpen={prefetchTaskDetail}
            onTaskDelete={(task) => {
              setPendingDeleteTask(task)
            }}
            busyTaskIds={pendingTaskIds}
          />
        ) : (
          <>
            {tasksQuery.isLoading ? (
              <div className="rounded-card bg-surface-container p-6 text-sm text-on-surface-variant">
                Loading open tasks.
              </div>
            ) : null}

            {tasksQuery.data && openTaskItems.length === 0 ? (
              <div className="rounded-soft bg-surface-container p-6 shadow-ambient">
                <p className="font-display text-2xl text-on-surface">No open tasks here</p>
                <p className="mt-3 font-body text-sm leading-6 text-on-surface-variant">
                  Capture a voice note or move tasks into this group from detail editing.
                </p>
              </div>
            ) : null}

            <div className="space-y-4">
              {bucketSections.map((section) => {
                const items = openTaskItems.filter((task) => task.due_bucket === section.key)
                if (items.length === 0) {
                  return null
                }

                return (
                  <section key={section.key} className="space-y-3">
                    <div className="flex items-center justify-between">
                      <h3 className="font-display text-xl text-on-surface">{section.label}</h3>
                      <span className="font-body text-xs uppercase tracking-[0.1em] text-on-surface-variant">
                        {items.length} tasks
                      </span>
                    </div>

                    <div className="space-y-3">
                      {items.map((task) => (
                        <SwipeTaskCard
                          key={task.id}
                          task={task}
                          isBusy={pendingTaskIds.includes(task.id)}
                          onPrepareOpen={prefetchTaskDetail}
                          onOpen={(taskId) =>
                            void navigate({
                              pathname: `/tasks/${taskId}`,
                              search: resolvedGroupId ? `?group=${resolvedGroupId}` : ''
                            })
                          }
                          onComplete={(taskId) => {
                            const current = openTaskItems.find((item) => item.id === taskId)
                            if (current) {
                              completeMutation.mutate(current)
                            }
                          }}
                          onDelete={(task) => {
                            setPendingDeleteTask(task)
                          }}
                        />
                      ))}
                    </div>
                  </section>
                )
              })}
            </div>
          </>
        )}
        <div className="mt-8 mb-20 flex justify-center pb-8">
          <Link
            to={{
              pathname: '/tasks/completed',
              search: effectiveGroupId ? `?group=${effectiveGroupId}` : ''
            }}
            className="inline-flex items-center gap-2 rounded-pill border border-outline/20 bg-surface-container px-4 py-2 text-sm font-medium text-on-surface-variant transition-all hover:bg-surface-container-high hover:text-on-surface hover:shadow-ambient"
          >
            View Completed Tasks
          </Link>
        </div>
      </section>

      <button
        type="button"
        onClick={() => setIsAddTaskModalOpen(true)}
        className="group fixed bottom-6 right-6 z-50 flex h-14 w-14 items-center justify-center rounded-full bg-[radial-gradient(circle_at_top,_#c4b5fd_10%,_#7c3aed_90%)] text-white shadow-[0_8px_0_#4c1d95,_0_15px_20px_rgba(0,0,0,0.4),_inset_0_2px_3px_rgba(255,255,255,0.6)] hover:-translate-y-[2px] hover:shadow-[0_10px_0_#4c1d95,_0_18px_24px_rgba(0,0,0,0.4),_inset_0_2px_3px_rgba(255,255,255,0.6)] active:translate-y-[8px] active:shadow-[0_0px_0_#4c1d95,_0_4px_8px_rgba(0,0,0,0.4),_inset_0_4px_8px_rgba(0,0,0,0.3)] transition-all duration-200 outline-none select-none"
        aria-label="Add Task"
      >
        <div className="flex items-center justify-center transition-all duration-200 drop-shadow-md">
          <svg className="h-6 w-6 text-white/95" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M12 4v16m8-8H4" />
          </svg>
        </div>
      </button>

      <EditExtractedTaskModal
        task={null}
        groups={groupsQuery.data ?? []}
        isOpen={isAddTaskModalOpen}
        onClose={() => setIsAddTaskModalOpen(false)}
        onSave={async () => {
          // Refresh task data after creation
          await refreshTaskData()
        }}
        csrfToken={sessionQuery.data?.csrf_token ?? ''}
        defaultGroupId={resolvedGroupId ?? sessionQuery.data?.inbox_group_id ?? undefined}
      />

      <TaskDeleteDialog
        isOpen={pendingDeleteTask !== null}
        taskTitle={pendingDeleteTask?.title ?? ''}
        isRecurring={Boolean(pendingDeleteTask?.series_id || pendingDeleteTask?.recurrence_frequency)}
        isDeleting={deleteTaskMutation.isPending}
        onDeleteOccurrence={() => {
          if (!pendingDeleteTask) {
            return
          }
          deleteTaskMutation.mutate({ task: pendingDeleteTask, scope: 'occurrence' })
        }}
        onDeleteSeries={() => {
          if (!pendingDeleteTask) {
            return
          }
          deleteTaskMutation.mutate({ task: pendingDeleteTask, scope: 'series' })
        }}
        onClose={() => setPendingDeleteTask(null)}
      />
    </SessionGuard>
  )
}
