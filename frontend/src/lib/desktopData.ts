import {
  listAllTasks,
  listTasks,
  type GroupSummary,
  type PaginatedTasksResponse,
  type TaskSummary,
} from './api'

export type DesktopTaskStatus = 'open' | 'completed'
export type DesktopSortKey =
  | 'title'
  | 'group'
  | 'due_date'
  | 'created_at'
  | 'completed_at'
  | 'review'
  | 'recurrence'
export type DesktopSortDirection = 'asc' | 'desc'

export type DesktopTaskFilters = {
  search: string
  groupId: string
  dueBucket: string
  dueFrom: string
  dueTo: string
  review: string
  recurrence: string
  subtasks: string
}

export type DesktopSortState = {
  key: DesktopSortKey
  direction: DesktopSortDirection
}

export type WeeklyBoardColumn = {
  key: string
  label: string
  date: string | null
  tasks: TaskSummary[]
}

export type CompletionTrendPoint = {
  date: string
  label: string
  count: number
}

export type GroupAnalytics = {
  group: GroupSummary
  openCount: number
  completedCount: number
  overdueCount: number
  dueThisWeekCount: number
}

export type DesktopAnalytics = {
  todayIso: string
  weekEndIso: string
  upcomingTasks: TaskSummary[]
  recentlyCompletedTasks: TaskSummary[]
  completionTrend: CompletionTrendPoint[]
  groupAnalytics: GroupAnalytics[]
  counts: {
    open: number
    completed: number
    overdue: number
    dueToday: number
    dueThisWeek: number
    noDate: number
    needsReview: number
  }
}

const MAX_DESKTOP_TASK_PAGES = 20
const DESKTOP_TASK_PAGE_SIZE = 100

export const EMPTY_DESKTOP_FILTERS: DesktopTaskFilters = {
  search: '',
  groupId: 'all',
  dueBucket: 'all',
  dueFrom: '',
  dueTo: '',
  review: 'all',
  recurrence: 'all',
  subtasks: 'all',
}

export async function fetchAllDesktopTasks(
  status: DesktopTaskStatus,
  groupId: string | null = null
): Promise<TaskSummary[]> {
  const items: TaskSummary[] = []
  let cursor: string | null = null

  for (let page = 0; page < MAX_DESKTOP_TASK_PAGES; page += 1) {
    const response: PaginatedTasksResponse = groupId
      ? await listTasks(groupId, status, cursor, DESKTOP_TASK_PAGE_SIZE)
      : await listAllTasks(status, cursor, DESKTOP_TASK_PAGE_SIZE)
    items.push(...response.items)

    if (!response.has_more || !response.next_cursor) {
      break
    }
    cursor = response.next_cursor
  }

  return status === 'completed' ? dedupeCompletedTasks(items) : items
}

export function getTodayIsoDate(timezone: string | null): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone ?? undefined,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = formatter.formatToParts(new Date())
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value

  if (!year || !month || !day) {
    throw new Error('Failed to compute current date in user timezone.')
  }

  return `${year}-${month}-${day}`
}

export function addDaysIso(isoDate: string, days: number): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  const date = new Date(Date.UTC(year, month - 1, day + days, 12))
  return date.toISOString().slice(0, 10)
}

export function formatIsoDateLabel(isoDate: string, options: Intl.DateTimeFormatOptions = {}) {
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    ...options,
  }).format(new Date(`${isoDate}T12:00:00`))
}

export function formatDateTimeLabel(value: string | null | undefined) {
  if (!value) {
    return 'None'
  }
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) {
    return 'None'
  }
  return new Intl.DateTimeFormat(undefined, {
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  }).format(date)
}

export function getCompletedIsoDate(task: TaskSummary, timezone: string | null): string | null {
  if (!task.completed_at) {
    return null
  }
  const date = new Date(task.completed_at)
  if (Number.isNaN(date.getTime())) {
    return null
  }
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone ?? undefined,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
  const parts = formatter.formatToParts(date)
  const year = parts.find((part) => part.type === 'year')?.value
  const month = parts.find((part) => part.type === 'month')?.value
  const day = parts.find((part) => part.type === 'day')?.value
  return year && month && day ? `${year}-${month}-${day}` : null
}

