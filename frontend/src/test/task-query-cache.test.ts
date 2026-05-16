import { QueryClient } from '@tanstack/react-query'
import { describe, expect, it } from 'vitest'

import type { TaskSummary } from '../lib/api'
import { applyTaskListMutation, prependTaskToMatchingLists } from '../lib/taskQueryCache'

function buildTask(overrides: Partial<TaskSummary> = {}): TaskSummary {
  return {
    id: 'task-1',
    title: 'Review extraction contract',
    description: null,
    series_id: null,
    recurrence_frequency: null,
    status: 'open',
    needs_review: false,
    due_date: null,
    reminder_at: null,
    due_bucket: 'no_date',
    group: {
      id: 'group-1',
      name: 'Inbox',
      is_system: true,
    },
    completed_at: null,
    deleted_at: null,
    created_at: '2026-04-29T02:00:00.000Z',
    updated_at: '2026-04-29T02:00:00.000Z',
    subtask_count: 0,
    ...overrides,
  }
}

describe('task query cache helpers', () => {
  it('moves tasks between desktop task caches during status changes', () => {
    const queryClient = new QueryClient()
    const openTask = buildTask()
    const completedTask = buildTask({
      status: 'completed',
      completed_at: '2026-04-29T02:05:00.000Z',
    })

    queryClient.setQueryData(['desktop', 'tasks', 'all', 'open'], [openTask])
    queryClient.setQueryData(['desktop', 'tasks', 'all', 'completed'], [])

    applyTaskListMutation(queryClient, (currentTask, statusSegment) => {
      if (currentTask.id !== completedTask.id) {
        return currentTask
      }
      return statusSegment === completedTask.status ? { ...currentTask, ...completedTask } : null
    })
    prependTaskToMatchingLists(queryClient, completedTask, completedTask.status)

    expect(queryClient.getQueryData(['desktop', 'tasks', 'all', 'open'])).toEqual([])
    expect(queryClient.getQueryData(['desktop', 'tasks', 'all', 'completed'])).toEqual([
      completedTask,
    ])
  })
})
