import { getAppConfig } from './config'

export type SessionStatus = {
  signed_in: boolean
  user: {
    id: string
    email: string
    display_name: string | null
  } | null
  timezone: string | null
  inbox_group_id: string | null
  csrf_token: string | null
}

export type CaptureReviewResponse = {
  capture_id: string
  status: string
  transcript_text: string
}

export type SubmitCaptureResponse = {
  capture_id: string
  status: string
  tasks_created_count: number
  tasks_flagged_for_review_count: number
  tasks_skipped_count: number
  zero_actionable: boolean
  skipped_items: Array<{
    code: string
    message: string
    title: string | null
  }>
}

export type GroupSummary = {
  id: string
  name: string
  description: string | null
  is_system: boolean
  system_key: string | null
  open_task_count: number
}

export type TaskGroupRef = {
  id: string
  name: string
  is_system: boolean
}

export type TaskRecurrence = {
  frequency: 'daily' | 'weekly' | 'monthly'
  weekday: number | null
  day_of_month: number | null
}

export type TaskSubtask = {
  id: string
  title: string
  is_completed: boolean
  completed_at: string | null
}

export type TaskSummary = {
  id: string
  title: string
  description: string | null
  series_id?: string | null
  recurrence_frequency?: 'daily' | 'weekly' | 'monthly' | null
  status: 'open' | 'completed'
  needs_review: boolean
  due_date: string | null
  reminder_at: string | null
  due_bucket: 'overdue' | 'due_soon' | 'no_date'
  group: TaskGroupRef
  completed_at: string | null
  deleted_at: string | null
  subtask_count: number
}

export type TaskDetail = TaskSummary & {
  recurrence: TaskRecurrence | null
  subtasks: TaskSubtask[]
}

export type TaskDeleteScope = 'occurrence' | 'series'

export type ExtractedTask = {
  id: string
  capture_id: string
  title: string
  description: string | null
  group_id: string
  group_name: string | null
  due_date: string | null
  reminder_at: string | null
  recurrence_frequency: string | null
  recurrence_weekday: number | null
  recurrence_day_of_month: number | null
  top_confidence: number
  needs_review: boolean
  status: 'pending' | 'approved' | 'discarded'
  created_at: string
  updated_at: string
}

type ApiErrorPayload = {
  request_id?: string
  error?: {
    code?: string
    message?: string
  }
}

export class ApiError extends Error {
  code: string
  status: number
  requestId: string | null

  constructor(message: string, code: string, status: number, requestId: string | null = null) {
    super(message)
    this.name = 'ApiError'
    this.code = code
    this.status = status
    this.requestId = requestId
  }
}

async function apiRequest<T>(
  path: string,
  init: RequestInit = {},
  csrfToken?: string | null
): Promise<T> {
  const config = getAppConfig()
  const headers = new Headers(init.headers)

  if (csrfToken) {
    headers.set('X-CSRF-Token', csrfToken)
  }

  if (init.body && !(init.body instanceof FormData) && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json')
  }

  const response = await fetch(`${config.apiBaseUrl}${path}`, {
    ...init,
    headers,
    credentials: 'include'
  })

  const isJson = response.headers.get('content-type')?.includes('application/json') ?? false
  const payload = isJson ? ((await response.json()) as T | ApiErrorPayload) : null

  if (!response.ok) {
    const errorPayload = payload as ApiErrorPayload | null
    const requestId =
      (typeof errorPayload?.request_id === 'string' ? errorPayload.request_id : null) ??
      response.headers.get('X-Request-ID')
    throw new ApiError(
      errorPayload?.error?.message ?? 'Request failed.',
      errorPayload?.error?.code ?? 'request_failed',
      response.status,
      requestId
    )
  }

  return payload as T
}

export function getAuthStartUrl(): string {
  return `${getAppConfig().apiBaseUrl}/auth/session/google/start`
}

export function getSessionStatus(): Promise<SessionStatus> {
  return apiRequest<SessionStatus>('/auth/session')
}

export function signInWithLocalDevAccount(): Promise<SessionStatus> {
  return apiRequest<SessionStatus>('/auth/session/dev-login', { method: 'POST' })
}

export function logoutSession(csrfToken: string): Promise<{ signed_out: boolean }> {
  return apiRequest<{ signed_out: boolean }>(
    '/auth/session/logout',
    { method: 'POST' },
    csrfToken
  )
}

export function createTextCapture(
  text: string,
  csrfToken: string
): Promise<CaptureReviewResponse> {
  return apiRequest<CaptureReviewResponse>(
    '/captures/text',
    {
      method: 'POST',
      body: JSON.stringify({ text })
    },
    csrfToken
  )
}

