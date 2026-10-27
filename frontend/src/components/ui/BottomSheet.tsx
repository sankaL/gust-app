import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, type ReactNode, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import { X } from 'lucide-react'

import { MeasuredGlassWarp } from './MeasuredGlassWarp'

const SKIP_MOTION = import.meta.env.MODE === 'test'
const EXIT_MS = 360
const DISMISS_VELOCITY = 0.55
const DRAG_SLOP_PX = 6
// Matches rounded-t-sheet (2.25rem).
const SHEET_GLASS = { radius: 36, bezel: 22, scale: 40, aberration: 0.05 }

type SheetSize = 'default' | 'auto'

export type BottomSheetProps = {
  open: boolean
  onClose: () => void
  /** id of the element that names the dialog; falls back to `ariaLabel`. */
  labelledBy?: string
  ariaLabel?: string
  size?: SheetSize
  /** When false the sheet ignores backdrop taps, Escape, and drag gestures. */
  dismissible?: boolean
  header?: ReactNode
  footer?: ReactNode
  children: ReactNode
  bodyClassName?: string
  bodyRef?: RefObject<HTMLDivElement | null>
}

// Open sheets stack in mount order so only the top-most one reacts to Escape and owns focus.
const sheetStack: string[] = []
const stackListeners = new Set<() => void>()
let scrollLockCount = 0

function notifyStackChange() {
  stackListeners.forEach((listener) => listener())
}

function lockScroll() {
  scrollLockCount += 1
  if (scrollLockCount === 1) document.body.style.overflow = 'hidden'
}

function unlockScroll() {
  scrollLockCount = Math.max(0, scrollLockCount - 1)
  if (scrollLockCount === 0) document.body.style.overflow = ''
}

function prefersReducedMotion() {
  return typeof window.matchMedia === 'function' && Boolean(window.matchMedia('(prefers-reduced-motion: reduce)')?.matches)
}

function useSheetPresence(open: boolean) {
  const [mounted, setMounted] = useState(open)
  const [visible, setVisible] = useState(open && SKIP_MOTION)

  useEffect(() => {
    if (open) {
      setMounted(true)
      if (SKIP_MOTION || prefersReducedMotion()) {
        setVisible(true)
        return undefined
      }
      let second = 0
      const first = requestAnimationFrame(() => { second = requestAnimationFrame(() => setVisible(true)) })
      return () => { cancelAnimationFrame(first); cancelAnimationFrame(second) }
    }
    setVisible(false)
    if (SKIP_MOTION) {
      setMounted(false)
      return undefined
    }
    const timeoutId = window.setTimeout(() => setMounted(false), EXIT_MS)
    return () => window.clearTimeout(timeoutId)
  }, [open])

  return { shouldRender: open || (mounted && !SKIP_MOTION), visible: open && visible }
}

function useSheetStack(active: boolean) {
  const id = useId()
  const [depth, setDepth] = useState(0)
  const [isCovered, setIsCovered] = useState(false)
  useLayoutEffect(() => {
    if (!active) return undefined
    const sync = () => setIsCovered(sheetStack.indexOf(id) < sheetStack.length - 1)
    sheetStack.push(id)
    setDepth(sheetStack.length)
    stackListeners.add(sync)
    lockScroll()
    notifyStackChange()
    return () => {
      const index = sheetStack.indexOf(id)
      if (index >= 0) sheetStack.splice(index, 1)
      stackListeners.delete(sync)
      unlockScroll()
      notifyStackChange()
    }
  }, [active, id])
  const isTop = useCallback(() => sheetStack[sheetStack.length - 1] === id, [id])
  return { depth, isTop, isCovered }
}

/** True when the touch starts in a nested scroller (e.g. a long textarea) that is not at its top. */
function isInsideScrolledChild(target: EventTarget | null, container: HTMLElement) {
  for (let node = target instanceof Element ? target : null; node && node !== container; node = node.parentElement) {
    if (node.scrollTop > 0) return true
  }
  return false
}

type DragTracking = { startY: number; lastY: number; lastTime: number; velocity: number; active: boolean }

