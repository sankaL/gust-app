import { Check, X } from 'lucide-react'
import { useEffect } from 'react'

import { useSwipeDismiss } from '../hooks/useSwipeDismiss'

type SaveConfirmationToastProps = {
  message: string | null
  onDismiss: () => void
}

export function SaveConfirmationToast({ message, onDismiss }: SaveConfirmationToastProps) {
  const swipe = useSwipeDismiss(onDismiss, Boolean(message))

  useEffect(() => {
    if (!message) return undefined
    const timeoutId = window.setTimeout(onDismiss, 3000)
    return () => window.clearTimeout(timeoutId)
  }, [message, onDismiss])

  if (!message) return null

  return (
    <div className="toast-viewport pointer-events-none fixed inset-x-0 top-0 z-[300] mx-auto flex w-full max-w-md px-3 sm:bottom-0 sm:top-auto">
      <section
        role="status"
        className="animate-toast-enter pointer-events-auto relative flex w-full touch-pan-y select-none items-center gap-3 overflow-hidden rounded-2xl bg-surface-container-high py-2.5 pl-3 pr-2.5 shadow-float ring-1 ring-outline/50"
        style={{
          transform: `translateX(${swipe.offsetX}px)`,
          opacity: swipe.opacity,
          transition: swipe.isDragging ? 'none' : 'transform 160ms ease-out, opacity 160ms ease-out',
        }}
        {...swipe.handlers}
      >
        <span className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full bg-chip-green text-chip-green-ink"><Check className="h-3.5 w-3.5" strokeWidth={3} /></span>
        <p className="min-w-0 flex-1 font-body text-[0.82rem] font-medium leading-5 text-on-surface">{message}</p>
        <button
          type="button"
          onClick={onDismiss}
          className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-on-surface/[0.06] hover:text-on-surface"
          aria-label="Dismiss notification"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
      </section>
    </div>
  )
}
