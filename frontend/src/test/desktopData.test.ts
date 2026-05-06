import { afterEach, describe, expect, it, vi } from 'vitest'

import { buildDesktopAnalytics, type CompletionTrendPoint } from '../lib/desktopData'
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

afterEach(() => {
  vi.useRealTimers()
})

describe('desktop analytics', () => {
  it('uses the visible dashboard week for completion trend dates', () => {
    vi.useFakeTimers()
    vi.setSystemTime(new Date('2026-05-03T12:00:00Z'))

    const analytics = buildDesktopAnalytics({
      openTasks: [],
      completedTasks: [
        completedTask('previous-week', '2026-05-02T15:00:00Z'),
        completedTask('today', '2026-05-03T15:00:00Z'),
        completedTask('tomorrow', '2026-05-04T15:00:00Z'),
        completedTask('week-end', '2026-05-09T15:00:00Z'),
      ],
      groups: [],
      timezone: 'UTC',
    })

    expect(analytics.todayIso).toBe('2026-05-03')
    expect(analytics.weekEndIso).toBe('2026-05-09')
    expect(analytics.completionTrend.map((point: CompletionTrendPoint) => point.date)).toEqual([
      '2026-05-03',
      '2026-05-04',
      '2026-05-05',
      '2026-05-06',
      '2026-05-07',
      '2026-05-08',
      '2026-05-09',
    ])
    expect(analytics.completionTrend.map((point: CompletionTrendPoint) => point.count)).toEqual([
      1, 1, 0, 0, 0, 0, 1,
    ])
  })
})
