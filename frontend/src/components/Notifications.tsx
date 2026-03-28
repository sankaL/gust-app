import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type PropsWithChildren,
} from 'react'

export type NotificationType = 'success' | 'error' | 'warning' | 'info' | 'loading'

export type NotificationInput = {
  id?: string
  type: NotificationType
  message: string
  actionLabel?: string
  onAction?: () => void | Promise<void>
  dismissible?: boolean
  durationMs?: number | null
}

export type NotificationRecord = NotificationInput & {
  id: string
}

type NotificationContextValue = {
  notifications: NotificationRecord[]
  showNotification: (notification: NotificationInput) => string
  updateNotification: (id: string, notification: Partial<NotificationInput>) => void
  dismissNotification: (id: string) => void
  notifySuccess: (message: string, options?: Omit<NotificationInput, 'type' | 'message'>) => string
  notifyError: (message: string, options?: Omit<NotificationInput, 'type' | 'message'>) => string
  notifyWarning: (message: string, options?: Omit<NotificationInput, 'type' | 'message'>) => string
  notifyInfo: (message: string, options?: Omit<NotificationInput, 'type' | 'message'>) => string
  notifyLoading: (message: string, options?: Omit<NotificationInput, 'type' | 'message'>) => string
}

const DEFAULT_DURATION_MS = 3000
const DEFAULT_ACTION_DURATION_MS = 5500
const DEFAULT_LOADING_DURATION_MS = null

const NotificationContext = createContext<NotificationContextValue | null>(null)

let notificationSequence = 0

function generateNotificationId() {
  notificationSequence += 1
  return `notification-${notificationSequence}`
}

function resolveDuration(notification: NotificationInput) {
  if (notification.durationMs !== undefined) {
    return notification.durationMs
  }

  if (notification.type === 'loading') {
    return DEFAULT_LOADING_DURATION_MS
  }

  if (notification.actionLabel && notification.onAction) {
    return DEFAULT_ACTION_DURATION_MS
  }

  return DEFAULT_DURATION_MS
}

type IconProps = {
  className?: string
}

function CloseIcon({ className }: IconProps) {
  return (
    <svg viewBox="0 0 16 16" fill="none" aria-hidden="true" className={className}>
      <path d="M4.2 4.2l7.6 7.6" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
      <path d="M11.8 4.2L4.2 11.8" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
    </svg>
  )
}

// Swipe hook for touch gestures
function useSwipeToDismiss(
  onDismiss: () => void,
  enabled: boolean = true
) {
  const [translate, setTranslate] = useState({ x: 0, y: 0 })
  const [opacity, setOpacity] = useState(1)
  const startPos = useRef<{ x: number; y: number } | null>(null)
  const isDragging = useRef(false)

  const handleTouchStart = useCallback((e: React.TouchEvent) => {
    if (!enabled) return
    const touch = e.touches[0]
    startPos.current = { x: touch.clientX, y: touch.clientY }
    isDragging.current = true
  }, [enabled])

  const handleTouchMove = useCallback((e: React.TouchEvent) => {
    if (!enabled || !isDragging.current || !startPos.current) return
    const touch = e.touches[0]
    const deltaX = touch.clientX - startPos.current.x
    const deltaY = touch.clientY - startPos.current.y

    // Only respond to meaningful movements (more horizontal or vertical)
    const absX = Math.abs(deltaX)
    const absY = Math.abs(deltaY)

    if (absX > 10 || absY > 10) {
      // Prefer the dominant direction
      if (absY > absX) {
        // Vertical swipe
        setTranslate({ x: deltaX * 0.2, y: deltaY })
        setOpacity(Math.max(0.3, 1 - Math.abs(deltaY) / 300))
      } else {
        // Horizontal swipe
        setTranslate({ x: deltaX, y: deltaY * 0.2 })
        setOpacity(Math.max(0.3, 1 - Math.abs(deltaX) / 300))
      }
    }
  }, [enabled])

  const handleTouchEnd = useCallback(() => {
    if (!enabled) return
    const threshold = 100
    const { x, y } = translate

    // Dismiss if swiped far enough in any direction
    if (Math.abs(x) > threshold || Math.abs(y) > threshold) {
      onDismiss()
    } else {
      // Snap back
      setTranslate({ x: 0, y: 0 })
      setOpacity(1)
    }

    startPos.current = null
    isDragging.current = false
  }, [enabled, translate, onDismiss])

  const handleMouseDown = useCallback((e: React.MouseEvent) => {
    if (!enabled) return
    startPos.current = { x: e.clientX, y: e.clientY }
    isDragging.current = true
  }, [enabled])

  const handleMouseMove = useCallback((e: React.MouseEvent) => {
    if (!enabled || !isDragging.current || !startPos.current) return
    const deltaX = e.clientX - startPos.current.x
    const deltaY = e.clientY - startPos.current.y

    const absX = Math.abs(deltaX)
    const absY = Math.abs(deltaY)

    if (absX > 5 || absY > 5) {
      if (absY > absX) {
        setTranslate({ x: deltaX * 0.2, y: deltaY })
        setOpacity(Math.max(0.3, 1 - Math.abs(deltaY) / 300))
      } else {
        setTranslate({ x: deltaX, y: deltaY * 0.2 })
        setOpacity(Math.max(0.3, 1 - Math.abs(deltaX) / 300))
      }
    }
  }, [enabled])

  const handleMouseUp = useCallback(() => {
    if (!enabled) return
    const threshold = 100
    const { x, y } = translate

    if (Math.abs(x) > threshold || Math.abs(y) > threshold) {
      onDismiss()
    } else {
      setTranslate({ x: 0, y: 0 })
      setOpacity(1)
    }

    startPos.current = null
    isDragging.current = false
  }, [enabled, translate, onDismiss])

  return {
    translate,
    opacity,
    handlers: enabled ? {
      onTouchStart: handleTouchStart,
      onTouchMove: handleTouchMove,
      onTouchEnd: handleTouchEnd,
      onMouseDown: handleMouseDown,
      onMouseMove: handleMouseMove,
      onMouseUp: handleMouseUp,
      onMouseLeave: handleMouseUp,
    } : {},
  }
}

