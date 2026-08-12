import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildGroupNavigationSignals,
  buildDesktopAnalytics,
  buildWeeklyBoardColumns,
  EMPTY_DESKTOP_FILTERS,
  filterDesktopTasks,
  sortDesktopTasks,
  getTodayIsoDate,
  type CompletionTrendPoint,
} from '../lib/desktopData'
import type { TaskSummary } from '../lib/api'

function completedTask(id: string, completedAt: string): TaskSummary {
  return {
    id,
    title: id,
    description: null,
    series_id: null,
    recurrence_frequency: null,
    status: 'completed',
    needs_review: false,
    due_date: null,
    reminder_at: null,
    due_bucket: 'no_date',
    group: {
      id: 'inbox-1',
      name: 'Inbox',
      is_system: true,
    },
    completed_at: completedAt,
    deleted_at: null,
    created_at: completedAt,
    updated_at: completedAt,
    subtask_count: 0,
  }
}

function buildAnalytics(completedTasks: TaskSummary[], timezone = 'UTC') {
  return buildDesktopAnalytics({
    openTasks: [],
    completedTasks,
    groups: [],
    timezone,
  })
}

afterEach(() => {
  vi.useRealTimers()
})

describe('desktop analytics', () => {
  it('uses the Toronto calendar date across the UTC rollover boundary', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-08-13T02:00:00Z'))

    expect(getTodayIsoDate('America/Toronto')).toBe('2026-08-12')
    expect(getTodayIsoDate('UTC')).toBe('2026-08-13')

    const dueToday = {
      ...completedTask('due-today', '2026-08-12T12:00:00Z'),
      status: 'open' as const,
      due_date: '2026-08-12',
      due_bucket: 'due_soon' as const,
      completed_at: null,
    }
    const columns = buildWeeklyBoardColumns([dueToday], 'America/Toronto')
    expect(columns.find((column) => column.label === 'Today')?.tasks).toEqual([dueToday])
    expect(columns.find((column) => column.label === 'Overdue')?.tasks).toEqual([])
  })

  it('uses the trailing seven days through today for the weekly completion trend', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-03T12:00:00Z'))

    const analytics = buildAnalytics([
      completedTask('before-range', '2026-04-26T15:00:00Z'),
      completedTask('range-start', '2026-04-27T15:00:00Z'),
      completedTask('yesterday', '2026-05-02T15:00:00Z'),
      completedTask('today', '2026-05-03T15:00:00Z'),
      completedTask('tomorrow', '2026-05-04T15:00:00Z'),
    ])

    expect(analytics.todayIso).toBe('2026-05-03')
    expect(analytics.weekEndIso).toBe('2026-05-09')
    expect(analytics.completionTrends.week.points.map((point) => point.date)).toEqual([
      '2026-04-27',
      '2026-04-28',
      '2026-04-29',
      '2026-04-30',
      '2026-05-01',
      '2026-05-02',
      '2026-05-03',
    ])
    expect(analytics.completionTrends.week.points.map((point: CompletionTrendPoint) => point.count)).toEqual([
      1, 0, 0, 0, 0, 1, 1,
    ])
    expect(analytics.completionTrends.week.total).toBe(3)
  })

  it('counts only completions inside the trailing thirty-day month range', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-03T12:00:00Z'))

    const analytics = buildAnalytics([
      completedTask('outside', '2026-04-03T15:00:00Z'),
      completedTask('start', '2026-04-04T15:00:00Z'),
      completedTask('middle', '2026-04-18T15:00:00Z'),
      completedTask('today', '2026-05-03T15:00:00Z'),
      completedTask('future', '2026-05-04T15:00:00Z'),
    ])

    expect(analytics.completionTrends.month.points).toHaveLength(30)
    expect(analytics.completionTrends.month.points[0]?.date).toBe('2026-04-04')
    expect(analytics.completionTrends.month.points.at(-1)?.date).toBe('2026-05-03')
    expect(analytics.completionTrends.month.total).toBe(3)
  })

  it('groups three-month and six-month ranges into weekly buckets', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-03T12:00:00Z'))

    const completedTasks = [
      completedTask('three-month-start', '2026-02-02T15:00:00Z'),
      completedTask('month-boundary-a', '2026-03-31T15:00:00Z'),
      completedTask('month-boundary-b', '2026-04-01T15:00:00Z'),
      completedTask('six-month-start', '2025-11-03T15:00:00Z'),
      completedTask('outside-six-months', '2025-11-02T15:00:00Z'),
    ]

    const analytics = buildAnalytics(completedTasks)

    expect(analytics.completionTrends['3m'].points).toHaveLength(13)
    expect(analytics.completionTrends['3m'].points[0]?.date).toBe('2026-02-02')
    expect(analytics.completionTrends['3m'].total).toBe(3)
    expect(analytics.completionTrends['6m'].points).toHaveLength(26)
    expect(analytics.completionTrends['6m'].points[0]?.date).toBe('2025-11-03')
    expect(analytics.completionTrends['6m'].total).toBe(4)
  })

  it('counts trailing-year and year-to-date monthly completion buckets', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-03T12:00:00Z'))

    const analytics = buildAnalytics([
      completedTask('outside-year', '2025-05-01T15:00:00Z'),
      completedTask('year-start', '2025-06-15T15:00:00Z'),
      completedTask('december', '2025-12-15T15:00:00Z'),
      completedTask('january', '2026-01-10T15:00:00Z'),
      completedTask('may', '2026-05-03T15:00:00Z'),
      completedTask('future', '2026-06-01T15:00:00Z'),
    ])

    expect(analytics.completionTrends.year.points.map((point) => point.date)).toEqual([
      '2025-06-01',
      '2025-07-01',
      '2025-08-01',
      '2025-09-01',
      '2025-10-01',
      '2025-11-01',
      '2025-12-01',
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
      '2026-04-01',
      '2026-05-01',
    ])
    expect(analytics.completionTrends.year.total).toBe(4)
    expect(analytics.completionTrends.ytd.points.map((point) => point.date)).toEqual([
      '2026-01-01',
      '2026-02-01',
      '2026-03-01',
      '2026-04-01',
      '2026-05-01',
    ])
    expect(analytics.completionTrends.ytd.total).toBe(2)
  })

  it('uses the session timezone before bucketing completions', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-03T12:00:00Z'))

    const analytics = buildAnalytics(
      [
        completedTask('toronto-may-second', '2026-05-03T03:30:00Z'),
        completedTask('toronto-may-third', '2026-05-03T04:30:00Z'),
      ],
      'America/Toronto'
    )

    const maySecond = analytics.completionTrends.week.points.find(
      (point) => point.date === '2026-05-02'
    )
    const mayThird = analytics.completionTrends.week.points.find(
      (point) => point.date === '2026-05-03'
    )

    expect(maySecond?.count).toBe(1)
    expect(mayThird?.count).toBe(1)
  })
})

