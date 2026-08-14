import { X } from 'lucide-react'
import { useEffect } from 'react'

type SaveConfirmationToastProps = {
  message: string | null
  onDismiss: () => void
}

export function SaveConfirmationToast({ message, onDismiss }: SaveConfirmationToastProps) {
  useEffect(() => {
    if (!message) return undefined
    const timeoutId = window.setTimeout(onDismiss, 3000)
    return () => window.clearTimeout(timeoutId)
  }, [message, onDismiss])

  if (!message) return null

  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-0 z-[80] mx-auto flex w-full max-w-md px-2 pt-3" style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 1rem)' }}>
      <section role="status" className="pointer-events-auto relative flex w-full items-center gap-2 overflow-hidden rounded-lg bg-[#4F7942] px-3 py-2 shadow-lg">
        <p className="min-w-0 flex-1 font-body text-xs font-medium leading-4 text-white">{message}</p>
        <button
          type="button"
          onClick={onDismiss}
          className="flex h-6 w-6 shrink-0 items-center justify-center text-white/70 transition-colors hover:text-white"
          aria-label="Dismiss notification"
        >
          <X className="h-3.5 w-3.5" strokeWidth={1.8} />
        </button>
      </section>
    </div>
  )
}
