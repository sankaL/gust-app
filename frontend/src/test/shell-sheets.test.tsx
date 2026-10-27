import { act, fireEvent, render, screen } from '@testing-library/react'
import { createMemoryRouter, RouterProvider } from 'react-router-dom'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { BottomSheet } from '../components/ui/BottomSheet'
import { useShellSheets } from '../hooks/useShellSheets'

// jsdom's PointerEvent drops clientY, so drag gestures need a MouseEvent-backed shim.
class TestPointerEvent extends MouseEvent {
  pointerId: number
  pointerType: string
  constructor(type: string, init: PointerEventInit = {}) {
    super(type, init)
    this.pointerId = init.pointerId ?? 1
    this.pointerType = init.pointerType ?? 'touch'
  }
}
window.PointerEvent = TestPointerEvent as unknown as typeof PointerEvent

type Sheets = ReturnType<typeof useShellSheets>

function renderSheets(initialEntries: string[]) {
  const current: { sheets: Sheets | null } = { sheets: null }
  function Probe() {
    current.sheets = useShellSheets()
    return null
  }
  const router = createMemoryRouter([{ path: '*', element: <Probe /> }], { initialEntries, initialIndex: initialEntries.length - 1 })
  render(<RouterProvider router={router} />)
  return { router, sheets: () => current.sheets as Sheets }
}

function location(router: ReturnType<typeof createMemoryRouter>) {
  return `${router.state.location.pathname}${router.state.location.search}`
}

describe('shell sheets', () => {
  // jsdom reports a single history entry, which would skip the navigate(-1) path entirely.
  beforeEach(() => { Object.defineProperty(window.history, 'length', { configurable: true, get: () => 3 }) })
  afterEach(() => { Reflect.deleteProperty(window.history, 'length') })

  it('pops only one history entry when close fires twice', () => {
    const { router, sheets } = renderSheets(['/start', '/tasks'])
    act(() => { sheets().openSheet('account') })
    expect(location(router)).toBe('/tasks?sheet=account')

    // A double tap (or a backdrop tap while the sheet animates out) closes twice before navigation lands.
    const staleClose = sheets().closeSheet
    act(() => { staleClose(); staleClose() })
    expect(location(router)).toBe('/tasks')

    // A close callback captured while the sheet was open is a no-op once it has closed.
    act(() => { staleClose() })
    expect(location(router)).toBe('/tasks')
  })

  it('closes a sheet that replaced a deep-linked one without leaving the page', () => {
    const { router, sheets } = renderSheets(['/start', '/tasks?sheet=capture'])
    act(() => { sheets().openSheet('review') })
    expect(location(router)).toBe('/tasks?sheet=review')

    act(() => { sheets().closeSheet() })
    expect(location(router)).toBe('/tasks')
  })

  it('closes a reopened entry after navigating back and forward', async () => {
    const { router, sheets } = renderSheets(['/tasks'])
    act(() => { sheets().openSheet('account') })
    act(() => { sheets().closeSheet() })
    await act(() => router.navigate(1))
    expect(location(router)).toBe('/tasks?sheet=account')

    act(() => { sheets().closeSheet() })
    expect(location(router)).toBe('/tasks')
  })
})

function sheetPanel() {
  return screen.getByRole('dialog')
}

function dragDown(grabArea: Element, distance: number) {
  fireEvent.pointerDown(grabArea, { clientY: 0, pointerId: 1 })
  fireEvent.pointerMove(grabArea, { clientY: distance / 2, pointerId: 1 })
  fireEvent.pointerMove(grabArea, { clientY: distance, pointerId: 1 })
  fireEvent.pointerUp(grabArea, { clientY: distance, pointerId: 1 })
}

function touch(target: Element, type: 'touchstart' | 'touchmove' | 'touchend', clientY: number) {
  const event = new Event(type, { bubbles: true, cancelable: true })
  Object.defineProperty(event, 'touches', { value: type === 'touchend' ? [] : [{ clientY }] })
  fireEvent(target, event)
}

describe('bottom sheet', () => {
  it('springs back when the owner declines a swipe dismiss', () => {
    const onClose = vi.fn()
    render(<BottomSheet open onClose={onClose} ariaLabel="Edit task"><p>Body</p></BottomSheet>)
    const grabArea = sheetPanel().children[1]

    dragDown(grabArea, 300)

    expect(onClose).toHaveBeenCalledTimes(1)
    expect(sheetPanel().style.transform).toBe('translate3d(0, 0px, 0)')
  })

  it('closes on backdrop tap and Escape, but not when not dismissible', () => {
    const onClose = vi.fn()
    const { rerender } = render(<BottomSheet open onClose={onClose} ariaLabel="Account"><p>Body</p></BottomSheet>)
    fireEvent.click(screen.getByTestId('sheet-backdrop'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)

    rerender(<BottomSheet open dismissible={false} onClose={onClose} ariaLabel="Account"><p>Body</p></BottomSheet>)
    fireEvent.click(screen.getByTestId('sheet-backdrop'))
    fireEvent.keyDown(document, { key: 'Escape' })
    expect(onClose).toHaveBeenCalledTimes(2)
  })

  it('locks page scroll while open and restores it on close', () => {
    const { rerender } = render(<BottomSheet open onClose={() => undefined} ariaLabel="Account"><p>Body</p></BottomSheet>)
    expect(document.body.style.overflow).toBe('hidden')
    rerender(<BottomSheet open={false} onClose={() => undefined} ariaLabel="Account"><p>Body</p></BottomSheet>)
    expect(document.body.style.overflow).toBe('')
  })

  it('lets a scrolled textarea scroll instead of pulling the sheet down', () => {
    const onClose = vi.fn()
    render(<BottomSheet open onClose={onClose} ariaLabel="Capture"><textarea aria-label="Note" defaultValue="long note" /></BottomSheet>)
    const textarea = screen.getByLabelText('Note')
    textarea.scrollTop = 40

    touch(textarea, 'touchstart', 0)
    touch(textarea, 'touchmove', 120)
    touch(textarea, 'touchmove', 300)
    touch(textarea, 'touchend', 300)

    expect(onClose).not.toHaveBeenCalled()
    expect(sheetPanel().style.transform).toBe('translate3d(0, 0px, 0)')
  })
})