function useSheetDrag({ enabled, panelRef, scrollRef, onDismiss }: {
  enabled: boolean
  panelRef: RefObject<HTMLDivElement | null>
  scrollRef: RefObject<HTMLDivElement | null>
  onDismiss: () => void
}) {
  const [offset, setOffset] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const tracking = useRef<DragTracking | null>(null)
  const onDismissRef = useRef(onDismiss)
  onDismissRef.current = onDismiss

  const begin = useCallback((y: number) => {
    tracking.current = { startY: y, lastY: y, lastTime: performance.now(), velocity: 0, active: false }
  }, [])

  const move = useCallback((y: number) => {
    const state = tracking.current
    if (!state) return false
    const delta = y - state.startY
    if (!state.active) {
      if (Math.abs(delta) < DRAG_SLOP_PX) return false
      state.active = true
      setIsDragging(true)
    }
    const now = performance.now()
    state.velocity = (y - state.lastY) / Math.max(1, now - state.lastTime)
    state.lastY = y
    state.lastTime = now
    // Pulling up past the resting point is damped so the sheet feels anchored.
    setOffset(delta > 0 ? delta : delta * 0.12)
    return true
  }, [])

  const end = useCallback(() => {
    const state = tracking.current
    tracking.current = null
    if (!state?.active) return
    setIsDragging(false)
    const distance = state.lastY - state.startY
    const height = panelRef.current?.offsetHeight ?? 600
    if (distance > Math.min(160, height * 0.28) || state.velocity > DISMISS_VELOCITY) onDismissRef.current()
    // If the owner declines to close (unsaved changes, pending save) the sheet springs back;
    // if it does close, the exit transform takes over from here.
    setOffset(0)
  }, [panelRef])

  // Dragging down from the top of the scroll area pulls the sheet, iOS style.
  useEffect(() => {
    const scrollElement = scrollRef.current
    if (!enabled || !scrollElement) return undefined
    const onTouchStart = (event: TouchEvent) => {
      if (scrollElement.scrollTop > 0 || isInsideScrolledChild(event.target, scrollElement)) return
      begin(event.touches[0]?.clientY ?? 0)
    }
    const onTouchMove = (event: TouchEvent) => {
      const state = tracking.current
      const y = event.touches[0]?.clientY
      if (!state || y === undefined) return
      if (!state.active && (y < state.startY || scrollElement.scrollTop > 0)) {
        tracking.current = null
        return
      }
      if (move(y) && event.cancelable) event.preventDefault()
    }
    scrollElement.addEventListener('touchstart', onTouchStart, { passive: true })
    scrollElement.addEventListener('touchmove', onTouchMove, { passive: false })
    scrollElement.addEventListener('touchend', end)
    scrollElement.addEventListener('touchcancel', end)
    return () => {
      scrollElement.removeEventListener('touchstart', onTouchStart)
      scrollElement.removeEventListener('touchmove', onTouchMove)
      scrollElement.removeEventListener('touchend', end)
      scrollElement.removeEventListener('touchcancel', end)
    }
  }, [begin, enabled, end, move, scrollRef])

  const grabHandlers = enabled ? {
    onPointerDown: (event: React.PointerEvent<HTMLElement>) => {
      if (event.pointerType === 'mouse' && event.button !== 0) return
      begin(event.clientY)
    },
    onPointerMove: (event: React.PointerEvent<HTMLElement>) => {
      if (!tracking.current) return
      const wasActive = tracking.current.active
      if (move(event.clientY) && !wasActive) event.currentTarget.setPointerCapture?.(event.pointerId)
    },
    onPointerUp: end,
    onPointerCancel: end,
  } : {}

  return { offset, setOffset, isDragging, grabHandlers }
}

function focusableElements(container: HTMLElement) {
  return Array.from(container.querySelectorAll<HTMLElement>(
    'a[href], button:not([disabled]), textarea:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
  )).filter((element) => !element.hasAttribute('aria-hidden'))
}

function useSheetFocus(visible: boolean, panelRef: RefObject<HTMLDivElement | null>) {
  useEffect(() => {
    if (!visible) return undefined
    const previous = document.activeElement as HTMLElement | null
    const panel = panelRef.current
    if (panel && !panel.contains(document.activeElement)) panel.focus({ preventScroll: true })
    return () => {
      if (previous && document.contains(previous)) previous.focus({ preventScroll: true })
    }
  }, [panelRef, visible])
}

function trapTab(event: React.KeyboardEvent<HTMLDivElement>) {
  if (event.key !== 'Tab') return
  const items = focusableElements(event.currentTarget)
  if (items.length === 0) return
  const first = items[0]
  const last = items[items.length - 1]
  if (event.shiftKey && document.activeElement === first) { event.preventDefault(); last.focus() }
  else if (!event.shiftKey && document.activeElement === last) { event.preventDefault(); first.focus() }
}