export function buildWeeklyBoardColumns(
  tasks: TaskSummary[],
  timezone: string | null
): WeeklyBoardColumn[] {
  const todayIso = getTodayIsoDate(timezone)
  const datedColumns: WeeklyBoardColumn[] = Array.from({ length: 7 }, (_, index) => {
    const date = addDaysIso(todayIso, index)
    return {
      key: `date-${date}`,
      label: index === 0 ? 'Today' : formatIsoDateLabel(date, { weekday: 'short' }),
      date,
      tasks: [],
    }
  })
  const columns: WeeklyBoardColumn[] = [
    { key: 'overdue', label: 'Overdue', date: null, tasks: [] },
    ...datedColumns,
    { key: 'no-date', label: 'No Date', date: null, tasks: [] },
  ]
  const byDate = new Map(datedColumns.map((column) => [column.date, column]))

  for (const task of tasks) {
    if (!task.due_date) {
      columns[columns.length - 1].tasks.push(task)
    } else if (task.due_date < todayIso) {
      columns[0].tasks.push(task)
    } else {
      const column = byDate.get(task.due_date)
      if (column) {
        column.tasks.push(task)
      }
    }
  }

  return columns
}

export function buildDesktopAnalytics({
  openTasks,
  completedTasks,
  groups,
  timezone,
}: {
  openTasks: TaskSummary[]
  completedTasks: TaskSummary[]
  groups: GroupSummary[]
  timezone: string | null
}): DesktopAnalytics {
  const todayIso = getTodayIsoDate(timezone)
  const weekEndIso = addDaysIso(todayIso, 6)
  const lastSevenDates = Array.from({ length: 7 }, (_, index) => addDaysIso(todayIso, index - 6))

  const completionCounts = new Map(lastSevenDates.map((date) => [date, 0]))
  for (const task of completedTasks) {
    const completedDate = getCompletedIsoDate(task, timezone)
    if (completedDate && completionCounts.has(completedDate)) {
      completionCounts.set(completedDate, (completionCounts.get(completedDate) ?? 0) + 1)
    }
  }

  const completionTrend = lastSevenDates.map((date) => ({
    date,
    label: date === todayIso ? 'Today' : formatIsoDateLabel(date, { weekday: 'short' }),
    count: completionCounts.get(date) ?? 0,
  }))

  const upcomingTasks = openTasks
    .filter((task) => task.due_date && task.due_date >= todayIso)
    .sort((first, second) => compareNullableStrings(first.due_date, second.due_date, 'asc'))
    .slice(0, 8)

  const recentlyCompletedTasks = [...completedTasks]
    .sort((first, second) =>
      compareNullableStrings(first.completed_at, second.completed_at, 'desc')
    )
    .slice(0, 8)

  const groupAnalytics = groups.map((group) => {
    const groupOpen = openTasks.filter((task) => task.group.id === group.id)
    const groupCompleted = completedTasks.filter((task) => task.group.id === group.id)
    return {
      group,
      openCount: groupOpen.length,
      completedCount: groupCompleted.length,
      overdueCount: groupOpen.filter((task) => task.due_date && task.due_date < todayIso).length,
      dueThisWeekCount: groupOpen.filter(
        (task) => task.due_date && task.due_date >= todayIso && task.due_date <= weekEndIso
      ).length,
    }
  })

  return {
    todayIso,
    weekEndIso,
    upcomingTasks,
    recentlyCompletedTasks,
    completionTrend,
    groupAnalytics,
    counts: {
      open: openTasks.length,
      completed: completedTasks.length,
      overdue: openTasks.filter((task) => task.due_date && task.due_date < todayIso).length,
      dueToday: openTasks.filter((task) => task.due_date === todayIso).length,
      dueThisWeek: openTasks.filter(
        (task) => task.due_date && task.due_date >= todayIso && task.due_date <= weekEndIso
      ).length,
      noDate: openTasks.filter((task) => !task.due_date).length,
      needsReview: openTasks.filter((task) => task.needs_review).length,
    },
  }
}

