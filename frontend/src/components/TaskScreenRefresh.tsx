import {
  type ReactNode,
  type TouchEvent,
  useCallback,
  useRef,
  useState,
} from 'react'

type TaskScreenRefreshButtonProps = {
  isRefreshing: boolean
  label: string
  onRefresh: () => void | Promise<void>
}

type PullToRefreshProps = {
  children: ReactNode
  disabled?: boolean
  isRefreshing: boolean
  onRefresh: () => void | Promise<void>
  getScrollTop?: () => number
}

const PULL_REFRESH_THRESHOLD_PX = 72

export function TaskScreenRefreshButton({
  isRefreshing,
  label,
  onRefresh,
}: TaskScreenRefreshButtonProps) {
  return (
    <div className="flex items-center justify-end gap-2">
      {isRefreshing ? (
        <span className="font-body text-xs font-medium text-on-surface-variant">
          Refreshing...
        </span>
      ) : null}
      <button
        type="button"
        onClick={() => {
          void onRefresh()
        }}
        disabled={isRefreshing}
        aria-label={label}
        title={label}
        className="inline-flex h-10 w-10 shrink-0 items-center justify-center rounded-full border border-primary/35 bg-[radial-gradient(circle_at_top,_rgba(196,181,253,0.26),_rgba(36,36,36,0.98)_68%)] text-primary shadow-[0_4px_0_rgba(23,16,51,0.92),_0_8px_14px_rgba(0,0,0,0.34),_inset_0_1px_2px_rgba(255,255,255,0.14)] outline-none transition-all duration-200 hover:-translate-y-[1px] hover:border-primary/55 hover:text-white hover:shadow-[0_5px_0_rgba(23,16,51,0.92),_0_11px_18px_rgba(0,0,0,0.42),_inset_0_1px_3px_rgba(255,255,255,0.18)] active:translate-y-[4px] active:shadow-[0_0px_0_rgba(23,16,51,0.92),_0_3px_7px_rgba(0,0,0,0.38),_inset_0_2px_5px_rgba(0,0,0,0.24)] disabled:cursor-wait disabled:opacity-70 disabled:hover:translate-y-0"
      >
        <svg
          aria-hidden="true"
          className={['h-5 w-5 drop-shadow-[0_0_8px_rgba(186,158,255,0.32)]', isRefreshing ? 'animate-spin' : ''].join(' ')}
          fill="none"
          stroke="currentColor"
          viewBox="0 0 24 24"
          strokeWidth={2.25}
        >
          <path
            strokeLinecap="round"
            strokeLinejoin="round"
            d="M4 4v5h5M20 20v-5h-5M6.05 9A7 7 0 0 1 17.7 6.3L20 9M4 15l2.3 2.7A7 7 0 0 0 17.95 15"
          />
        </svg>
      </button>
    </div>
  )
}

export function PullToRefresh({
  children,
  disabled = false,
  isRefreshing,
  onRefresh,
  getScrollTop,
}: PullToRefreshProps) {
  const startYRef = useRef<number | null>(null)
  const isRefreshingRef = useRef(false)
  const [pullDistance, setPullDistance] = useState(0)

  const triggerRefresh = useCallback(() => {
    if (isRefreshingRef.current || isRefreshing) {
      return
    }

    isRefreshingRef.current = true
    void Promise.resolve(onRefresh()).finally(() => {
      isRefreshingRef.current = false
    })
  }, [isRefreshing, onRefresh])

  function handleTouchStart(event: TouchEvent<HTMLDivElement>) {
    if (disabled || isRefreshing) {
      return
    }

    const currentScrollTop = getScrollTop?.() ?? window.scrollY
    if (currentScrollTop > 0) {
      startYRef.current = null
      return
    }

    startYRef.current = event.touches[0]?.clientY ?? null
  }

  function handleTouchMove(event: TouchEvent<HTMLDivElement>) {
    if (startYRef.current === null || disabled || isRefreshing) {
      return
    }

    const nextY = event.touches[0]?.clientY
    if (nextY === undefined) {
      return
    }

    const distance = Math.max(0, nextY - startYRef.current)
    setPullDistance(Math.min(distance, PULL_REFRESH_THRESHOLD_PX + 24))
  }

  function handleTouchEnd() {
    if (pullDistance >= PULL_REFRESH_THRESHOLD_PX) {
      triggerRefresh()
    }

    startYRef.current = null
    setPullDistance(0)
  }

  return (
    <div
      data-testid="pull-to-refresh"
      onTouchStart={handleTouchStart}
      onTouchMove={handleTouchMove}
      onTouchEnd={handleTouchEnd}
      onTouchCancel={handleTouchEnd}
    >
      {pullDistance > 0 ? (
        <div
          aria-hidden="true"
          className="flex items-center justify-center overflow-hidden transition-[height]"
          style={{ height: `${Math.round(pullDistance / 2)}px` }}
        >
          <div className="h-1.5 w-10 rounded-pill bg-primary/50" />
        </div>
      ) : null}
      {children}
    </div>
  )
}
