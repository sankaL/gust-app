import { act, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

vi.mock('@tanstack/react-virtual', async () => {
  const React = await vi.importActual<typeof import('react')>('react')

  return {
    useVirtualizer: ({
      count,
      estimateSize,
      getItemKey,
    }: {
      count: number
      estimateSize: (index: number) => number
      getItemKey?: (index: number) => string
    }) => {
      const cacheRef = React.useRef(new Map<string, number>())
      const [revision, setRevision] = React.useState(0)
      const measureElement = React.useMemo(() => vi.fn(), [])
      const keys = React.useMemo(
        () => Array.from({ length: count }, (_, index) => String(getItemKey?.(index) ?? index)),
        [count, getItemKey]
      )
      const sizes = React.useMemo(
        () => Array.from({ length: count }, (_, index) => estimateSize(index)),
        [count, estimateSize]
      )
      const totalSize = React.useMemo(
        () => sizes.reduce((sum, size) => sum + size, 0),
        [sizes]
      )

      React.useEffect(() => {
        if (cacheRef.current.size > 0 || keys.length === 0) {
          return
        }

        let offset = 0
        const nextCache = new Map<string, number>()
        keys.forEach((key, index) => {
          nextCache.set(key, offset)
          offset += sizes[index]
        })
        cacheRef.current = nextCache
      }, [keys, sizes])

      const measure = React.useCallback(() => {
        mockVirtualizerMeasureCallCount += 1
        let offset = 0
        const nextCache = new Map<string, number>()
        keys.forEach((key, index) => {
          nextCache.set(key, offset)
          offset += sizes[index]
        })
        cacheRef.current = nextCache
        setRevision((current) => current + 1)
      }, [keys, sizes])

      const virtualItems = React.useMemo(() => {
        let fallbackOffset = 0
        return keys.map((key, index) => {
          const start = cacheRef.current.get(key) ?? fallbackOffset
          fallbackOffset += sizes[index]
          return {
            index,
            key,
            start,
          }
        })
      }, [keys, sizes, revision])

      const instanceRef = React.useRef({
        getTotalSize: () => totalSize,
        getVirtualItems: () => virtualItems,
        measureElement,
        measure,
      })

      instanceRef.current.getTotalSize = () => totalSize
      instanceRef.current.getVirtualItems = () => virtualItems
      instanceRef.current.measure = measure

      return instanceRef.current
    },
  }
})

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
let mockVirtualizerMeasureCallCount = 0

class MockIntersectionObserver implements IntersectionObserver {
  readonly root: Element | Document | null
  readonly rootMargin: string
  readonly thresholds: ReadonlyArray<number>
  readonly scrollMargin: string

  private readonly instance: ObserverInstance

  constructor(callback: IntersectionObserverCallback, options?: IntersectionObserverInit) {
    this.root = options?.root ?? null
    this.rootMargin = options?.rootMargin ?? ''
    this.thresholds = Array.isArray(options?.threshold)
      ? options.threshold
      : [options?.threshold ?? 0]
    this.scrollMargin = ''
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
  mockVirtualizerMeasureCallCount = 0
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

  it('re-measures remaining rows after a deleted task removes an entire section', async () => {
    const todayTask = {
      id: 'task-delete-today',
      title: 'Delete from today section',
      description: null,
      status: 'open' as const,
      needs_review: false,
      due_date: new Date().toISOString().slice(0, 10),
      reminder_at: null,
      due_bucket: 'due_soon' as const,
      group: { id: 'inbox-1', name: 'Inbox', is_system: true },
      completed_at: null,
      deleted_at: null,
      subtask_count: 0,
    }
    const otherTask = {
      id: 'task-keep-others',
      title: 'Keep in later section',
      description: null,
      status: 'open' as const,
      needs_review: false,
      due_date: null,
      reminder_at: null,
      due_bucket: 'no_date' as const,
      group: { id: 'personal-1', name: 'Personal', is_system: false },
      completed_at: null,
      deleted_at: null,
      subtask_count: 0,
    }

    mockedListAllTasks
      .mockResolvedValueOnce({
        items: [todayTask, otherTask],
        has_more: false,
        next_cursor: null,
      })
      .mockResolvedValueOnce({
        items: [otherTask],
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

    expect(await screen.findByText('Today')).toBeInTheDocument()
    expect(screen.getByText('Delete from today section')).toBeInTheDocument()
    expect(screen.getByText('Keep in later section')).toBeInTheDocument()

    const othersHeaderBeforeDelete = screen.getByText('Others').parentElement
    if (!othersHeaderBeforeDelete) {
      throw new Error('Expected Others section header before delete')
    }
    expect(othersHeaderBeforeDelete).toHaveStyle({ transform: 'translateY(148px)' })

    await act(async () => {
      await client.invalidateQueries({ queryKey: ['tasks', 'all', 'open', 'infinite'] })
    })

    await waitFor(() => {
      expect(mockedListAllTasks).toHaveBeenCalledTimes(2)
      expect(screen.queryByText('Today')).not.toBeInTheDocument()
      expect(screen.queryByText('Delete from today section')).not.toBeInTheDocument()
    })

    await waitFor(() => {
      const othersHeaderAfterDelete = screen.getByText('Others').parentElement
      if (!othersHeaderAfterDelete) {
        throw new Error('Expected Others section header after delete')
      }
      expect(othersHeaderAfterDelete).toHaveStyle({ transform: 'translateY(0px)' })
    })

    expect(mockVirtualizerMeasureCallCount).toBeGreaterThanOrEqual(2)
  })
})
