import { useEffect, type RefObject } from 'react'

export function useFloatingDismiss(
  isOpen: boolean,
  primaryRef: RefObject<HTMLElement | null>,
  secondaryRef: RefObject<HTMLElement | null>,
  onDismiss: () => void,
  onOpen?: () => void
) {
  useEffect(() => {
    if (!isOpen) return undefined
    function handlePointer(event: MouseEvent) {
      const target = event.target as Node
      if (!primaryRef.current?.contains(target) && !secondaryRef.current?.contains(target)) onDismiss()
    }
    document.addEventListener('mousedown', handlePointer)
    onOpen?.()
    return () => document.removeEventListener('mousedown', handlePointer)
  }, [isOpen, onDismiss, onOpen, primaryRef, secondaryRef])
}

export function useEscapeDismiss(isOpen: boolean, onDismiss: () => void) {
  useEffect(() => {
    if (!isOpen) return undefined
    const handleKeyDown = (event: KeyboardEvent) => { if (event.key === 'Escape') onDismiss() }
    document.addEventListener('keydown', handleKeyDown)
    return () => document.removeEventListener('keydown', handleKeyDown)
  }, [isOpen, onDismiss])
}