export function createVoiceCapture(
  blob: Blob,
  filename: string,
  csrfToken: string
): Promise<CaptureReviewResponse> {
  const formData = new FormData()
  formData.append('audio', blob, filename)

  return apiRequest<CaptureReviewResponse>(
    '/captures/voice',
    {
      method: 'POST',
      body: formData
    },
    csrfToken
  )
}

export function submitCapture(
  captureId: string,
  transcriptText: string,
  csrfToken: string
): Promise<SubmitCaptureResponse> {
  return apiRequest<SubmitCaptureResponse>(
    `/captures/${captureId}/submit`,
    {
      method: 'POST',
      body: JSON.stringify({ transcript_text: transcriptText })
    },
    csrfToken
  )
}

export function listGroups(): Promise<GroupSummary[]> {
  return apiRequest<GroupSummary[]>('/groups')
}

export function createGroup(
  payload: { name: string; description: string | null },
  csrfToken: string
): Promise<GroupSummary> {
  return apiRequest<GroupSummary>(
    '/groups',
    {
      method: 'POST',
      body: JSON.stringify(payload)
    },
    csrfToken
  )
}

export function updateGroup(
  groupId: string,
  payload: { name?: string; description?: string | null },
  csrfToken: string
): Promise<GroupSummary> {
  return apiRequest<GroupSummary>(
    `/groups/${groupId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload)
    },
    csrfToken
  )
}

export function deleteGroup(
  groupId: string,
  destinationGroupId: string,
  csrfToken: string
): Promise<{ deleted: boolean }> {
  return apiRequest<{ deleted: boolean }>(
    `/groups/${groupId}`,
    {
      method: 'DELETE',
      body: JSON.stringify({ destination_group_id: destinationGroupId })
    },
    csrfToken
  )
}

export type PaginatedTasksResponse = {
  items: TaskSummary[]
  has_more: boolean
  next_cursor: string | null
}

export function listTasks(
  groupId: string,
  statusValue: 'open' | 'completed' = 'open',
  cursor: string | null = null,
  limit: number = 50
): Promise<PaginatedTasksResponse> {
  const params = new URLSearchParams({
    group_id: groupId,
    status: statusValue,
    limit: limit.toString()
  })
  if (cursor) {
    params.set('cursor', cursor)
  }
  return apiRequest<PaginatedTasksResponse>(`/tasks?${params.toString()}`)
}

export function listAllTasks(
  statusValue: 'open' | 'completed' = 'open',
  cursor: string | null = null,
  limit: number = 50
): Promise<PaginatedTasksResponse> {
  const params = new URLSearchParams({
    status: statusValue,
    limit: limit.toString()
  })
  if (cursor) {
    params.set('cursor', cursor)
  }
  return apiRequest<PaginatedTasksResponse>(`/tasks?${params.toString()}`)
}

export function getTaskDetail(taskId: string): Promise<TaskDetail> {
  return apiRequest<TaskDetail>(`/tasks/${taskId}`)
}

export function updateTask(
  taskId: string,
  payload: {
    title: string
    description: string | null
    group_id: string
    due_date: string | null
    reminder_at: string | null
    recurrence: TaskRecurrence | null
  },
  csrfToken: string
): Promise<TaskDetail> {
  return apiRequest<TaskDetail>(
    `/tasks/${taskId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload)
    },
    csrfToken
  )
}

export function createTask(
  payload: {
    title: string
    description: string | null
    group_id: string
    due_date: string | null
    reminder_at: string | null
    recurrence: TaskRecurrence | null
  },
  csrfToken: string
): Promise<TaskDetail> {
  return apiRequest<TaskDetail>(
    '/tasks',
    {
      method: 'POST',
      body: JSON.stringify(payload)
    },
    csrfToken
  )
}

export function completeTask(taskId: string, csrfToken: string): Promise<TaskDetail> {
  return apiRequest<TaskDetail>(
    `/tasks/${taskId}/complete`,
    { method: 'POST' },
    csrfToken
  )
}

export function reopenTask(taskId: string, csrfToken: string): Promise<TaskDetail> {
  return apiRequest<TaskDetail>(
    `/tasks/${taskId}/reopen`,
    { method: 'POST' },
    csrfToken
  )
}

export function deleteTask(
  taskId: string,
  csrfToken: string,
  scope: TaskDeleteScope = 'occurrence'
): Promise<TaskDetail> {
  const params = new URLSearchParams({ scope })
  return apiRequest<TaskDetail>(
    `/tasks/${taskId}?${params.toString()}`,
    { method: 'DELETE' },
    csrfToken
  )
}