export function BottomSheet(props: BottomSheetProps) {
  const latest = useRef(props)
  if (props.open) latest.current = props
  // While animating out, keep rendering the last open content so the exit is not blank.
  const view = props.open ? props : latest.current
  const { shouldRender, visible } = useSheetPresence(props.open)
  const { depth, isTop, isCovered } = useSheetStack(shouldRender)
  const panelRef = useRef<HTMLDivElement>(null)
  const localScrollRef = useRef<HTMLDivElement>(null)
  const scrollRef = props.bodyRef ?? localScrollRef
  const dismissible = view.dismissible ?? true
  const openRef = useRef(props.open)
  openRef.current = props.open
  // Backdrop, Escape and drag stay mounted during the exit animation; a close request then is a duplicate.
  const requestClose = useCallback(() => { if (dismissible && openRef.current) latest.current.onClose() }, [dismissible])
  const drag = useSheetDrag({ enabled: shouldRender && dismissible, panelRef, scrollRef, onDismiss: requestClose })
  const { setOffset } = drag

  useEffect(() => { if (props.open) setOffset(0) }, [props.open, setOffset])
  useSheetFocus(visible, panelRef)

  useEffect(() => {
    if (!shouldRender) return undefined
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape' && isTop()) { event.stopPropagation(); requestClose() }
    }
    document.addEventListener('keydown', onKeyDown)
    return () => document.removeEventListener('keydown', onKeyDown)
  }, [isTop, requestClose, shouldRender])

  if (!shouldRender || typeof document === 'undefined') return null
  const zIndex = 110 + depth * 10
  // A sheet with another sheet stacked on top recedes slightly, giving the stack visible depth.
  const translate = !visible ? 'translate3d(0, 104%, 0)' : isCovered ? 'translate3d(0, -14px, 0) scale(0.94)' : `translate3d(0, ${Math.max(drag.offset, -24)}px, 0)`
  const sizeClass = (view.size ?? 'default') === 'auto' ? 'sheet-h-auto' : 'sheet-h-default'

  return createPortal(
    // inert while exiting so stale header and footer buttons cannot fire their handlers a second time.
    <div className="fixed inset-0" style={{ zIndex }} inert={!props.open}>
      <div
        aria-hidden="true"
        data-testid="sheet-backdrop"
        onClick={requestClose}
        className="absolute inset-0 bg-backdrop/20 transition-opacity duration-300 ease-out"
        style={{ opacity: visible ? Math.max(0.15, 1 - drag.offset / 500) : 0 }}
      />
      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center">
        <div
          ref={panelRef}
          role="dialog"
          aria-modal="true"
          aria-labelledby={view.labelledBy}
          aria-label={view.labelledBy ? undefined : view.ariaLabel}
          tabIndex={-1}
          onKeyDown={trapTab}
          className={`pointer-events-auto relative flex w-full max-w-xl flex-col overflow-hidden liquid-sheet rounded-t-sheet text-on-surface outline-none ${sizeClass}`}
          style={{
            transform: translate,
            transition: drag.isDragging ? 'none' : `transform ${visible ? 520 : EXIT_MS}ms var(--ease-sheet), filter 400ms ease`,
            filter: isCovered ? 'brightness(0.92)' : undefined,
            transformOrigin: 'top center',
            willChange: 'transform',
          }}
        >
          <MeasuredGlassWarp targetRef={panelRef} active={shouldRender} {...SHEET_GLASS} />
          <div className="shrink-0 touch-none select-none" {...drag.grabHandlers}>
            <div className="flex justify-center pb-1 pt-2.5" aria-hidden="true">
              <span className="h-1.5 w-10 rounded-pill bg-on-surface-variant/25" />
            </div>
            {view.header}
          </div>
          <div ref={scrollRef} className={`min-h-0 flex-1 overscroll-contain ${view.bodyClassName ?? 'overflow-y-auto px-5 pb-6'}`}>
            {view.children}
          </div>
          {view.footer ? (
            <div className="shrink-0 border-t border-outline/30 bg-surface-container-high/35 px-5 pb-[max(1rem,calc(var(--safe-area-bottom)+0.75rem))] pt-3 backdrop-blur-xl">
              {view.footer}
            </div>
          ) : <div className="h-[var(--safe-area-bottom)] shrink-0" />}
        </div>
      </div>
    </div>,
    document.body,
  )
}

export function SheetHeader({ eyebrow, title, titleId, onClose, closeLabel = 'Close', actions, centered = false, children }: {
  eyebrow?: ReactNode
  title: ReactNode
  titleId?: string
  onClose?: () => void
  closeLabel?: string
  actions?: ReactNode
  // Centers the eyebrow and title on the sheet; side controls sit in balanced outer columns.
  centered?: boolean
  children?: ReactNode
}) {
  return (
    <div className="px-5 pb-3 pt-1">
      <div className={centered ? 'grid grid-cols-[1fr_auto_1fr] items-start gap-3' : 'flex items-start justify-between gap-3'}>
        {centered ? <span aria-hidden="true" /> : null}
        <div className={centered ? 'min-w-0 text-center' : 'min-w-0 flex-1'}>
          {eyebrow ? <p className="font-body text-[0.7rem] font-semibold uppercase tracking-[0.16em] text-on-surface-variant">{eyebrow}</p> : null}
          <h2 id={titleId} className="mt-0.5 font-display text-[1.45rem] font-bold leading-tight tracking-[-0.01em] text-on-surface">{title}</h2>
        </div>
        <div className={centered ? 'flex shrink-0 items-center justify-end gap-2' : 'flex shrink-0 items-center gap-2'} onPointerDown={(event) => event.stopPropagation()}>
          {actions}
          {onClose ? (
            <button
              type="button"
              onClick={onClose}
              aria-label={closeLabel}
              className="clay-obsidian flex h-10 w-10 items-center justify-center rounded-full text-on-surface-variant hover:text-on-surface"
            >
              <X className="h-[1.1rem] w-[1.1rem]" strokeWidth={2.2} />
            </button>
          ) : null}
        </div>
      </div>
      {children}
    </div>
  )
}
