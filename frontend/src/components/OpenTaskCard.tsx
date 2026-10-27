import { memo, useEffect, useRef, useState } from 'react'
import { Check, Trash2 } from 'lucide-react'

import { type TaskSummary } from '../lib/api'
import { OpenTaskCardContent } from './OpenTaskCardContent'

type OpenTaskCardProps = {
  task: TaskSummary
  todayIso: string
  onOpen: (taskId: string) => void
  onPrepareOpen?: (taskId: string) => void
  onComplete: (task: TaskSummary) => void
  onDelete?: (task: TaskSummary) => void
  isBusy: boolean
  enableSwipe?: boolean
  showCollapsedGroupLabel?: boolean
  highlighted?: boolean
}

const SWIPE_LIMIT_PX = 132
const SWIPE_COMMIT_PX = 92
const COMPLETE_ANIMATION_MS = 320

type SwipeOptions = { enabled: boolean; canDelete: boolean; onCommitRight: () => void; onCommitLeft: () => void }

function useTaskCardSwipe({ enabled, canDelete, onCommitRight, onCommitLeft }: SwipeOptions) {
  const [offsetX, setOffsetX] = useState(0)
  const [isDragging, setIsDragging] = useState(false)
  const startRef = useRef<{ x: number; y: number } | null>(null)
  const axisRef = useRef<'x' | 'y' | null>(null)
  const offsetRef = useRef(0)
  const suppressClickRef = useRef(false)

  function reset() {
    startRef.current = null
    axisRef.current = null
    offsetRef.current = 0
    setOffsetX(0)
    setIsDragging(false)
  }

  function onPointerDown(event: React.PointerEvent<HTMLElement>) {
    if (!enabled || (event.pointerType === 'mouse' && event.button !== 0)) return
    startRef.current = { x: event.clientX, y: event.clientY }
    axisRef.current = null
  }

  function onPointerMove(event: React.PointerEvent<HTMLElement>) {
    const start = startRef.current
    if (!enabled || !start) return
    const deltaX = event.clientX - start.x
    const deltaY = event.clientY - start.y
    if (!axisRef.current) {
      if (Math.abs(deltaX) < 8 && Math.abs(deltaY) < 8) return
      axisRef.current = Math.abs(deltaX) > Math.abs(deltaY) ? 'x' : 'y'
      if (axisRef.current === 'x') { setIsDragging(true); event.currentTarget.setPointerCapture?.(event.pointerId) }
    }
    if (axisRef.current !== 'x') return
    const bounded = Math.max(canDelete ? -SWIPE_LIMIT_PX : 0, Math.min(SWIPE_LIMIT_PX, deltaX))
    // Past the commit point the card resists, signalling the action will fire on release.
    const resisted = Math.abs(bounded) > SWIPE_COMMIT_PX ? Math.sign(bounded) * (SWIPE_COMMIT_PX + (Math.abs(bounded) - SWIPE_COMMIT_PX) * 0.4) : bounded
    offsetRef.current = resisted
    setOffsetX(resisted)
  }

  function onPointerEnd() {
    if (!enabled) return
    const offset = offsetRef.current
    if (axisRef.current === 'x') suppressClickRef.current = true
    if (offset >= SWIPE_COMMIT_PX) onCommitRight()
    else if (offset <= -SWIPE_COMMIT_PX && canDelete) onCommitLeft()
    reset()
  }

  function consumeSuppressedClick() {
    const shouldSuppress = suppressClickRef.current
    suppressClickRef.current = false
    return shouldSuppress
  }

  return { offsetX, isDragging, onPointerDown, onPointerMove, onPointerEnd, reset, consumeSuppressedClick }
}

