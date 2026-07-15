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

export type CompletionTrendRange = 'week' | 'month' | '3m' | '6m' | 'year' | 'ytd'

export type CompletionTrendPoint = {
  date: string
  label: string
  count: number
}

export type CompletionTrend = {
  points: CompletionTrendPoint[]
  total: number
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
  completionTrends: Record<CompletionTrendRange, CompletionTrend>
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

export const COMPLETION_TREND_RANGES: Array<{
  value: CompletionTrendRange
  label: string
}> = [
  { value: 'week', label: 'Week' },
  { value: 'month', label: 'Month' },
  { value: '3m', label: '3M' },
  { value: '6m', label: '6M' },
  { value: 'year', label: 'Year' },
  { value: 'ytd', label: 'YTD' },
]

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
  groupId: string | null = null,
  options: { completedStart?: string | null; completedEnd?: string | null } = {}
): Promise<TaskSummary[]> {
  const items: TaskSummary[] = []
  let cursor: string | null = null

  for (let page = 0; page < MAX_DESKTOP_TASK_PAGES; page += 1) {
    const response: PaginatedTasksResponse = groupId
      ? await listTasks(
          groupId,
          status,
          cursor,
          DESKTOP_TASK_PAGE_SIZE,
          options.completedStart ?? null,
          options.completedEnd ?? null
        )
      : await listAllTasks(
          status,
          cursor,
          DESKTOP_TASK_PAGE_SIZE,
          options.completedStart ?? null,
          options.completedEnd ?? null
        )
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

function addMonthsIso(isoDate: string, months: number): string {
  const [year, month, day] = isoDate.split('-').map(Number)
  const targetMonthIndex = month - 1 + months
  const targetYear = year + Math.floor(targetMonthIndex / 12)
  const normalizedMonthIndex = ((targetMonthIndex % 12) + 12) % 12
  const lastDayOfTargetMonth = new Date(
    Date.UTC(targetYear, normalizedMonthIndex + 1, 0, 12)
  ).getUTCDate()
  const date = new Date(
    Date.UTC(targetYear, normalizedMonthIndex, Math.min(day, lastDayOfTargetMonth), 12)
  )
  return date.toISOString().slice(0, 10)
}

function startOfMonthIso(isoDate: string): string {
  return `${isoDate.slice(0, 8)}01`
}

function getDaysBetweenIso(startIso: string, endIso: string): number {
  const [startYear, startMonth, startDay] = startIso.split('-').map(Number)
  const [endYear, endMonth, endDay] = endIso.split('-').map(Number)
  const start = Date.UTC(startYear, startMonth - 1, startDay, 12)
  const end = Date.UTC(endYear, endMonth - 1, endDay, 12)
  return Math.round((end - start) / 86_400_000)
}

function getMonthDistance(startMonthIso: string, endMonthIso: string): number {
  const [startYear, startMonth] = startMonthIso.split('-').map(Number)
  const [endYear, endMonth] = endMonthIso.split('-').map(Number)
  return (endYear - startYear) * 12 + (endMonth - startMonth)
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

function getCompletedIsoDate(task: TaskSummary, timezone: string | null): string | null {
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

function buildDailyCompletionTrend({
  completedDates,
  startIso,
  todayIso,
}: {
  completedDates: string[]
  startIso: string
  todayIso: string
}): CompletionTrend {
  const dayCount = getDaysBetweenIso(startIso, todayIso) + 1
  const dates = Array.from({ length: dayCount }, (_, index) => addDaysIso(startIso, index))
  const counts = new Map(dates.map((date) => [date, 0]))

  for (const completedDate of completedDates) {
    if (counts.has(completedDate)) {
      counts.set(completedDate, (counts.get(completedDate) ?? 0) + 1)
    }
  }

  const points = dates.map((date) => ({
    date,
    label: date === todayIso ? 'Today' : formatIsoDateLabel(date, { weekday: 'short' }),
    count: counts.get(date) ?? 0,
  }))

  return {
    points,
    total: points.reduce((sum, point) => sum + point.count, 0),
  }
}

function buildWeeklyCompletionTrend({
  completedDates,
  todayIso,
  weeks,
}: {
  completedDates: string[]
  todayIso: string
  weeks: number
}): CompletionTrend {
  const startIso = addDaysIso(todayIso, -((weeks * 7) - 1))
  const buckets = Array.from({ length: weeks }, (_, index) => {
    const start = addDaysIso(startIso, index * 7)
    const end = index === weeks - 1 ? todayIso : addDaysIso(start, 6)
    return { start, end, count: 0 }
  })

  for (const completedDate of completedDates) {
    if (completedDate < startIso || completedDate > todayIso) {
      continue
    }
    const bucketIndex = Math.floor(getDaysBetweenIso(startIso, completedDate) / 7)
    const bucket = buckets[bucketIndex]
    if (bucket) {
      bucket.count += 1
    }
  }

  const points = buckets.map((bucket) => ({
    date: bucket.start,
    label: formatIsoDateLabel(bucket.start),
    count: bucket.count,
  }))

  return {
    points,
    total: points.reduce((sum, point) => sum + point.count, 0),
  }
}

function buildMonthlyCompletionTrend({
  completedDates,
  todayIso,
  startMonthIso,
}: {
  completedDates: string[]
  todayIso: string
  startMonthIso: string
}): CompletionTrend {
  const todayMonthIso = startOfMonthIso(todayIso)
  const monthCount = Math.max(1, getMonthDistance(startMonthIso, todayMonthIso) + 1)
  const months = Array.from({ length: monthCount }, (_, index) =>
    addMonthsIso(startMonthIso, index)
  )
  const counts = new Map(months.map((month) => [month, 0]))

  for (const completedDate of completedDates) {
    const completedMonth = startOfMonthIso(completedDate)
    if (completedDate <= todayIso && counts.has(completedMonth)) {
      counts.set(completedMonth, (counts.get(completedMonth) ?? 0) + 1)
    }
  }

  const points = months.map((month) => ({
    date: month,
    label: new Intl.DateTimeFormat(undefined, { month: 'short' }).format(
      new Date(`${month}T12:00:00`)
    ),
    count: counts.get(month) ?? 0,
  }))

  return {
    points,
    total: points.reduce((sum, point) => sum + point.count, 0),
  }
}

function buildCompletionTrends(
  completedTasks: TaskSummary[],
  timezone: string | null,
  todayIso: string
): Record<CompletionTrendRange, CompletionTrend> {
  const completedDates = completedTasks
    .map((task) => getCompletedIsoDate(task, timezone))
    .filter((date): date is string => Boolean(date))

  return {
    week: buildDailyCompletionTrend({
      completedDates,
      startIso: addDaysIso(todayIso, -6),
      todayIso,
    }),
    month: buildDailyCompletionTrend({
      completedDates,
      startIso: addDaysIso(todayIso, -29),
      todayIso,
    }),
    '3m': buildWeeklyCompletionTrend({ completedDates, todayIso, weeks: 13 }),
    '6m': buildWeeklyCompletionTrend({ completedDates, todayIso, weeks: 26 }),
    year: buildMonthlyCompletionTrend({
      completedDates,
      todayIso,
      startMonthIso: startOfMonthIso(addMonthsIso(todayIso, -11)),
    }),
    ytd: buildMonthlyCompletionTrend({
      completedDates,
      todayIso,
      startMonthIso: `${todayIso.slice(0, 4)}-01-01`,
    }),
  }
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
  const completionTrends = buildCompletionTrends(completedTasks, timezone, todayIso)

  const upcomingTasks = openTasks
    .filter((task) => task.due_date && task.due_date >= todayIso)
    .sort((first, second) => compareNullableStrings(first.due_date, second.due_date, 'asc'))
    .slice(0, 8)

  const recentlyCompletedTasks = [...completedTasks]
    .sort((first, second) =>
      compareNullableStrings(first.completed_at, second.completed_at, 'desc')
    )
    .slice(0, 8)

  const openSummary = summarizeOpenTasks(openTasks, todayIso, weekEndIso)
  const completedByGroupId = countTasksByGroup(completedTasks)
  const groupAnalytics = buildGroupAnalytics(
    groups,
    openSummary.byGroupId,
    completedByGroupId,
    todayIso,
    weekEndIso
  )

  return {
    todayIso,
    weekEndIso,
    upcomingTasks,
    recentlyCompletedTasks,
    completionTrends,
    groupAnalytics,
    counts: {
      open: openTasks.length,
      completed: completedTasks.length,
      ...openSummary.counts,
    },
  }
}

type OpenTaskSummary = {
  byGroupId: Map<string, TaskSummary[]>
  counts: Pick<DesktopAnalytics['counts'], 'overdue' | 'dueToday' | 'dueThisWeek' | 'noDate' | 'needsReview'>
}

function summarizeOpenTasks(
  tasks: TaskSummary[],
  todayIso: string,
  weekEndIso: string
): OpenTaskSummary {
  const summary: OpenTaskSummary = {
    byGroupId: new Map(),
    counts: { overdue: 0, dueToday: 0, dueThisWeek: 0, noDate: 0, needsReview: 0 },
  }

  for (const task of tasks) {
    const groupTasks = summary.byGroupId.get(task.group.id) ?? []
    groupTasks.push(task)
    summary.byGroupId.set(task.group.id, groupTasks)
    updateOpenTaskCounts(summary.counts, task, todayIso, weekEndIso)
  }

  return summary
}

function updateOpenTaskCounts(
  counts: OpenTaskSummary['counts'],
  task: TaskSummary,
  todayIso: string,
  weekEndIso: string
) {
  if (!task.due_date) counts.noDate += 1
  if (task.due_date && task.due_date < todayIso) counts.overdue += 1
  if (task.due_date === todayIso) counts.dueToday += 1
  if (task.due_date && task.due_date >= todayIso && task.due_date <= weekEndIso) {
    counts.dueThisWeek += 1
  }
  if (task.needs_review) counts.needsReview += 1
}

function countTasksByGroup(tasks: TaskSummary[]) {
  const counts = new Map<string, number>()
  for (const task of tasks) {
    counts.set(task.group.id, (counts.get(task.group.id) ?? 0) + 1)
  }
  return counts
}

function buildGroupAnalytics(
  groups: GroupSummary[],
  openByGroupId: Map<string, TaskSummary[]>,
  completedByGroupId: Map<string, number>,
  todayIso: string,
  weekEndIso: string
): GroupAnalytics[] {
  return groups.map((group) => {
    const groupOpen = openByGroupId.get(group.id) ?? []
    return {
      group,
      openCount: groupOpen.length,
      completedCount: completedByGroupId.get(group.id) ?? 0,
      overdueCount: groupOpen.filter((task) => Boolean(task.due_date && task.due_date < todayIso)).length,
      dueThisWeekCount: groupOpen.filter((task) =>
        Boolean(task.due_date && task.due_date >= todayIso && task.due_date <= weekEndIso)
      ).length,
    }
  })
}

export function filterDesktopTasks(
  tasks: TaskSummary[],
  filters: DesktopTaskFilters
): TaskSummary[] {
  const search = filters.search.trim().toLowerCase()
  const predicates: TaskPredicate[] = [
    optionalTaskPredicate(Boolean(search), (task) =>
      [task.title, task.description, task.group.name].filter(Boolean).join(' ').toLowerCase().includes(search)
    ),
    optionalTaskPredicate(filters.groupId !== 'all', (task) => task.group.id === filters.groupId),
    optionalTaskPredicate(filters.dueBucket !== 'all', (task) => task.due_bucket === filters.dueBucket),
    optionalTaskPredicate(Boolean(filters.dueFrom), (task) => Boolean(task.due_date && task.due_date >= filters.dueFrom)),
    optionalTaskPredicate(Boolean(filters.dueTo), (task) => Boolean(task.due_date && task.due_date <= filters.dueTo)),
    reviewPredicates[filters.review] ?? allowTask,
    recurrencePredicates[filters.recurrence] ?? allowTask,
    subtaskPredicates[filters.subtasks] ?? allowTask,
  ]
  return tasks.filter((task) => predicates.every((predicate) => predicate(task)))
}

type TaskPredicate = (task: TaskSummary) => boolean
const allowTask: TaskPredicate = () => true

function optionalTaskPredicate(enabled: boolean, predicate: TaskPredicate): TaskPredicate {
  return enabled ? predicate : allowTask
}

const reviewPredicates: Record<string, TaskPredicate> = {
  needs_review: (task) => task.needs_review,
  clear: (task) => !task.needs_review,
}

const recurrencePredicates: Record<string, TaskPredicate> = {
  recurring: (task) => Boolean(task.recurrence_frequency),
  one_off: (task) => !task.recurrence_frequency,
}

const subtaskPredicates: Record<string, TaskPredicate> = {
  has_subtasks: (task) => task.subtask_count > 0,
  no_subtasks: (task) => task.subtask_count === 0,
}

export function sortDesktopTasks(tasks: TaskSummary[], sort: DesktopSortState): TaskSummary[] {
  return [...tasks].sort((first, second) => {
    const direction = sort.direction === 'asc' ? 1 : -1
    return compareDesktopTaskValue(first, second, sort.key, sort.direction) * direction
  })
}

const desktopTaskComparators: Partial<
  Record<DesktopSortKey, (first: TaskSummary, second: TaskSummary) => number>
> = {
  title: (first, second) => first.title.localeCompare(second.title),
  group: (first, second) => first.group.name.localeCompare(second.group.name),
  review: (first, second) => Number(first.needs_review) - Number(second.needs_review),
  recurrence: (first, second) =>
    (first.recurrence_frequency ?? '').localeCompare(second.recurrence_frequency ?? ''),
}

function compareDesktopTaskValue(
  first: TaskSummary,
  second: TaskSummary,
  key: DesktopSortKey,
  direction: DesktopSortDirection
) {
  const comparator = desktopTaskComparators[key]
  if (comparator) return comparator(first, second)

  const dateKey = key as 'due_date' | 'created_at' | 'completed_at'
  const firstValue = first[dateKey] ?? null
  const secondValue = second[dateKey] ?? null
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
