import { act, renderHook } from '@testing-library/react'
import { useRef } from 'react'
import { describe, expect, it } from 'vitest'

import type { VirtualTaskItem } from '../components/VirtualTaskRows'
import { useTaskVirtualizer } from '../hooks/useAllTasksViewModel'
import type { TaskSummary } from '../lib/api'

function taskItem(id: string): VirtualTaskItem {
  return { type: 'task', task: { id, title: id } as TaskSummary }
}

function useProbe(items: VirtualTaskItem[]) {
  const listRef = useRef<HTMLDivElement>(null)
  return useTaskVirtualizer(items, listRef)
}

describe('task list virtualizer', () => {
  it('keeps measured card heights when the list changes, so cards never overlap', () => {
    const header: VirtualTaskItem = { type: 'header', sectionKey: 'today', label: 'Today', count: 2 }
    const initial = [header, taskItem('a'), taskItem('b')]
    const { result, rerender } = renderHook(({ items }) => useProbe(items), { initialProps: { items: initial } })

    // A card with subtasks measured taller than the estimate.
    act(() => { result.current.getVirtualItems(); result.current.resizeItem(1, 260) })
    rerender({ items: [...initial, taskItem('c')] })

    result.current.getVirtualItems()
    const sizes = result.current.measurementsCache
    expect(sizes[1]?.size).toBe(260)
    expect(sizes[2]?.start).toBe((sizes[1]?.start ?? 0) + 260)
  })

  it('measures layout height rather than the transformed box', () => {
    const { result } = renderHook(() => useProbe([taskItem('a')]))
    const card = document.createElement('div')
    Object.defineProperty(card, 'offsetHeight', { value: 180 })
    card.getBoundingClientRect = () => ({ height: 90 }) as DOMRect

    expect(result.current.options.measureElement?.(card, undefined, result.current)).toBe(180)
  })
})
