import { memo, useRef, useState } from 'react'

import { type TaskSummary } from '../lib/api'
import { Card } from './Card'
import { OpenTaskCardContent } from './OpenTaskCardContent'

type OpenTaskCardProps = {
  task: TaskSummary
  onOpen: (taskId: string) => void
  onPrepareOpen?: (taskId: string) => void
  onComplete: (task: TaskSummary) => void
  onDelete?: (task: TaskSummary) => void
  isBusy: boolean
  enableSwipe?: boolean
  showCollapsedGroupLabel?: boolean
}

type SwipeOptions = Pick<OpenTaskCardProps, 'task' | 'onComplete' | 'isBusy'> & {
  enabled: boolean
}

function useTaskCardSwipe({ task, onComplete, isBusy, enabled }: SwipeOptions) {
  const [offsetX, setOffsetX] = useState(0)
  const startXRef = useRef<number | null>(null)
  const pointerIdRef = useRef<number | null>(null)
  const offsetRef = useRef(0)
  const suppressClickRef = useRef(false)

  function reset() {
    startXRef.current = null
    pointerIdRef.current = null
    offsetRef.current = 0
    setOffsetX(0)
  }

  function onPointerDown(event: React.PointerEvent<HTMLElement>) {
    if (!enabled || isBusy) return
    startXRef.current = event.clientX
    pointerIdRef.current = event.pointerId
  }

  function onPointerMove(event: React.PointerEvent<HTMLElement>) {
    if (!enabled || startXRef.current === null || pointerIdRef.current !== event.pointerId) return
    const nextOffset = Math.max(-120, Math.min(120, event.clientX - startXRef.current))
    offsetRef.current = nextOffset
    setOffsetX(nextOffset)
  }

  function onPointerEnd() {
    if (!enabled) return
    if (offsetRef.current >= 90) {
      suppressClickRef.current = true
      onComplete(task)
    }
    reset()
  }

  function consumeSuppressedClick() {
    const shouldSuppress = suppressClickRef.current
    suppressClickRef.current = false
    return shouldSuppress
  }

  return { offsetX, onPointerDown, onPointerMove, onPointerEnd, reset, consumeSuppressedClick }
}

function OpenTaskCardInner({
  task,
  onOpen,
  onPrepareOpen,
  onComplete,
  onDelete,
  isBusy,
  enableSwipe = false,
  showCollapsedGroupLabel = false,
}: OpenTaskCardProps) {
  const [isExpanded, setIsExpanded] = useState(false)
  const swipe = useTaskCardSwipe({ task, onComplete, isBusy, enabled: enableSwipe })

  function activateCard() {
    if (swipe.consumeSuppressedClick()) return
    onPrepareOpen?.(task.id)
    onOpen(task.id)
  }

  function handleCardKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.key !== 'Enter' && event.key !== ' ') return
    event.preventDefault()
    activateCard()
  }

  return (
    <Card
      padding="none"
      className={`relative overflow-hidden bg-surface-container-high ${!task.due_date ? 'opacity-70' : ''}`}
    >
      {enableSwipe && (
        <div className="absolute inset-0 flex items-center justify-start px-6 text-[0.65rem] font-bold uppercase tracking-[0.15em] text-on-surface-variant">
          <span>Swipe right to complete</span>
        </div>
      )}

      <div
        role="button"
        tabIndex={0}
        onClick={activateCard}
        onKeyDown={handleCardKeyDown}
        onPointerDown={swipe.onPointerDown}
        onPointerMove={swipe.onPointerMove}
        onPointerUp={swipe.onPointerEnd}
        onPointerCancel={swipe.reset}
        className="relative z-10 w-full touch-pan-y bg-surface-container-high p-4 text-left transition-transform duration-200"
        style={{ transform: `translateX(${swipe.offsetX}px)` }}
      >
        <OpenTaskCardContent
          task={task}
          isExpanded={isExpanded}
          isBusy={isBusy}
          showCollapsedGroupLabel={showCollapsedGroupLabel}
          onToggleExpanded={() => setIsExpanded((current) => !current)}
          onComplete={() => onComplete(task)}
          onDelete={onDelete ? () => onDelete(task) : undefined}
        />
      </div>
    </Card>
  )
}

export const OpenTaskCard = memo(OpenTaskCardInner)