// Notification colors
const NOTIFICATION_COLORS: Record<NotificationType, string> = {
  success: '#4F7942',
  error: '#F54927',
  warning: '#F58027',
  info: '#4682B4',
  loading: '#A684FF',
}

const notificationStyles: Record<
  NotificationType,
  {
    background: string
    actionButton: string
  }
> = {
  success: {
    background: NOTIFICATION_COLORS.success,
    actionButton: 'bg-white text-[#4F7942] hover:bg-white/90 active:scale-95',
  },
  error: {
    background: NOTIFICATION_COLORS.error,
    actionButton: 'bg-white text-[#F54927] hover:bg-white/90 active:scale-95',
  },
  warning: {
    background: NOTIFICATION_COLORS.warning,
    actionButton: 'bg-white text-[#F58027] hover:bg-white/90 active:scale-95',
  },
  info: {
    background: NOTIFICATION_COLORS.info,
    actionButton: 'bg-white text-[#4682B4] hover:bg-white/90 active:scale-95',
  },
  loading: {
    background: NOTIFICATION_COLORS.loading,
    actionButton: 'bg-white text-[#A684FF] hover:bg-white/90 active:scale-95',
  },
}

// Helper to check if currently dragging
function isDragging(handlers: Record<string, unknown>): boolean {
  return 'onMouseDown' in handlers
}

function SwipeableNotification({
  notification,
  onDismiss,
}: {
  notification: NotificationRecord
  onDismiss: () => void
}) {
  const style = notificationStyles[notification.type]
  const isLoading = notification.type === 'loading'

  const { translate, opacity, handlers } = useSwipeToDismiss(
    onDismiss,
    !isLoading && notification.dismissible !== false
  )

  return (
    <section
      role={notification.type === 'error' ? 'alert' : 'status'}
      style={{
        transform: `translate(${translate.x}px, ${translate.y}px)`,
        opacity,
        transition: isDragging(handlers) ? 'none' : 'transform 200ms ease-out, opacity 200ms ease-out',
      }}
      className={[
        'pointer-events-auto relative cursor-grab select-none overflow-hidden rounded-lg shadow-lg active:cursor-grabbing',
      ].join(' ')}
      {...handlers}
    >
      {/* Solid background */}
      <div
        className="flex items-center gap-2 px-3 py-2"
        style={{ backgroundColor: style.background }}
      >
        {/* Message */}
        <p className="min-w-0 flex-1 font-body text-xs font-medium leading-4 text-white">
          {notification.message}
        </p>

        {/* Action button (Undo) - prominent */}
        {notification.actionLabel && notification.onAction ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              void notification.onAction?.()
            }}
            className={[
              'shrink-0 rounded-full px-3 py-1.5 text-xs font-semibold transition-all',
              style.actionButton,
            ].join(' ')}
          >
            {notification.actionLabel}
          </button>
        ) : null}

        {/* Dismiss button - subtle (only if no action) */}
        {notification.dismissible !== false && !notification.actionLabel ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onDismiss()
            }}
            className="flex h-6 w-6 shrink-0 items-center justify-center text-white/70 transition-colors hover:text-white"
            aria-label="Dismiss notification"
          >
            <CloseIcon className="h-3.5 w-3.5" />
          </button>
        ) : null}
      </div>
    </section>
  )
}