export function filterDesktopTasks(
  tasks: TaskSummary[],
  filters: DesktopTaskFilters
): TaskSummary[] {
  const search = filters.search.trim().toLowerCase()

  return tasks.filter((task) => {
    if (search) {
      const haystack = [task.title, task.description, task.group.name]
        .filter(Boolean)
        .join(' ')
        .toLowerCase()
      if (!haystack.includes(search)) {
        return false
      }
    }

    if (filters.groupId !== 'all' && task.group.id !== filters.groupId) {
      return false
    }

    if (filters.dueBucket !== 'all' && task.due_bucket !== filters.dueBucket) {
      return false
    }

    if (filters.dueFrom && (!task.due_date || task.due_date < filters.dueFrom)) {
      return false
    }

    if (filters.dueTo && (!task.due_date || task.due_date > filters.dueTo)) {
      return false
    }

    if (filters.review === 'needs_review' && !task.needs_review) {
      return false
    }

    if (filters.review === 'clear' && task.needs_review) {
      return false
    }

    if (filters.recurrence === 'recurring' && !task.recurrence_frequency) {
      return false
    }

    if (filters.recurrence === 'one_off' && task.recurrence_frequency) {
      return false
    }

    if (filters.subtasks === 'has_subtasks' && task.subtask_count === 0) {
      return false
    }

    if (filters.subtasks === 'no_subtasks' && task.subtask_count > 0) {
      return false
    }

    return true
  })
}

export function sortDesktopTasks(tasks: TaskSummary[], sort: DesktopSortState): TaskSummary[] {
  return [...tasks].sort((first, second) => {
    const direction = sort.direction === 'asc' ? 1 : -1
    return compareDesktopTaskValue(first, second, sort.key, sort.direction) * direction
  })
}

function compareDesktopTaskValue(
  first: TaskSummary,
  second: TaskSummary,
  key: DesktopSortKey,
  direction: DesktopSortDirection
) {
  if (key === 'title') {
    return first.title.localeCompare(second.title)
  }
  if (key === 'group') {
    return first.group.name.localeCompare(second.group.name)
  }
  if (key === 'review') {
    return Number(first.needs_review) - Number(second.needs_review)
  }
  if (key === 'recurrence') {
    return (first.recurrence_frequency ?? '').localeCompare(second.recurrence_frequency ?? '')
  }

  const firstValue = first[key] ?? null
  const secondValue = second[key] ?? null
  return compareNullableStrings(firstValue, secondValue, direction)
}

function compareNullableStrings(
  first: string | null | undefined,
  second: string | null | undefined,
  direction: DesktopSortDirection
) {
  if (!first && !second) {
    return 0
  }
  if (!first) {
    return direction === 'asc' ? 1 : -1
  }
  if (!second) {
    return direction === 'asc' ? -1 : 1
  }
  return first.localeCompare(second)
}

export function dedupeCompletedTasks(tasks: TaskSummary[]) {
  const seen = new Set<string>()
  const result: TaskSummary[] = []

  for (const task of tasks) {
    const completedSecond = task.completed_at ? task.completed_at.slice(0, 19) : 'none'
    const normalizedTitle = task.title.trim().toLowerCase()
    const dueValue = task.due_date ?? 'none'
    const candidateKeys = [`task:${task.id}`]

    if (task.series_id) {
      candidateKeys.push(`series:${task.series_id}|second:${completedSecond}`)
    } else if (task.recurrence_frequency) {
      candidateKeys.push(
        `recurrence:${normalizedTitle}|group:${task.group.id}|due:${dueValue}|second:${completedSecond}`
      )
    }

    if (task.completed_at && !task.series_id && !task.recurrence_frequency) {
      candidateKeys.push(
        `legacy:${normalizedTitle}|group:${task.group.id}|due:${dueValue}|second:${completedSecond}`
      )
    }

    if (candidateKeys.some((key) => seen.has(key))) {
      continue
    }
    candidateKeys.forEach((key) => seen.add(key))
    result.push(task)
  }

  return result
}
