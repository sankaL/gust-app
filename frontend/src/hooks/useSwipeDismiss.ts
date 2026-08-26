import { useCallback, useEffect, useRef, useState, type TouchEventHandler } from 'react'

const DRAG_START_PX = 8
const DISMISS_DISTANCE_PX = 64

export function useSwipeDismiss(onDismiss: () => void, enabled = true) {
  const [offsetX, setOffsetX] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const offsetRef = useRef(0)

  const reset = useCallback(() => {
    startRef.current = null
    offsetRef.current = 0
    setOffsetX(0)
    setIsDragging(false)
  }, [])

  useEffect(() => {
    if (!enabled) reset()
  }, [enabled, reset])

  const onTouchStart = useCallback<TouchEventHandler<HTMLElement>>((event) => {
    if (!enabled) return
    const touch = event.touches[0]
    startRef.current = { x: touch.clientX, y: touch.clientY }
    offsetRef.current = 0
  }, [enabled])

  const onTouchMove = useCallback<TouchEventHandler<HTMLElement>>((event) => {
    const start = startRef.current
    const touch = event.touches[0]
    if (!enabled || !start || !touch) return

    const deltaX = touch.clientX - start.x
    const deltaY = touch.clientY - start.y
    if (!isDragging && Math.abs(deltaX) < DRAG_START_PX) return
    if (!isDragging && Math.abs(deltaY) > Math.abs(deltaX)) {
      reset()
      return
    }

    event.preventDefault()
    offsetRef.current = deltaX
    setOffsetX(deltaX)
    setIsDragging(true)
  }, [enabled, isDragging, reset])

  const onTouchEnd = useCallback<TouchEventHandler<HTMLElement>>(() => {
    if (!enabled) return
    if (Math.abs(offsetRef.current) >= DISMISS_DISTANCE_PX) {
      onDismiss()
    }
    reset()
  }, [enabled, onDismiss, reset])

  return {
    handlers: enabled ? {
      onTouchStart,
      onTouchMove,
      onTouchEnd,
      onTouchCancel: reset,
    } : {},
    isDragging,
    offsetX,
    opacity: Math.max(0.35, 1 - Math.abs(offsetX) / 180),
  }
}
