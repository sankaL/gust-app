import { useCallback, useEffect, useState } from 'react'
import { useQueryClient } from '@tanstack/react-query'
import { useAppShellActions } from '../components/AppShellActions'
import { useNotifications } from '../components/Notifications'
import { TaskScreenRefreshButton } from '../components/TaskScreenRefresh'
import { TasksRouteView } from '../components/TasksRouteView'
import { useOpenTaskActions } from '../hooks/useOpenTaskActions'
import { useOpenTaskRouteQueries } from '../hooks/useTaskRouteQueries'
import { useTaskListRouteState } from '../hooks/useTaskListRouteState'
import { type TaskSummary } from '../lib/api'
import { refreshTaskScreenQueries } from '../lib/taskScreenCache'

function normalizeTaskItems(data: unknown): TaskSummary[] {
  if (Array.isArray(data)) return data as TaskSummary[]
  if (data && typeof data === 'object' && 'items' in data && Array.isArray((data as { items?: unknown }).items)) return (data as { items: TaskSummary[] }).items
  return []
}

function useDefaultTaskGroup({ signedIn, selectedGroupId, searchParams, setSearchParams }: {
  signedIn: boolean
  selectedGroupId: string | null
  searchParams: URLSearchParams
  setSearchParams: ReturnType<typeof useTaskListRouteState>['setSearchParams']
}) {
  useEffect(() => {
    if (!signedIn || selectedGroupId) return
    const next = new URLSearchParams(searchParams)
    next.set('group', 'all')
    setSearchParams(next, { replace: true })
  }, [searchParams, selectedGroupId, setSearchParams, signedIn])
}

function useTasksRefreshButton(shellActions: ReturnType<typeof useAppShellActions>, enabled: boolean, isRefreshing: boolean, refresh: () => Promise<void>) {
  useEffect(() => {
    if (!enabled) return
    shellActions?.setTopBarAction(<TaskScreenRefreshButton isRefreshing={isRefreshing} label="Refresh tasks" onRefresh={refresh} />)
    return () => shellActions?.setTopBarAction(null)
  }, [enabled, isRefreshing, refresh, shellActions])
}

export function TasksRoute() {
  const queryClient = useQueryClient()
  const shellActions = useAppShellActions()
  const routeState = useTaskListRouteState(queryClient)
  const [pendingDeleteTask, setPendingDeleteTask] = useState<TaskSummary | null>(null)
  const notifications = useNotifications()
  const selectedGroupId = routeState.searchParams.get('group')
  const data = useOpenTaskRouteQueries(selectedGroupId, routeState.debouncedSearchQuery)
  const { session: sessionQuery, groups: groupsQuery, tasks: tasksQuery, effectiveGroupId, isAllView, resolvedGroupId, isRefreshing } = data

  useDefaultTaskGroup({ signedIn: sessionQuery.data?.signed_in === true, selectedGroupId, searchParams: routeState.searchParams, setSearchParams: routeState.setSearchParams })

  const refreshCurrentTasks = useCallback(() => refreshTaskScreenQueries(queryClient, { groupIds: [resolvedGroupId], statuses: ['open'], includeAllOpen: true }), [queryClient, resolvedGroupId])
  const actions = useOpenTaskActions({
    queryClient,
    session: sessionQuery.data,
    markTaskPending: routeState.markTaskPending,
    notifications: {
      dismiss: notifications.dismissNotification,
      error: notifications.notifyError,
      success: notifications.notifySuccess,
      show: notifications.showNotification,
      update: notifications.updateNotification,
    },
    onDeleteFinished: () => setPendingDeleteTask(null),
  })

  useTasksRefreshButton(shellActions, !isAllView, isRefreshing, refreshCurrentTasks)

  const tasks = normalizeTaskItems(tasksQuery.data)
  function closePreviewAndComplete(task: TaskSummary) {
    actions.complete(task)
    routeState.closeTaskPreview()
  }
  function closePreviewAndDelete(task: TaskSummary) {
    setPendingDeleteTask(task)
    routeState.closeTaskPreview()
  }
  function deleteOccurrence() {
    if (pendingDeleteTask) actions.delete(pendingDeleteTask, 'occurrence')
  }
  function deleteSeries() {
    if (pendingDeleteTask) actions.delete(pendingDeleteTask, 'series')
  }

  const isSearchPending = routeState.isSearchActive && (
    routeState.searchQuery.trim() !== routeState.debouncedSearchQuery ||
    (!isAllView && tasksQuery.isFetching && Boolean(routeState.debouncedSearchQuery))
  )

  return <TasksRouteView session={sessionQuery.data} isSessionLoading={sessionQuery.isLoading} isSessionError={sessionQuery.isError} groups={groupsQuery.data ?? []} effectiveGroupId={effectiveGroupId} isAllView={isAllView} tasks={tasks} isTasksLoading={tasksQuery.isLoading} isTasksError={tasksQuery.isError} hasTaskResult={tasksQuery.data !== undefined} isRefreshing={isRefreshing} searchQuery={routeState.searchQuery} requestSearchQuery={routeState.debouncedSearchQuery} isSearchActive={routeState.isSearchActive} isSearchPending={isSearchPending} pendingTaskIds={routeState.pendingTaskIds} selectedTaskId={routeState.selectedTaskId} pendingDeleteTask={pendingDeleteTask} isDeleting={actions.isDeleting} refresh={refreshCurrentTasks} retryTasks={() => { void tasksQuery.refetch() }} onSelectGroup={(groupId) => routeState.setSearchParams({ group: groupId })} onSearchOpen={routeState.openTaskSearch} onSearchChange={routeState.setTaskSearchQuery} onSearchClear={routeState.clearTaskSearch} onOpen={routeState.openTaskPreview} onPrepareOpen={routeState.prefetchTaskDetail} onComplete={actions.complete} onDeleteRequest={setPendingDeleteTask} onDeleteOccurrence={deleteOccurrence} onDeleteSeries={deleteSeries} onCloseDelete={() => setPendingDeleteTask(null)} onClosePreview={routeState.closeTaskPreview} onPreviewComplete={closePreviewAndComplete} onPreviewDelete={closePreviewAndDelete} />
}
