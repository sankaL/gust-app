import { ArrowDown, ArrowUp, CheckCircle2, RotateCcw } from 'lucide-react'
import { Link, useSearchParams } from 'react-router-dom'

import {
  EMPTY_DESKTOP_FILTERS,
  filterDesktopTasks,
  formatDateTimeLabel,
  formatIsoDateLabel,
  sortDesktopTasks,
  type DesktopSortKey,
  type DesktopSortState,
} from '../lib/desktopData'
import type { GroupSummary, TaskSummary } from '../lib/api'

type DesktopTaskTableProps = {
  title: string
  tasks: TaskSummary[]
  groups: GroupSummary[]
  status: 'open' | 'completed'
  lockedGroupId?: string
  busyTaskIds?: string[]
  onComplete?: (task: TaskSummary) => void
  onReopen?: (task: TaskSummary) => void
  onMoveDueDate?: (task: TaskSummary, dueDate: string | null) => void
}

const sortLabels: Record<DesktopSortKey, string> = {
  title: 'Title',
  group: 'Group',
  due_date: 'Due',
  created_at: 'Created',
  completed_at: 'Completed',
  review: 'Review',
  recurrence: 'Recurrence',
}

function getParam(searchParams: URLSearchParams, key: string, fallback: string) {
  return searchParams.get(key) ?? fallback
}