export function restoreTask(taskId: string, csrfToken: string): Promise<TaskDetail> {
  return apiRequest<TaskDetail>(
    `/tasks/${taskId}/restore`,
    { method: 'POST' },
    csrfToken
  )
}

export function createSubtask(
  taskId: string,
  title: string,
  csrfToken: string
): Promise<TaskSubtask> {
  return apiRequest<TaskSubtask>(
    `/tasks/${taskId}/subtasks`,
    {
      method: 'POST',
      body: JSON.stringify({ title })
    },
    csrfToken
  )
}

export function updateSubtask(
  taskId: string,
  subtaskId: string,
  payload: { title?: string; is_completed?: boolean },
  csrfToken: string
): Promise<TaskSubtask> {
  return apiRequest<TaskSubtask>(
    `/tasks/${taskId}/subtasks/${subtaskId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(payload)
    },
    csrfToken
  )
}

export function deleteSubtask(
  taskId: string,
  subtaskId: string,
  csrfToken: string
): Promise<{ deleted: boolean }> {
  return apiRequest<{ deleted: boolean }>(
    `/tasks/${taskId}/subtasks/${subtaskId}`,
    { method: 'DELETE' },
    csrfToken
  )
}

export function listExtractedTasks(captureId: string): Promise<ExtractedTask[]> {
  return apiRequest<ExtractedTask[]>(`/captures/${captureId}/extracted-tasks`)
}

export function listPendingTasks(): Promise<ExtractedTask[]> {
  return apiRequest<ExtractedTask[]>('/captures/pending-tasks')
}

export function approveExtractedTask(
  captureId: string,
  taskId: string,
  csrfToken: string
): Promise<TaskDetail> {
  return apiRequest<TaskDetail>(
    `/captures/${captureId}/extracted-tasks/${taskId}/approve`,
    { method: 'POST' },
    csrfToken
  )
}

export function discardExtractedTask(
  captureId: string,
  taskId: string,
  csrfToken: string
): Promise<{ success: boolean }> {
  return apiRequest<{ success: boolean }>(
    `/captures/${captureId}/extracted-tasks/${taskId}/discard`,
    { method: 'POST' },
    csrfToken
  )
}

export function approveAllExtractedTasks(
  captureId: string,
  csrfToken: string
): Promise<{ approved_count: number }> {
  return apiRequest<{ approved_count: number }>(
    `/captures/${captureId}/extracted-tasks/approve-all`,
    { method: 'POST' },
    csrfToken
  )
}

export function discardAllExtractedTasks(
  captureId: string,
  csrfToken: string
): Promise<{ discarded_count: number }> {
  return apiRequest<{ discarded_count: number }>(
    `/captures/${captureId}/extracted-tasks/discard-all`,
    { method: 'POST' },
    csrfToken
  )
}

export function reExtractCapture(
  captureId: string,
  transcriptText: string,
  csrfToken: string
): Promise<CaptureReviewResponse> {
  return apiRequest<CaptureReviewResponse>(
    `/captures/${captureId}/re-extract`,
    {
      method: 'POST',
      body: JSON.stringify({ transcript_text: transcriptText })
    },
    csrfToken
  )
}

export function completeCapture(
  captureId: string,
  csrfToken: string
): Promise<{ status: string }> {
  return apiRequest<{ status: string }>(
    `/captures/${captureId}/complete`,
    { method: 'POST' },
    csrfToken
  )
}

export function updateExtractedTaskDueDate(
  captureId: string,
  taskId: string,
  dueDate: string | null,
  csrfToken: string
): Promise<ExtractedTask> {
  return apiRequest<ExtractedTask>(
    `/captures/${captureId}/extracted-tasks/${taskId}`,
    {
      method: 'PATCH',
      body: JSON.stringify({ due_date: dueDate })
    },
    csrfToken
  )
}

export type ExtractedTaskUpdates = {
  title?: string
  description?: string | null
  group_id?: string
  due_date?: string | null
  reminder_at?: string | null
  recurrence_frequency?: string | null
  recurrence_weekday?: number | null
  recurrence_day_of_month?: number | null
}

export function updateExtractedTask(
  captureId: string,
  taskId: string,
  updates: ExtractedTaskUpdates,
  csrfToken: string
): Promise<ExtractedTask> {
  return apiRequest<ExtractedTask>(
    `/captures/${captureId}/extracted-tasks/${taskId}`,
    {
      method: 'PATCH',
      body: JSON.stringify(updates)
    },
    csrfToken
  )
}