describe('desktop group navigation signals', () => {
  it('prioritizes overdue work, then review, then reminders', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-03T12:00:00Z'))
    const groups = [
      { id: 'inbox-1', name: 'Inbox', description: null, is_system: true, system_key: 'inbox', open_task_count: 2, completed_task_count: 0 },
      { id: 'work', name: 'Work', description: null, is_system: false, system_key: null, open_task_count: 1, completed_task_count: 0 },
      { id: 'home', name: 'Home', description: null, is_system: false, system_key: null, open_task_count: 1, completed_task_count: 0 },
      { id: 'clear', name: 'Clear', description: null, is_system: false, system_key: null, open_task_count: 0, completed_task_count: 0 },
    ]
    const overdue = { ...completedTask('overdue', '2026-05-01T12:00:00Z'), status: 'open' as const, due_date: '2026-05-02', group: { id: 'inbox-1', name: 'Inbox', is_system: true } }
    const review = { ...completedTask('review', '2026-05-01T12:00:00Z'), status: 'open' as const, needs_review: true, reminder_at: '2026-05-03T15:00:00Z', group: { id: 'work', name: 'Work', is_system: false } }
    const reminder = { ...completedTask('reminder', '2026-05-01T12:00:00Z'), status: 'open' as const, reminder_at: '2026-05-03T15:00:00Z', group: { id: 'home', name: 'Home', is_system: false } }

    const signals = buildGroupNavigationSignals(groups, [overdue, review, reminder], 'UTC')

    expect(signals.get('inbox-1')).toEqual({ tone: 'overdue', label: '1 overdue' })
    expect(signals.get('work')).toEqual({ tone: 'review', label: '1 need review' })
    expect(signals.get('home')).toEqual({ tone: 'reminder', label: '1 reminder set' })
    expect(signals.get('clear')).toEqual({ tone: 'clear', label: 'Clear' })
  })
})

