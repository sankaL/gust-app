import { useEffect, useState } from 'react'
import { ArrowDown, ArrowUp, CheckCircle2, RotateCcw, X, Filter, Search } from 'lucide-react'
import { useSearchParams } from 'react-router-dom'

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
import { SelectDropdown } from './SelectDropdown'

type DesktopTaskTableProps = {
  title: string
  tasks: TaskSummary[]
  groups: GroupSummary[]
  status: 'open' | 'completed' | 'all'
  lockedGroupId?: string
  hideHeader?: boolean
  busyTaskIds?: string[]
  onComplete?: (task: TaskSummary) => void
  onReopen?: (task: TaskSummary) => void
  onMoveDueDate?: (task: TaskSummary, dueDate: string | null) => void
  onTaskOpen?: (taskId: string) => void
  onVisibleCountChange?: (visibleCount: number, totalCount: number) => void
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

const sortKeys = Object.keys(sortLabels) as DesktopSortKey[]

const filterParamKeys = ['q', 'group', 'bucket', 'from', 'to', 'review', 'recurrence', 'subtasks']
const TASKS_PER_PAGE = 10
const compactSelectClassName = 'space-y-1'
const compactSelectLabelClassName =
  'font-body text-[0.68rem] uppercase tracking-[0.16em] text-on-surface-variant'
const compactSelectTriggerClassName =
  'h-10 px-3 font-body text-sm ring-1 ring-white/10 focus:ring-primary'

const dueBucketOptions = [
  { value: 'all', label: 'All buckets' },
  { value: 'overdue', label: 'Overdue' },
  { value: 'due_soon', label: 'Due soon' },
  { value: 'no_date', label: 'No date' },
]

const reviewOptions = [
  { value: 'all', label: 'All review states' },
  { value: 'needs_review', label: 'Needs review' },
  { value: 'clear', label: 'Clear' },
]

const recurrenceOptions = [
  { value: 'all', label: 'All' },
  { value: 'recurring', label: 'Recurring' },
  { value: 'one_off', label: 'One-off' },
]

const subtaskOptions = [
  { value: 'all', label: 'All' },
  { value: 'has_subtasks', label: 'Has subtasks' },
  { value: 'no_subtasks', label: 'No subtasks' },
]

function getParam(searchParams: URLSearchParams, key: string, fallback: string) {
  return searchParams.get(key) ?? fallback
}

function getDefaultSortKey(status: DesktopTaskTableProps['status']): DesktopSortKey {
  return status === 'completed' ? 'completed_at' : 'due_date'
}

function getDefaultSortDirection(status: DesktopTaskTableProps['status']) {
  return status === 'completed' ? 'desc' : 'asc'
}

function getSortKey(value: string, fallback: DesktopSortKey): DesktopSortKey {
  return sortKeys.includes(value as DesktopSortKey) ? (value as DesktopSortKey) : fallback
}

export function DesktopTaskTable({
  title,
  tasks,
  groups,
  status,
  lockedGroupId,
  hideHeader = false,
  busyTaskIds = [],
  onComplete,
  onReopen,
  onMoveDueDate,
  onTaskOpen,
  onVisibleCountChange,
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
  const defaultSortKey = getDefaultSortKey(status)
  const sort: DesktopSortState = {
    key: getSortKey(getParam(searchParams, 'sort', defaultSortKey), defaultSortKey),
    direction: (getParam(searchParams, 'dir', getDefaultSortDirection(status)) === 'desc'
      ? 'desc'
      : 'asc'),
  }
  const currentPage = Math.max(1, Number(searchParams.get('page') ?? '1') || 1)
  const visibleTasks = sortVisibleTasks(filterDesktopTasks(tasks, filters), sort, status)
  const pageCount = Math.max(1, Math.ceil(visibleTasks.length / TASKS_PER_PAGE))
  const safePage = Math.min(currentPage, pageCount)
  const pageStart = (safePage - 1) * TASKS_PER_PAGE
  const pagedTasks = visibleTasks.slice(pageStart, pageStart + TASKS_PER_PAGE)
  const showingStart = visibleTasks.length === 0 ? 0 : pageStart + 1
  const showingEnd = Math.min(pageStart + TASKS_PER_PAGE, visibleTasks.length)
  const hasActiveFilters =
    filters.search !== EMPTY_DESKTOP_FILTERS.search ||
    (!lockedGroupId && filters.groupId !== EMPTY_DESKTOP_FILTERS.groupId) ||
    filters.dueBucket !== EMPTY_DESKTOP_FILTERS.dueBucket ||
    filters.dueFrom !== EMPTY_DESKTOP_FILTERS.dueFrom ||
    filters.dueTo !== EMPTY_DESKTOP_FILTERS.dueTo ||
    filters.review !== EMPTY_DESKTOP_FILTERS.review ||
    filters.recurrence !== EMPTY_DESKTOP_FILTERS.recurrence ||
    filters.subtasks !== EMPTY_DESKTOP_FILTERS.subtasks

  const activeFilterCount = [
    !lockedGroupId && filters.groupId !== EMPTY_DESKTOP_FILTERS.groupId,
    filters.dueBucket !== EMPTY_DESKTOP_FILTERS.dueBucket,
    filters.dueFrom !== EMPTY_DESKTOP_FILTERS.dueFrom,
    filters.dueTo !== EMPTY_DESKTOP_FILTERS.dueTo,
    filters.review !== EMPTY_DESKTOP_FILTERS.review,
    filters.recurrence !== EMPTY_DESKTOP_FILTERS.recurrence,
    filters.subtasks !== EMPTY_DESKTOP_FILTERS.subtasks,
  ].filter(Boolean).length

  const [showFilters, setShowFilters] = useState(false)

  useEffect(() => {
    onVisibleCountChange?.(visibleTasks.length, tasks.length)
  }, [onVisibleCountChange, tasks.length, visibleTasks.length])

  useEffect(() => {
    if (currentPage === safePage) {
      return
    }
    const next = new URLSearchParams(searchParams)
    if (safePage <= 1) {
      next.delete('page')
    } else {
      next.set('page', String(safePage))
    }
    setSearchParams(next, { replace: true })
  }, [currentPage, safePage, searchParams, setSearchParams])

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
    next.delete('page')
    setSearchParams(next)
  }

  function updateSort(key: DesktopSortKey) {
    const next = new URLSearchParams(searchParams)
    const nextDirection = sort.key === key && sort.direction === 'asc' ? 'desc' : 'asc'
    next.set('sort', key)
    next.set('dir', nextDirection)
    next.delete('page')
    setSearchParams(next)
  }

  function clearFilters() {
    const next = new URLSearchParams(searchParams)
    filterParamKeys.forEach((key) => next.delete(key))
    next.delete('page')
    setSearchParams(next)
  }

  function goToPage(page: number) {
    const next = new URLSearchParams(searchParams)
    if (page <= 1) {
      next.delete('page')
    } else {
      next.set('page', String(page))
    }
    setSearchParams(next)
  }

  return (
    <section className="space-y-4">
      <div>
        {hideHeader ? <div /> : (
          <div>
            <h2 className="font-display text-3xl tracking-tight text-on-surface">{title}</h2>
            <p className="mt-1 font-body text-sm text-on-surface-variant">
              {visibleTasks.length} of {tasks.length} tasks visible
            </p>
          </div>
        )}
      </div>

      <div className="space-y-3 relative">
        <div className="flex items-center gap-3">
          <div className="relative flex-grow">
            <Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant" strokeWidth={2} />
            <input
              value={filters.search}
              onChange={(event) => updateParam('q', event.target.value)}
              placeholder="Search for any tasks..."
              className="h-10 w-full rounded-card bg-surface-dim pl-10 pr-3 font-body text-sm text-on-surface outline-none ring-1 ring-white/10 transition focus:ring-primary"
            />
          </div>
          <button
            type="button"
            onClick={() => setShowFilters(!showFilters)}
            aria-label="Toggle filters"
            className={`relative inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-card transition ring-1 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-surface ${
              showFilters || activeFilterCount > 0
                ? 'bg-primary text-on-primary ring-transparent hover:bg-primary/90'
                : 'bg-surface-dim text-on-surface ring-white/10 hover:bg-surface-container-highest'
            }`}
          >
            <Filter className="h-4 w-4" strokeWidth={2} />
            {activeFilterCount > 0 && (
              <span className="absolute -right-1.5 -top-1.5 flex h-4 w-4 items-center justify-center rounded-full bg-black text-[0.6rem] font-bold text-white shadow-sm ring-2 ring-surface-container">
                {activeFilterCount}
              </span>
            )}
          </button>
        </div>

        {showFilters && (
          <div className="absolute right-0 top-12 z-50 w-64 rounded-card bg-surface-container-highest p-4 shadow-[0_18px_40px_rgba(0,0,0,0.58),_inset_0_1px_0_rgba(255,255,255,0.05)] ring-1 ring-white/10">
            <div className="flex flex-col gap-4">
              {!lockedGroupId ? (
                <div className="w-full shrink-0">
                  <SelectDropdown
                    label="Group"
                    options={[
                      { value: 'all', label: 'All groups' },
                      ...groups.map((group) => ({ value: group.id, label: group.name })),
                    ]}
                    value={filters.groupId}
                    onChange={(value) => updateParam('group', String(value))}
                    className={compactSelectClassName}
                    labelClassName={compactSelectLabelClassName}
                    triggerClassName={compactSelectTriggerClassName}
                  />
                </div>
              ) : null}

              {status !== 'completed' ? (
                <div className="w-full shrink-0">
                  <SelectDropdown
                    label="Bucket"
                    options={dueBucketOptions}
                    value={filters.dueBucket}
                    onChange={(value) => updateParam('bucket', String(value))}
                    className={compactSelectClassName}
                    labelClassName={compactSelectLabelClassName}
                    triggerClassName={compactSelectTriggerClassName}
                  />
                </div>
              ) : null}

              <div className="w-full shrink-0">
                <SelectDropdown
                  label="Review"
                  options={reviewOptions}
                  value={filters.review}
                  onChange={(value) => updateParam('review', String(value))}
                  className={compactSelectClassName}
                  labelClassName={compactSelectLabelClassName}
                  triggerClassName={compactSelectTriggerClassName}
                />
              </div>

              <div className="flex gap-2">
                <label className="w-1/2 space-y-1">
                  <span className="font-body text-[0.68rem] uppercase tracking-[0.16em] text-on-surface-variant">
                    From
                  </span>
                  <input
                    type="date"
                    value={filters.dueFrom}
                    onChange={(event) => updateParam('from', event.target.value)}
                    className="h-10 w-full rounded-card bg-surface-dim px-3 font-body text-sm text-on-surface outline-none ring-1 ring-white/10 transition focus:ring-primary"
                  />
                </label>

                <label className="w-1/2 space-y-1">
                  <span className="font-body text-[0.68rem] uppercase tracking-[0.16em] text-on-surface-variant">
                    To
                  </span>
                  <input
                    type="date"
                    value={filters.dueTo}
                    onChange={(event) => updateParam('to', event.target.value)}
                    className="h-10 w-full rounded-card bg-surface-dim px-3 font-body text-sm text-on-surface outline-none ring-1 ring-white/10 transition focus:ring-primary"
                  />
                </label>
              </div>

              <div className="w-full shrink-0">
                <SelectDropdown
                  label="Recurrence"
                  options={recurrenceOptions}
                  value={filters.recurrence}
                  onChange={(value) => updateParam('recurrence', String(value))}
                  className={compactSelectClassName}
                  labelClassName={compactSelectLabelClassName}
                  triggerClassName={compactSelectTriggerClassName}
                />
              </div>

              <div className="w-full shrink-0">
                <SelectDropdown
                  label="Subtasks"
                  options={subtaskOptions}
                  value={filters.subtasks}
                  onChange={(value) => updateParam('subtasks', String(value))}
                  className={compactSelectClassName}
                  labelClassName={compactSelectLabelClassName}
                  triggerClassName={compactSelectTriggerClassName}
                />
              </div>

              {hasActiveFilters ? (
                <button
                  type="button"
                  onClick={clearFilters}
                  className="mt-2 inline-flex h-10 w-full shrink-0 items-center justify-center gap-2 rounded-card bg-primary px-3 font-body text-xs font-semibold text-on-primary shadow-ambient transition hover:bg-primary/90 focus:outline-none focus:ring-2 focus:ring-primary focus:ring-offset-2 focus:ring-offset-surface"
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2} />
                  Clear filters
                </button>
              ) : null}
            </div>
          </div>
        )}
      </div>

      <div className="overflow-hidden rounded-soft bg-surface-container shadow-ambient">
        <div className="overflow-x-auto">
          <table className="w-full min-w-[980px] border-collapse">
            <thead>
              <tr className="bg-surface-container-high text-left">
                {(['title', 'group', 'due_date', 'created_at', 'completed_at', 'review', 'recurrence'] as DesktopSortKey[])
                  .filter((key) => status !== 'open' || key !== 'completed_at')
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
                  <td colSpan={status === 'open' ? 7 : 8} className="px-4 py-10 text-center">
                    <p className="font-display text-2xl text-on-surface">No tasks match this view</p>
                    <p className="mt-2 font-body text-sm text-on-surface-variant">
                      Adjust the search or filters to widen the mission board.
                    </p>
                  </td>
                </tr>
              ) : null}
              {pagedTasks.map((task) => {
                const isBusy = busyTaskIds.includes(task.id)
                return (
                  <tr key={task.id} className="transition hover:bg-surface-container-high/70">
                    <td className="max-w-[22rem] px-4 py-3 align-top">
                      <button
                        type="button"
                        onClick={() => onTaskOpen?.(task.id)}
                        className="block max-w-full text-left font-body text-sm font-semibold text-on-surface transition hover:text-primary active:scale-[0.99]"
                      >
                        {task.title}
                      </button>
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
                      {task.status === 'open' && onMoveDueDate ? (
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
                    {status !== 'open' ? (
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
                        {task.status === 'open' && onComplete ? (
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
                        {task.status === 'completed' && onReopen ? (
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
      {visibleTasks.length > TASKS_PER_PAGE ? (
        <div className="flex flex-wrap items-center justify-center gap-3 pb-24 font-body text-sm text-on-surface-variant">
          <p>
            Showing {showingStart}-{showingEnd} of {visibleTasks.length}
          </p>
          <div className="flex items-center gap-2">
            <button
              type="button"
              onClick={() => goToPage(safePage - 1)}
              disabled={safePage === 1}
              className="rounded-pill bg-surface-dim px-3 py-1.5 font-body text-xs font-semibold text-on-surface-variant transition hover:bg-surface-container-highest hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-40"
            >
              Previous
            </button>
            <span className="px-2 text-xs">
              Page {safePage} of {pageCount}
            </span>
            <button
              type="button"
              onClick={() => goToPage(safePage + 1)}
              disabled={safePage === pageCount}
              className="rounded-pill bg-surface-dim px-3 py-1.5 font-body text-xs font-semibold text-on-surface-variant transition hover:bg-surface-container-highest hover:text-on-surface disabled:cursor-not-allowed disabled:opacity-40"
            >
              Next
            </button>
          </div>
        </div>
      ) : null}
    </section>
  )
}

function sortVisibleTasks(
  tasks: TaskSummary[],
  sort: DesktopSortState,
  status: DesktopTaskTableProps['status']
) {
  if (status !== 'all') {
    return sortDesktopTasks(tasks, sort)
  }

  const openTasks = tasks.filter((task) => task.status === 'open')
  const completedTasks = tasks.filter((task) => task.status === 'completed')
  return [...sortDesktopTasks(openTasks, sort), ...sortDesktopTasks(completedTasks, sort)]
}
