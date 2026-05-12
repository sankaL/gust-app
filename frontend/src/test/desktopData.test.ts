import { afterEach, describe, expect, it, vi } from 'vitest'

import {
  buildDesktopAnalytics,
  type CompletionTrendPoint,
} from '../lib/desktopData'
import type { TaskSummary } from '../lib/api'

function completedTask(id: string, completedAt: string): TaskSummary {
  return {
    id,
    title: id,
    description: null,
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