describe('desktop weekly board', () => {
  it('shows overdue, today, four future days, and no-date work', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-03T12:00:00Z'))

    const columns = buildWeeklyBoardColumns([], 'UTC')

    expect(columns.map((column) => column.key)).toEqual([
      'overdue',
      'date-2026-05-03',
      'date-2026-05-04',
      'date-2026-05-05',
      'date-2026-05-06',
      'date-2026-05-07',
      'no-date',
    ])
  })
})

describe('desktop task filtering and sorting', () => {
  const alpha = {
    ...completedTask('alpha', '2026-05-03T15:00:00Z'),
    title: 'Alpha plan',
    description: 'Launch checklist',
    status: 'open' as const,
    needs_review: true,
    due_date: '2026-05-05',
    due_bucket: 'due_soon' as const,
    recurrence_frequency: 'weekly' as const,
    subtask_count: 2,
  }
  const beta = {
    ...completedTask('beta', '2026-05-02T15:00:00Z'),
    title: 'Beta note',
    status: 'open' as const,
    group: { id: 'work', name: 'Work', is_system: false },
    due_date: null,
    due_bucket: 'no_date' as const,
  }

  it('applies every supported filter independently', () => {
    const tasks = [alpha, beta]
    const cases = [
      { search: 'checklist' },
      { groupId: 'inbox-1' },
      { dueBucket: 'due_soon' },
      { dueFrom: '2026-05-04' },
      { dueTo: '2026-05-06' },
      { review: 'needs_review' },
      { recurrence: 'recurring' },
      { subtasks: 'has_subtasks' },
    ]
    for (const filters of cases) {
      expect(filterDesktopTasks(tasks, { ...EMPTY_DESKTOP_FILTERS, ...filters })).toEqual([alpha])
    }
  })

  it('supports inverse filters and combined filtering', () => {
    expect(filterDesktopTasks([alpha, beta], { ...EMPTY_DESKTOP_FILTERS, review: 'clear' })).toEqual([beta])
    expect(filterDesktopTasks([alpha, beta], { ...EMPTY_DESKTOP_FILTERS, recurrence: 'one_off' })).toEqual([beta])
    expect(filterDesktopTasks([alpha, beta], { ...EMPTY_DESKTOP_FILTERS, subtasks: 'no_subtasks' })).toEqual([beta])
    expect(filterDesktopTasks([alpha, beta], { ...EMPTY_DESKTOP_FILTERS, search: 'plan', groupId: 'work' })).toEqual([])
  })

  it('sorts every supported desktop column in both directions', () => {
    const tasks = [beta, alpha]
    const expectations = {
      title: { asc: ['alpha', 'beta'], desc: ['beta', 'alpha'] },
      group: { asc: ['alpha', 'beta'], desc: ['beta', 'alpha'] },
      due_date: { asc: ['alpha', 'beta'], desc: ['alpha', 'beta'] },
      created_at: { asc: ['beta', 'alpha'], desc: ['alpha', 'beta'] },
      completed_at: { asc: ['beta', 'alpha'], desc: ['alpha', 'beta'] },
      review: { asc: ['beta', 'alpha'], desc: ['alpha', 'beta'] },
      recurrence: { asc: ['beta', 'alpha'], desc: ['alpha', 'beta'] },
    } as const
    for (const key of Object.keys(expectations) as Array<keyof typeof expectations>) {
      expect(sortDesktopTasks(tasks, { key, direction: 'asc' }).map((task) => task.id)).toEqual(expectations[key].asc)
      expect(sortDesktopTasks(tasks, { key, direction: 'desc' }).map((task) => task.id)).toEqual(expectations[key].desc)
    }
  })
})
