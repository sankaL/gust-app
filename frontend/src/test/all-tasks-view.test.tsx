import { render, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { AllTasksView } from '../components/AllTasksView'
import { listAllTasks } from '../lib/api'

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return {
    ...actual,
    listAllTasks: vi.fn(),
  }
})

type ObserverInstance = {
  callback: IntersectionObserverCallback
  observed: Element[]
  options?: IntersectionObserverInit
  disconnect: ReturnType<typeof vi.fn>
}

const observerInstances: ObserverInstance[] = []

class MockIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null
  readonly rootMargin: string
  readonly thresholds: ReadonlyArray<number>

  private readonly instance: ObserverInstance

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.root = options?.root ?? null
    this.rootMargin = options?.rootMargin ?? ''
    this.thresholds = Array.isArray(options?.threshold)
      ? options.threshold
      : [options?.threshold ?? 0]
    this.instance = {
      callback,
      observed: [],
      options,
      disconnect: vi.fn(),
    }
    observerInstances.push(this.instance)
  }

  disconnect() {
    this.instance.disconnect()
  }

  observe(target: Element) {
    this.instance.observed.push(target)
  }

  takeRecords(): IntersectionObserverEntry[] {
    return []
  }

  unobserve(target: Element) {
    this.instance.observed = this.instance.observed.filter((candidate) => candidate !== target)
  }
}

function createClient() {
  return new QueryClient({
    defaultOptions: {
      queries: {
        retry: false,
      },
    },
  })
}

const mockedListAllTasks = vi.mocked(listAllTasks)

beforeEach(() => {
  observerInstances.length = 0
  vi.stubGlobal('IntersectionObserver', MockIntersectionObserver)
})

afterEach(() => {
  vi.unstubAllGlobals()
  vi.clearAllMocks()
})

describe('AllTasksView', () => {
  it('observes the load-more sentinel within the internal scroll container', async () => {
    mockedListAllTasks
      .mockResolvedValueOnce({
        items: [
          {
            id: 'task-1',
            title: 'Book dentist appointment',
            description: null,
            status: 'open',
            needs_review: false,
            due_date: null,
            reminder_at: null,
            due_bucket: 'no_date',
            group: { id: 'group-1', name: 'Inbox', is_system: true },
            completed_at: null,
            deleted_at: null,
            subtask_count: 0,
          },
        ],
        has_more: true,
        next_cursor: 'cursor-2',
      })
      .mockResolvedValueOnce({
        items: [],
        has_more: false,
        next_cursor: null,
      })

    const client = createClient()

    render(
      <QueryClientProvider client={client}>
        <AllTasksView
          userTimezone="UTC"
          onTaskOpen={vi.fn()}
          onTaskComplete={vi.fn()}
          onTaskDelete={vi.fn()}
        />
      </QueryClientProvider>
    )

    await waitFor(() => expect(observerInstances).toHaveLength(1))

    const observer = observerInstances[0]
    const sentinel = observer.observed[0] as HTMLElement | undefined
    const root = observer.options?.root as HTMLElement | null | undefined

    expect(root).toBeTruthy()
    expect(sentinel).toBeTruthy()
    expect(root?.contains(sentinel ?? null)).toBe(true)

    observer.callback(
      [
        {
          isIntersecting: true,
          target: sentinel as Element,
          boundingClientRect: sentinel?.getBoundingClientRect() ?? new DOMRectReadOnly(),
          intersectionRatio: 1,
          intersectionRect: new DOMRectReadOnly(),
          rootBounds: root?.getBoundingClientRect() ?? null,
          time: 0,
        },
      ],
      {} as IntersectionObserver
    )

    await waitFor(() =>
      expect(mockedListAllTasks).toHaveBeenNthCalledWith(2, 'open', 'cursor-2', 50)
    )
  })
})