export function DesktopTaskTable({
  title,
  tasks,
  groups,
  status,
  lockedGroupId,
  busyTaskIds = [],
  onComplete,
  onReopen,
  onMoveDueDate,
}: DesktopTaskTableProps) {
  const [searchParams, setSearchParams] = useSearchParams()
  const filters = {
    ...EMPTY_DESKTOP_FILTERS,
    search: getParam(searchParams, 'q', ''),
    groupId: lockedGroupId ?? getParam(searchParams, 'group', 'all'),
    dueBucket: getParam(searchParams, 'bucket', 'all'),
    dueFrom: getParam(searchParams, 'from', ''),
    dueTo: getParam(searchParams, 'to', ''),
    review: getParam(searchParams, 'review', 'all'),
    recurrence: getParam(searchParams, 'recurrence', 'all'),
    subtasks: getParam(searchParams, 'subtasks', 'all'),
  }
  const sort: DesktopSortState = {
    key: (getParam(
      searchParams,
      'sort',
      status === 'completed' ? 'completed_at' : 'due_date'
    ) ?? 'due_date') as DesktopSortKey,
    direction: (getParam(searchParams, 'dir', status === 'completed' ? 'desc' : 'asc') === 'desc'
      ? 'desc'
      : 'asc'),
  }
  const visibleTasks = sortDesktopTasks(filterDesktopTasks(tasks, filters), sort)

  function updateParam(key: string, value: string) {
    const next = new URLSearchParams(searchParams)
    if (!value || value === EMPTY_DESKTOP_FILTERS[key as keyof typeof EMPTY_DESKTOP_FILTERS]) {
      next.delete(key)
    } else {
      next.set(key, value)
    }
    if (lockedGroupId && key === 'group') {
      next.delete('group')
    }
    setSearchParams(next)
  }

  function updateSort(key: DesktopSortKey) {
    const next = new URLSearchParams(searchParams)
    const nextDirection = sort.key === key && sort.direction === 'asc' ? 'desc' : 'asc'
    next.set('sort', key)
    next.set('dir', nextDirection)
    setSearchParams(next)
  }

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end justify-between gap-4">
        <div>
          <h2 className="font-display text-3xl tracking-tight text-on-surface">{title}</h2>
          <p className="mt-1 font-body text-sm text-on-surface-variant">
            {visibleTasks.length} of {tasks.length} tasks visible
          </p>
        </div>
        <Link
          to="/"
          className="rounded-pill bg-primary px-4 py-2 font-body text-sm font-semibold text-surface transition hover:-translate-y-0.5 active:translate-y-0"
        >
          Capture New
        </Link>
      </div>

      <div className="grid grid-cols-[minmax(16rem,2fr)_repeat(3,minmax(9rem,1fr))] gap-3 rounded-soft bg-surface-container p-3 max-xl:grid-cols-2 max-md:grid-cols-1">
        <label className="space-y-1">
          <span className="font-body text-[0.68rem] uppercase tracking-[0.16em] text-on-surface-variant">
            Search
          </span>
          <input
            value={filters.search}
            onChange={(event) => updateParam('q', event.target.value)}
            placeholder="Title, notes, or group"
            className="w-full rounded-card bg-surface-dim px-3 py-2 font-body text-sm text-on-surface outline-none ring-1 ring-white/10 transition focus:ring-primary"
          />
        </label>

        {!lockedGroupId ? (
          <label className="space-y-1">
            <span className="font-body text-[0.68rem] uppercase tracking-[0.16em] text-on-surface-variant">
              Group
            </span>
            <select
              value={filters.groupId}
              onChange={(event) => updateParam('group', event.target.value)}
              className="w-full rounded-card bg-surface-dim px-3 py-2 font-body text-sm text-on-surface outline-none ring-1 ring-white/10 transition focus:ring-primary"
            >
              <option value="all">All groups</option>
              {groups.map((group) => (
                <option key={group.id} value={group.id}>
                  {group.name}
                </option>
              ))}
            </select>
          </label>
        ) : null}

        {status === 'open' ? (
          <label className="space-y-1">
            <span className="font-body text-[0.68rem] uppercase tracking-[0.16em] text-on-surface-variant">
              Bucket
            </span>
            <select
              value={filters.dueBucket}
              onChange={(event) => updateParam('bucket', event.target.value)}
              className="w-full rounded-card bg-surface-dim px-3 py-2 font-body text-sm text-on-surface outline-none ring-1 ring-white/10 transition focus:ring-primary"
            >
              <option value="all">All buckets</option>
              <option value="overdue">Overdue</option>
              <option value="due_soon">Due soon</option>
              <option value="no_date">No date</option>
            </select>
          </label>
        ) : null}

        <label className="space-y-1">
          <span className="font-body text-[0.68rem] uppercase tracking-[0.16em] text-on-surface-variant">
            Review
          </span>
          <select
            value={filters.review}
            onChange={(event) => updateParam('review', event.target.value)}
            className="w-full rounded-card bg-surface-dim px-3 py-2 font-body text-sm text-on-surface outline-none ring-1 ring-white/10 transition focus:ring-primary"
          >
            <option value="all">All review states</option>
            <option value="needs_review">Needs review</option>
            <option value="clear">Clear</option>
          </select>
        </label>

        <label className="space-y-1">
          <span className="font-body text-[0.68rem] uppercase tracking-[0.16em] text-on-surface-variant">
            From
          </span>
          <input
            type="date"
            value={filters.dueFrom}
            onChange={(event) => updateParam('from', event.target.value)}
            className="w-full rounded-card bg-surface-dim px-3 py-2 font-body text-sm text-on-surface outline-none ring-1 ring-white/10 transition focus:ring-primary"
          />
        </label>

        <label className="space-y-1">
          <span className="font-body text-[0.68rem] uppercase tracking-[0.16em] text-on-surface-variant">
            To
          </span>
          <input
            type="date"
            value={filters.dueTo}
            onChange={(event) => updateParam('to', event.target.value)}
            className="w-full rounded-card bg-surface-dim px-3 py-2 font-body text-sm text-on-surface outline-none ring-1 ring-white/10 transition focus:ring-primary"
          />
        </label>

        <label className="space-y-1">
          <span className="font-body text-[0.68rem] uppercase tracking-[0.16em] text-on-surface-variant">
            Recurrence
          </span>
          <select
            value={filters.recurrence}
            onChange={(event) => updateParam('recurrence', event.target.value)}
            className="w-full rounded-card bg-surface-dim px-3 py-2 font-body text-sm text-on-surface outline-none ring-1 ring-white/10 transition focus:ring-primary"
          >
            <option value="all">All</option>
            <option value="recurring">Recurring</option>
            <option value="one_off">One-off</option>
          </select>
        </label>

        <label className="space-y-1">
          <span className="font-body text-[0.68rem] uppercase tracking-[0.16em] text-on-surface-variant">
            Subtasks
          </span>
          <select
            value={filters.subtasks}
            onChange={(event) => updateParam('subtasks', event.target.value)}
            className="w-full rounded-card bg-surface-dim px-3 py-2 font-body text-sm text-on-surface outline-none ring-1 ring-white/10 transition focus:ring-primary"
          >
            <option value="all">All</option>
            <option value="has_subtasks">Has subtasks</option>
            <option value="no_subtasks">No subtasks</option>
          </select>
        </label>
      </div>

      <div className="overflow-hidden rounded-soft bg-surface-container shadow-ambient">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse">
            <thead>
              <tr className="bg-surface-container-high text-left">
                {(['title', 'group', 'due_date', 'created_at', 'completed_at', 'review', 'recurrence'] as DesktopSortKey[])
                  .filter((key) => status === 'completed' || key !== 'completed_at')
                  .map((key) => (
                    <th key={key} className="px-4 py-3">
                      <button
                        type="button"
                        onClick={() => updateSort(key)}
                        className="inline-flex items-center gap-1 font-body text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant transition hover:text-on-surface"
                      >
                        {sortLabels[key]}
                        {sort.key === key ? (
                          sort.direction === 'asc' ? (
                            <ArrowUp className="h-3 w-3" strokeWidth={2} />
                          ) : (
                            <ArrowDown className="h-3 w-3" strokeWidth={2} />
                          )
                        ) : null}
                      </button>
                    </th>
                  ))}
                <th className="px-4 py-3 text-right font-body text-[0.68rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">
                  Actions
                </th>
              </tr>
            </thead>
            <tbody className="divide-y divide-white/5">
              {visibleTasks.length === 0 ? (
                <tr>
                  <td colSpan={status === 'completed' ? 8 : 7} className="px-4 py-10 text-center">
                    <p className="font-display text-2xl text-on-surface">No tasks match this view</p>
                    <p className="mt-2 font-body text-sm text-on-surface-variant">
                      Adjust the search or filters to widen the mission board.
                    </p>
                  </td>
                </tr>
              ) : null}
              {visibleTasks.map((task) => {
                const isBusy = busyTaskIds.includes(task.id)
                return (
                  <tr key={task.id} className="transition hover:bg-surface-container-high/70">
                    <td className="max-w-[22rem] px-4 py-3 align-top">
                      <Link
                        to={`/desktop/tasks/${task.id}`}
                        className="font-body text-sm font-semibold text-on-surface transition hover:text-primary"
                      >
                        {task.title}
                      </Link>
                      {task.description ? (
                        <p className="mt-1 line-clamp-1 font-body text-xs text-on-surface-variant">
                          {task.description}
                        </p>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 align-top font-body text-sm text-on-surface-variant">
                      {task.group.name}
                    </td>
                    <td className="px-4 py-3 align-top">
                      {status === 'open' && onMoveDueDate ? (
                        <input
                          type="date"
                          value={task.due_date ?? ''}
                          onChange={(event) =>
                            onMoveDueDate(task, event.target.value ? event.target.value : null)
                          }
                          className="w-36 rounded-card bg-surface-dim px-2 py-1.5 font-body text-sm text-on-surface outline-none ring-1 ring-white/10 transition focus:ring-primary"
                          aria-label={`Move ${task.title} due date`}
                        />
                      ) : (
                        <span className="font-body text-sm text-on-surface-variant">
                          {task.due_date ? formatIsoDateLabel(task.due_date) : 'No date'}
                        </span>
                      )}
                    </td>
                    <td className="px-4 py-3 align-top font-body text-sm text-on-surface-variant">
                      {formatDateTimeLabel(task.created_at)}
                    </td>
                    {status === 'completed' ? (
                      <td className="px-4 py-3 align-top font-body text-sm text-on-surface-variant">
                        {formatDateTimeLabel(task.completed_at)}
                      </td>
                    ) : null}
                    <td className="px-4 py-3 align-top">
                      <span
                        className={[
                          'rounded-pill px-2 py-1 font-body text-[0.68rem] uppercase tracking-[0.12em]',
                          task.needs_review
                            ? 'bg-warning/20 text-warning'
                            : 'bg-surface-dim text-on-surface-variant',
                        ].join(' ')}
                      >
                        {task.needs_review ? 'Review' : 'Clear'}
                      </span>
                    </td>
                    <td className="px-4 py-3 align-top font-body text-sm text-on-surface-variant">
                      {task.recurrence_frequency ?? 'One-off'}
                      {task.subtask_count > 0 ? (
                        <span className="ml-2 rounded-pill bg-info-dim px-2 py-0.5 text-[0.68rem] text-white">
                          {task.subtask_count}
                        </span>
                      ) : null}
                    </td>
                    <td className="px-4 py-3 align-top">
                      <div className="flex justify-end gap-2">
                        {status === 'open' && onComplete ? (
                          <button
                            type="button"
                            onClick={() => onComplete(task)}
                            disabled={isBusy}
                            className="inline-flex items-center gap-1 rounded-pill bg-success/20 px-3 py-1.5 font-body text-xs font-semibold text-success transition hover:bg-success/30 active:scale-[0.98] disabled:opacity-50"
                          >
                            <CheckCircle2 className="h-3.5 w-3.5" strokeWidth={2} />
                            Complete
                          </button>
                        ) : null}
                        {status === 'completed' && onReopen ? (
                          <button
                            type="button"
                            onClick={() => onReopen(task)}
                            disabled={isBusy}
                            className="inline-flex items-center gap-1 rounded-pill bg-surface-dim px-3 py-1.5 font-body text-xs font-semibold text-on-surface-variant transition hover:bg-surface-container-highest hover:text-on-surface active:scale-[0.98] disabled:opacity-50"
                          >
                            <RotateCcw className="h-3.5 w-3.5" strokeWidth={2} />
                            Restore
                          </button>
                        ) : null}
                      </div>
                    </td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
      </div>
    </section>
  )
}
