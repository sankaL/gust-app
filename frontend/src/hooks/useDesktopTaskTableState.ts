import { useEffect, useState } from 'react'
import { useSearchParams } from 'react-router-dom'

import {
  EMPTY_DESKTOP_FILTERS,
  filterDesktopTasks,
  sortDesktopTasks,
  type DesktopSortKey,
  type DesktopSortState,
} from '../lib/desktopData'
import type { TaskSummary } from '../lib/api'

export const DESKTOP_TASKS_PER_PAGE = 10
const filterKeys = ['q', 'group', 'bucket', 'from', 'to', 'review', 'recurrence', 'subtasks']

function param(params: URLSearchParams, key: string, fallback: string) {
  return params.get(key) ?? fallback
}

function sortTasks(tasks: TaskSummary[], sort: DesktopSortState, status: 'open' | 'completed' | 'all') {
  if (status !== 'all') return sortDesktopTasks(tasks, sort)
  return [
    ...sortDesktopTasks(tasks.filter((task) => task.status === 'open'), sort),
    ...sortDesktopTasks(tasks.filter((task) => task.status === 'completed'), sort),
  ]
}

function readFilters(params: URLSearchParams, lockedGroupId?: string) {
  return {
    ...EMPTY_DESKTOP_FILTERS,
    search: param(params, 'q', ''),
    groupId: lockedGroupId ?? param(params, 'group', 'all'),
    dueBucket: param(params, 'bucket', 'all'),
    dueFrom: param(params, 'from', ''),
    dueTo: param(params, 'to', ''),
    review: param(params, 'review', 'all'),
    recurrence: param(params, 'recurrence', 'all'),
    subtasks: param(params, 'subtasks', 'all'),
  }
}

function countFilters(filters: typeof EMPTY_DESKTOP_FILTERS, lockedGroupId?: string) {
  const values = [!lockedGroupId && filters.groupId !== 'all', filters.dueBucket !== 'all',
    Boolean(filters.dueFrom), Boolean(filters.dueTo), filters.review !== 'all',
    filters.recurrence !== 'all', filters.subtasks !== 'all']
  return values.filter(Boolean).length
}

function applyParam(next: URLSearchParams, key: string, value: string) {
  const defaultValue = EMPTY_DESKTOP_FILTERS[key as keyof typeof EMPTY_DESKTOP_FILTERS]
  if (!value || value === defaultValue) next.delete(key)
  else next.set(key, value)
}

function removeLockedGroupParam(next: URLSearchParams, lockedGroupId: string | undefined, key: string) {
  if (lockedGroupId && key === 'group') next.delete('group')
}

export function useDesktopTaskTableState(tasks: TaskSummary[], status: 'open' | 'completed' | 'all', lockedGroupId?: string) {
  const [params, setParams] = useSearchParams()
  const [showFilters, setShowFilters] = useState(false)
  const filters = readFilters(params, lockedGroupId)
  const defaultKey: DesktopSortKey = status === 'completed' ? 'completed_at' : 'due_date'
  const rawSort = param(params, 'sort', defaultKey) as DesktopSortKey
  const sort: DesktopSortState = {
    key: ['title', 'group', 'due_date', 'created_at', 'completed_at', 'review', 'recurrence'].includes(rawSort) ? rawSort : defaultKey,
    direction: param(params, 'dir', status === 'completed' ? 'desc' : 'asc') === 'desc' ? 'desc' : 'asc',
  }
  const visibleTasks = sortTasks(filterDesktopTasks(tasks, filters), sort, status)
  const pageCount = Math.max(1, Math.ceil(visibleTasks.length / DESKTOP_TASKS_PER_PAGE))
  const requestedPage = Math.max(1, Number(params.get('page') ?? 1) || 1)
  const page = Math.min(requestedPage, pageCount)

  useEffect(() => {
    if (requestedPage === page) return
    const next = new URLSearchParams(params)
    if (page === 1) next.delete('page'); else next.set('page', String(page))
    setParams(next, { replace: true })
  }, [page, params, requestedPage, setParams])

  function setParam(key: string, value: string) {
    const next = new URLSearchParams(params)
    applyParam(next, key, value)
    removeLockedGroupParam(next, lockedGroupId, key)
    next.delete('page'); setParams(next)
  }
  function setSort(key: DesktopSortKey) {
    const next = new URLSearchParams(params); next.set('sort', key)
    next.set('dir', sort.key === key && sort.direction === 'asc' ? 'desc' : 'asc'); next.delete('page'); setParams(next)
  }
  function clearFilters() {
    const next = new URLSearchParams(params); filterKeys.forEach((key) => next.delete(key)); next.delete('page'); setParams(next)
  }
  function setPage(nextPage: number) {
    const next = new URLSearchParams(params); if (nextPage <= 1) next.delete('page'); else next.set('page', String(nextPage)); setParams(next)
  }

  const start = (page - 1) * DESKTOP_TASKS_PER_PAGE
  return { filters, sort, visibleTasks, pagedTasks: visibleTasks.slice(start, start + DESKTOP_TASKS_PER_PAGE),
    page, pageCount, start, activeFilterCount: countFilters(filters, lockedGroupId), showFilters,
    setShowFilters, setParam, setSort, clearFilters, setPage }
}
