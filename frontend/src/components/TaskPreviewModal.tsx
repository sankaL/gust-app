import { useEffect } from 'react'
import { RotateCcw, Trash2, X, CheckCircle2 } from 'lucide-react'
import { useQuery } from '@tanstack/react-query'

import { ApiError, getTaskDetail, type TaskDetail } from '../lib/api'
import {
  TASK_SCREEN_GC_TIME_MS,
  TASK_SCREEN_STALE_TIME_MS,
} from '../lib/taskScreenCache'

type TaskPreviewModalProps = {
  taskId: string | null
  isOpen: boolean
  onClose: () => void
  onComplete?: (task: TaskDetail) => void
  onRestore?: (task: TaskDetail) => void
  onRequestDelete?: (task: TaskDetail) => void
  busyTaskIds?: string[]
}

function buildFriendlyMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message
  }

  if (error instanceof Error) {
    return error.message
  }

  return fallback
}

function formatDate(value: string | null) {
  if (!value) {
    return 'No due date'
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
  }).format(new Date(`${value}T12:00:00`))
}

function formatDateTime(value: string | null) {
  if (!value) {
    return null
  }

  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return null
  }

  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    year: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

function formatRecurrence(task: TaskDetail) {
  if (!task.recurrence_frequency) {
    return 'One-off'
  }

  return task.recurrence_frequency.charAt(0).toUpperCase() + task.recurrence_frequency.slice(1)
}

function formatSubtaskCount(count: number) {
  return `${count} ${count === 1 ? 'subtask' : 'subtasks'}`
}

function MetadataTile({ label, value }: { label: string; value: string }) {
  return (
    <div className="min-w-0 rounded-[1.2rem] bg-black/20 p-3 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] backdrop-blur-sm">
      <p className="text-[0.62rem] font-semibold uppercase tracking-[0.15em] text-on-surface-variant">
        {label}
      </p>
      <p className="mt-2 truncate font-body text-sm font-medium text-on-surface">{value}</p>
    </div>
  )
}