function SwipeBackdrop({ offsetX }: { offsetX: number }) {
  const progress = Math.min(1, Math.abs(offsetX) / SWIPE_COMMIT_PX)
  if (offsetX === 0) return null
  const completing = offsetX > 0
  return (
    <div aria-hidden="true" className={`absolute inset-0 flex items-center px-6 ${completing ? 'justify-start bg-chip-green text-chip-green-ink' : 'justify-end bg-chip-rose text-chip-rose-ink'}`}>
      <span className="flex items-center gap-2 font-body text-xs font-bold uppercase tracking-[0.14em]" style={{ opacity: progress, transform: `scale(${0.8 + progress * 0.2})` }}>
        {completing ? <><Check className="h-5 w-5" strokeWidth={3} />Complete</> : <>Delete<Trash2 className="h-5 w-5" strokeWidth={2.4} /></>}
      </span>
    </div>
  )
}

function OpenTaskCardInner({
  task,
  todayIso,
  onOpen,
  onPrepareOpen,
  onComplete,
  onDelete,
  isBusy,
  enableSwipe = false,
  showCollapsedGroupLabel = false,
  highlighted = false,
}: OpenTaskCardProps) {
  const [isCompleting, setIsCompleting] = useState(false)
  const completeTimer = useRef<number | null>(null)
  useEffect(() => () => { if (completeTimer.current !== null) window.clearTimeout(completeTimer.current) }, [])

  function complete() {
    if (isBusy || isCompleting) return
    setIsCompleting(true)
    // Let the check draw before the task leaves the list.
    completeTimer.current = window.setTimeout(() => {
      completeTimer.current = null
      setIsCompleting(false)
      onComplete(task)
    }, import.meta.env.MODE === 'test' ? 0 : COMPLETE_ANIMATION_MS)
  }

  const swipe = useTaskCardSwipe({
    enabled: enableSwipe && !isBusy,
    canDelete: Boolean(onDelete),
    onCommitRight: complete,
    onCommitLeft: () => onDelete?.(task),
  })

  function activateCard() {
    if (swipe.consumeSuppressedClick()) return
    onPrepareOpen?.(task.id)
    onOpen(task.id)
  }

  function handleCardKeyDown(event: React.KeyboardEvent<HTMLElement>) {
    if (event.target !== event.currentTarget || (event.key !== 'Enter' && event.key !== ' ')) return
    event.preventDefault()
    activateCard()
  }

  return (
    <article
      className={`relative overflow-hidden rounded-[1.4rem] shadow-card ring-1 ring-inset transition-[opacity,transform] duration-300 ease-out-expo ${highlighted ? 'ring-card-active-line/35' : 'ring-outline/40'} ${isCompleting ? 'scale-[0.985] opacity-70' : ''} ${!task.due_date && !highlighted ? 'opacity-[0.92]' : ''}`}
    >
      {enableSwipe ? <SwipeBackdrop offsetX={swipe.offsetX} /> : null}
      <div
        role="button"
        tabIndex={0}
        aria-label={`Open ${task.title}`}
        onClick={activateCard}
        onKeyDown={handleCardKeyDown}
        onPointerDown={swipe.onPointerDown}
        onPointerMove={swipe.onPointerMove}
        onPointerUp={swipe.onPointerEnd}
        onPointerCancel={swipe.reset}
        onMouseEnter={() => onPrepareOpen?.(task.id)}
        className={`group relative z-10 w-full cursor-pointer touch-pan-y select-none p-4 text-left outline-none transition-[transform,background-color] focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-primary/60 active:bg-surface-container-highest ${highlighted ? 'bg-card-active' : 'bg-surface-container-high'} ${swipe.isDragging ? 'duration-0' : 'duration-500 ease-out-expo'}`}
        style={{ transform: `translate3d(${swipe.offsetX}px, 0, 0)` }}
      >
        <OpenTaskCardContent
          task={task}
          todayIso={todayIso}
          isBusy={isBusy}
          isCompleting={isCompleting}
          showGroup={showCollapsedGroupLabel}
          onComplete={complete}
          onDelete={onDelete ? () => onDelete(task) : undefined}
        />
      </div>
    </article>
  )
}

export const OpenTaskCard = memo(OpenTaskCardInner)