function NotificationViewport({
  notifications,
  onDismiss,
}: {
  notifications: NotificationRecord[]
  onDismiss: (id: string) => void
}) {
  if (notifications.length === 0) {
    return null
  }

  return (
    <div
      aria-live="polite"
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[80] mx-auto flex w-full max-w-md flex-col-reverse gap-1.5 px-2 pt-3"
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 1rem)' }}
    >
      {notifications.map((notification) => (
        <SwipeableNotification
          key={notification.id}
          notification={notification}
          onDismiss={() => onDismiss(notification.id)}
        />
      ))}
    </div>
  )
}

export function NotificationsProvider({ children }: PropsWithChildren) {
  const [notifications, setNotifications] = useState<NotificationRecord[]>([])
  const timersRef = useRef<Map<string, number>>(new Map())

  const dismissNotification = useCallback((id: string) => {
    const timerId = timersRef.current.get(id)
    if (timerId !== undefined) {
      window.clearTimeout(timerId)
      timersRef.current.delete(id)
    }

    setNotifications((current) => current.filter((notification) => notification.id !== id))
  }, [])

  const showNotification = useCallback((notification: NotificationInput) => {
    const id = notification.id ?? generateNotificationId()
    const nextNotification: NotificationRecord = {
      ...notification,
      id,
      dismissible: notification.dismissible ?? true,
      durationMs: resolveDuration(notification),
    }

    setNotifications((current) => [...current, nextNotification])
    return id
  }, [])

  const updateNotification = useCallback((id: string, notification: Partial<NotificationInput>) => {
    const timerId = timersRef.current.get(id)
    if (timerId !== undefined) {
      window.clearTimeout(timerId)
      timersRef.current.delete(id)
    }

    setNotifications((current) =>
      current.map((item) => {
        if (item.id !== id) {
          return item
        }

        const next = {
          ...item,
          ...notification,
        }

        return {
          ...next,
          durationMs:
            notification.durationMs !== undefined ? notification.durationMs : resolveDuration(next),
          dismissible:
            notification.dismissible !== undefined ? notification.dismissible : next.dismissible,
        }
      })
    )
  }, [])

  useEffect(() => {
    const timers = timersRef.current

    notifications.forEach((notification) => {
      if (notification.durationMs == null || timers.has(notification.id)) {
        return
      }

      const timerId = window.setTimeout(() => {
        timers.delete(notification.id)
        dismissNotification(notification.id)
      }, notification.durationMs)

      timers.set(notification.id, timerId)
    })

    timers.forEach((timerId, id) => {
      if (notifications.some((notification) => notification.id === id)) {
        return
      }

      window.clearTimeout(timerId)
      timers.delete(id)
    })
  }, [dismissNotification, notifications])

  useEffect(() => {
    const timers = timersRef.current

    return () => {
      timers.forEach((timerId) => {
        window.clearTimeout(timerId)
      })
      timers.clear()
    }
  }, [])

  const value = useMemo<NotificationContextValue>(
    () => ({
      notifications,
      showNotification,
      updateNotification,
      dismissNotification,
      notifySuccess: (message, options) => showNotification({ ...options, type: 'success', message }),
      notifyError: (message, options) => showNotification({ ...options, type: 'error', message }),
      notifyWarning: (message, options) => showNotification({ ...options, type: 'warning', message }),
      notifyInfo: (message, options) => showNotification({ ...options, type: 'info', message }),
      notifyLoading: (message, options) => showNotification({ ...options, type: 'loading', message }),
    }),
    [dismissNotification, notifications, showNotification, updateNotification]
  )

  return (
    <NotificationContext.Provider value={value}>
      {children}
      <NotificationViewport notifications={notifications} onDismiss={dismissNotification} />
    </NotificationContext.Provider>
  )
}

// eslint-disable-next-line react-refresh/only-export-components
export function useNotifications() {
  const context = useContext(NotificationContext)
  if (!context) {
    throw new Error('useNotifications must be used within a NotificationsProvider')
  }
  return context
}
