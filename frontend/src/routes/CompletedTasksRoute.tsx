import { useCallback, useEffect } from 'react'
import { useQueryClient } from '@tanstack/react-query'

import { CompletedTasksRouteView } from '../components/CompletedTasksRouteView'
import { useAppShellActions } from '../components/AppShellActions'
import { useNotifications } from '../components/Notifications'
import { TaskScreenRefreshButton } from '../components/TaskScreenRefresh'
import { useCompletedTaskRestore } from '../hooks/useCompletedTaskRestore'
import { useCompletedTaskRouteQueries } from '../hooks/useTaskRouteQueries'
import { useTaskListRouteState } from '../hooks/useTaskListRouteState'
import type { TaskSummary } from '../lib/api'
import { dedupeCompletedTasks } from '../lib/desktopData'
import {
  refreshTaskScreenQueries,
} from '../lib/taskScreenCache'

function useDefaultCompletedGroup({ signedIn, groups, inboxGroupId, selectedGroupId, searchParams, setSearchParams }: {
  signedIn: boolean
  groups: Array<{ id: string }>
  inboxGroupId?: string | null
  selectedGroupId: string | null
  searchParams: URLSearchParams
  setSearchParams: ReturnType<typeof useTaskListRouteState>['setSearchParams']
}) {
  useEffect(() => {
    if (!signedIn || groups.length === 0 || selectedGroupId) return
    const next = new URLSearchParams(searchParams)
    next.set('group', inboxGroupId ?? groups[0].id)
    setSearchParams(next, { replace: true })
  }, [groups, inboxGroupId, searchParams, selectedGroupId, setSearchParams, signedIn])
}

function useCompletedRefreshButton(shellActions: ReturnType<typeof useAppShellActions>, isRefreshing: boolean, refresh: () => Promise<void>) {
  useEffect(() => {
    shellActions?.setTopBarAction(<TaskScreenRefreshButton isRefreshing={isRefreshing} label="Refresh completed tasks" onRefresh={refresh} />)
    return () => shellActions?.setTopBarAction(null)
  }, [isRefreshing, refresh, shellActions])
}

export function CompletedTasksRoute() {
  const queryClient = useQueryClient()
  const shellActions = useAppShellActions()
  const { searchParams, setSearchParams, selectedTaskId, pendingTaskIds, markTaskPending, openTaskPreview, closeTaskPreview } = useTaskListRouteState(queryClient)
  const { notifyError, notifySuccess } = useNotifications()
  const selectedGroupId = searchParams.get('group')
  const data = useCompletedTaskRouteQueries(selectedGroupId)
  const { session: sessionQuery, groups: groupsQuery, tasks: completedTasksQuery, isAllView: isAllGroupsView, resolvedGroupId, isRefreshing } = data

  useDefaultCompletedGroup({ signedIn: sessionQuery.data?.signed_in === true, groups: groupsQuery.data ?? [], inboxGroupId: sessionQuery.data?.inbox_group_id, selectedGroupId, searchParams, setSearchParams })

  const refreshCompletedTasks = useCallback(() => refreshTaskScreenQueries(queryClient, { groupIds: [resolvedGroupId], statuses: ['completed'], includeAllOpen: true, includeAllCompleted: true }), [queryClient, resolvedGroupId])
  const restore = useCompletedTaskRestore({ queryClient, session: sessionQuery.data, markTaskPending, onSuccess: notifySuccess, onError: notifyError, refresh: refreshCompletedTasks })

  useCompletedRefreshButton(shellActions, isRefreshing, refreshCompletedTasks)

  const rawTasks: TaskSummary[] = Array.isArray(completedTasksQuery.data) ? completedTasksQuery.data : completedTasksQuery.data?.items ?? []
  const tasks = dedupeCompletedTasks(rawTasks)
  return <CompletedTasksRouteView session={sessionQuery.data} groups={groupsQuery.data ?? []} tasks={tasks} selectedTaskId={selectedTaskId} pendingTaskIds={pendingTaskIds} restoreCandidate={restore.candidate} isSessionLoading={sessionQuery.isLoading} isSessionError={sessionQuery.isError} isAllGroupsView={isAllGroupsView} isTasksLoading={completedTasksQuery.isLoading} hasTaskResult={completedTasksQuery.data !== undefined} isRefreshing={isRefreshing} isRestoring={restore.isPending || Boolean(restore.candidate && pendingTaskIds.includes(restore.candidate.id))} refresh={refreshCompletedTasks} onOpen={openTaskPreview} onClosePreview={closeTaskPreview} onRequestRestore={restore.request} onConfirmRestore={restore.confirm} onCancelRestore={restore.cancel} />
}