export function TaskPreviewModal({
  taskId,
  isOpen,
  onClose,
  onComplete,
  onRestore,
  onRequestDelete,
  busyTaskIds = [],
}: TaskPreviewModalProps) {
  const taskQuery = useQuery({
    queryKey: ['task-detail', taskId],
    queryFn: () => getTaskDetail(taskId as string),
    enabled: isOpen && Boolean(taskId),
    staleTime: TASK_SCREEN_STALE_TIME_MS,
    gcTime: TASK_SCREEN_GC_TIME_MS,
  })

  useEffect(() => {
    if (!isOpen) {
      return undefined
    }

    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        onClose()
      }
    }

    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onClose])

  if (!isOpen || !taskId) {
    return null
  }

  const task = taskQuery.data
  const isBusy = task ? busyTaskIds.includes(task.id) : false
  const completedLabel = task ? formatDateTime(task.completed_at) : null
  const reminderLabel = task ? formatDateTime(task.reminder_at) : null

  return (
    <div
      className="fixed inset-0 z-[120] flex items-end justify-center bg-black/65 p-3 backdrop-blur-md sm:items-center sm:p-5"
      role="dialog"
      aria-modal="true"
      aria-labelledby="task-preview-title"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) {
          onClose()
        }
      }}
    >
      <div className="max-h-[92dvh] w-full max-w-2xl overflow-hidden rounded-[1.7rem] bg-[radial-gradient(circle_at_top_left,_rgba(186,158,255,0.18),_rgba(32,32,31,0.98)_42%,_rgba(14,14,14,1)_100%)] shadow-[0_28px_80px_rgba(0,0,0,0.62)]">
        <div className="flex max-h-[92dvh] flex-col">
          <div className="flex items-start justify-between gap-4 p-5 pb-3 sm:p-6 sm:pb-4">
            <div className="min-w-0 space-y-2">
              <div className="flex flex-wrap items-center gap-2">
                <span className="rounded-pill bg-white/6 px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">
                  Task preview
                </span>
                {task ? (
                  <>
                    <span className="rounded-pill bg-surface-container-high px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">
                      {task.status === 'completed' ? 'Completed' : 'Open'}
                    </span>
                    <span className="max-w-[12rem] truncate rounded-pill bg-surface-container-high px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">
                      {task.group.name}
                    </span>
                    {task.needs_review ? (
                      <span className="rounded-pill bg-warning/20 px-3 py-1 text-[0.62rem] font-semibold uppercase tracking-[0.16em] text-warning">
                        Needs review
                      </span>
                    ) : null}
                  </>
                ) : null}
              </div>
              <h2
                id="task-preview-title"
                className="font-display text-2xl leading-tight text-on-surface sm:text-3xl"
              >
                {task?.title ?? 'Loading task'}
              </h2>
            </div>
            <button
              type="button"
              onClick={onClose}
              className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-white/8 text-on-surface-variant transition hover:bg-white/12 hover:text-on-surface active:scale-[0.98]"
              aria-label="Close task preview"
            >
              <X className="h-4 w-4" strokeWidth={2} />
            </button>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto px-5 pb-4 sm:px-6">
            {taskQuery.isLoading ? (
              <div className="space-y-3 py-3" aria-busy="true">
                <div className="h-20 animate-pulse rounded-card bg-surface-container-high" />
                <div className="grid gap-3 sm:grid-cols-2">
                  <div className="h-20 animate-pulse rounded-card bg-surface-container-high" />
                  <div className="h-20 animate-pulse rounded-card bg-surface-container-high" />
                </div>
                <div className="h-28 animate-pulse rounded-card bg-surface-container-high" />
              </div>
            ) : taskQuery.isError ? (
              <div className="rounded-card bg-[rgba(80,18,18,0.92)] p-4 text-sm leading-6 text-red-100 shadow-[0_18px_36px_rgba(0,0,0,0.4)]">
                {buildFriendlyMessage(taskQuery.error, 'Task preview could not be loaded.')}
              </div>
            ) : task ? (
              <div className="space-y-4">
                <div className="grid min-w-0 gap-3 sm:grid-cols-2">
                  <MetadataTile label="Due date" value={formatDate(task.due_date)} />
                  <MetadataTile label="Reminder" value={reminderLabel ?? 'No reminder'} />
                  <MetadataTile label="Recurrence" value={formatRecurrence(task)} />
                  {completedLabel ? (
                    <MetadataTile label="Completed" value={completedLabel} />
                  ) : (
                    <MetadataTile label="Subtasks" value={formatSubtaskCount(task.subtasks.length)} />
                  )}
                </div>

                <section className="rounded-[1.25rem] bg-surface/45 p-4 shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)]">
                  <p className="text-[0.65rem] font-semibold uppercase tracking-[0.15em] text-on-surface-variant">
                    Context
                  </p>
                  <p className="mt-3 font-body text-sm leading-6 text-on-surface-variant">
                    {task.description ||
                      'No description yet. Open the full page to add more context before acting on this task.'}
                  </p>
                </section>

                <section className="rounded-[1.25rem] bg-surface-container/90 p-4 shadow-ambient">
                  <div className="flex items-center justify-between gap-3">
                    <div>
                      <p className="font-display text-lg text-on-surface">Checklist</p>
                      <p className="mt-1 font-body text-xs text-on-surface-variant">
                        {formatSubtaskCount(task.subtasks.length)}
                      </p>
                    </div>
                    <span className="rounded-pill bg-surface-container-high px-3 py-1 text-[0.68rem] uppercase tracking-[0.12em] text-on-surface-variant">
                      {task.subtasks.filter((subtask) => subtask.is_completed).length} done
                    </span>
                  </div>

                  <div className="mt-3 space-y-2">
                    {task.subtasks.length === 0 ? (
                      <div className="rounded-card bg-surface-dim px-4 py-4 text-sm text-on-surface-variant">
                        No subtasks yet.
                      </div>
                    ) : (
                      task.subtasks.map((subtask) => (
                        <div key={subtask.id} className="flex items-start gap-3 rounded-card bg-surface-dim p-3">
                          <span
                            className={[
                              'mt-0.5 h-4 w-4 rounded-pill',
                              subtask.is_completed ? 'bg-primary' : 'bg-surface-container-high ring-1 ring-white/15',
                            ].join(' ')}
                            aria-hidden="true"
                          />
                          <p
                            className={[
                              'min-w-0 flex-1 font-body text-sm leading-5',
                              subtask.is_completed
                                ? 'text-on-surface-variant line-through'
                                : 'text-on-surface',
                            ].join(' ')}
                          >
                            {subtask.title}
                          </p>
                        </div>
                      ))
                    )}
                  </div>
                </section>
              </div>
            ) : null}
          </div>

          <div className="border-t border-white/10 bg-[rgba(20,20,20,0.86)] p-3 backdrop-blur-xl sm:p-4">
            <div className="grid gap-2 sm:grid-cols-[1fr_auto_auto]">
              <button
                type="button"
                onClick={onClose}
                className="rounded-pill bg-white/5 px-4 py-3 text-sm font-medium text-on-surface transition hover:bg-white/10 active:scale-[0.98]"
              >
                Close
              </button>

              {task?.status === 'open' && onComplete ? (
                <button
                  type="button"
                  onClick={() => onComplete(task)}
                  disabled={isBusy}
                  className="inline-flex items-center justify-center gap-2 rounded-pill bg-success/20 px-4 py-3 text-sm font-semibold text-success transition hover:bg-success/30 active:scale-[0.98] disabled:opacity-50"
                >
                  <CheckCircle2 className="h-4 w-4" strokeWidth={2} />
                  Complete
                </button>
              ) : null}

              {task?.status === 'completed' && onRestore ? (
                <button
                  type="button"
                  onClick={() => onRestore(task)}
                  disabled={isBusy}
                  className="inline-flex items-center justify-center gap-2 rounded-pill bg-surface-container-high px-4 py-3 text-sm font-semibold text-on-surface-variant transition hover:bg-surface-container-highest hover:text-on-surface active:scale-[0.98] disabled:opacity-50"
                >
                  <RotateCcw className="h-4 w-4" strokeWidth={2} />
                  Restore
                </button>
              ) : null}

              {task && onRequestDelete ? (
                <button
                  type="button"
                  onClick={() => onRequestDelete(task)}
                  disabled={isBusy}
                  className="inline-flex items-center justify-center gap-2 rounded-pill border border-tertiary/35 bg-tertiary/10 px-4 py-3 text-sm font-semibold text-tertiary transition hover:bg-tertiary/15 active:scale-[0.98] disabled:opacity-50"
                >
                  <Trash2 className="h-4 w-4" strokeWidth={2} />
                  Delete
                </button>
              ) : null}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
