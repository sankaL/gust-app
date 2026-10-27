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

import { useSwipeDismiss } from '../hooks/useSwipeDismiss'

type NotificationType = 'success' | 'error' | 'warning' | 'info' | 'loading'

type NotificationInput = {
  id?: string
  type: NotificationType
  message: string
  actionLabel?: string
  onAction?: () => void | Promise<void>
  dismissible?: boolean
  durationMs?: number | null
}

type NotificationRecord = NotificationInput & {
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

const notificationStyles: Record<NotificationType, { icon: string; accent: string; action: string }> = {
  success: { icon: 'bg-chip-green text-chip-green-ink', accent: 'bg-success', action: 'bg-chip-green text-chip-green-ink' },
  error: { icon: 'bg-chip-rose text-chip-rose-ink', accent: 'bg-error', action: 'bg-chip-rose text-chip-rose-ink' },
  warning: { icon: 'bg-chip-amber text-chip-amber-ink', accent: 'bg-warning', action: 'bg-chip-amber text-chip-amber-ink' },
  info: { icon: 'bg-chip-blue text-chip-blue-ink', accent: 'bg-info', action: 'bg-chip-blue text-chip-blue-ink' },
  loading: { icon: 'bg-chip-violet text-chip-violet-ink', accent: 'bg-primary', action: 'bg-chip-violet text-chip-violet-ink' },
}

function NotificationGlyph({ type }: { type: NotificationType }) {
  if (type === 'loading') return <span className="h-3.5 w-3.5 animate-spin rounded-full border-2 border-current border-r-transparent" />
  const paths: Record<Exclude<NotificationType, 'loading'>, string> = {
    success: 'M5 12.5l4.5 4.5L19 7.5',
    error: 'M7 7l10 10M17 7L7 17',
    warning: 'M12 7v6m0 4h.01',
    info: 'M12 11v6m0-10h.01',
  }
  return (
    <svg viewBox="0 0 24 24" fill="none" aria-hidden="true" className="h-3.5 w-3.5">
      <path d={paths[type]} stroke="currentColor" strokeWidth={3} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
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

  const { offsetX, opacity, isDragging, handlers } = useSwipeDismiss(
    onDismiss,
    !isLoading && notification.dismissible !== false
  )

  return (
    <section
      role={notification.type === 'error' ? 'alert' : 'status'}
      style={{
        transform: `translateX(${offsetX}px)`,
        opacity,
        transition: isDragging ? 'none' : 'transform 160ms ease-out, opacity 160ms ease-out',
      }}
      className="animate-toast-enter pointer-events-auto relative select-none overflow-hidden rounded-2xl bg-surface-container-high shadow-float ring-1 ring-outline/50 touch-pan-y"
      data-type={notification.type}
      {...handlers}
    >
      <div className="flex items-center gap-3 py-2.5 pl-3 pr-2.5">
        <span className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-full ${style.icon}`}>
          <NotificationGlyph type={notification.type} />
        </span>
        <p className="min-w-0 flex-1 font-body text-[0.82rem] font-medium leading-5 text-on-surface">
          {notification.message}
        </p>

        {notification.actionLabel && notification.onAction ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              void notification.onAction?.()
            }}
            className={`shrink-0 rounded-full px-3.5 py-1.5 text-xs font-bold transition-transform active:scale-95 ${style.action}`}
          >
            {notification.actionLabel}
          </button>
        ) : null}

        {notification.dismissible !== false && !notification.actionLabel ? (
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation()
              onDismiss()
            }}
            className="flex h-7 w-7 shrink-0 items-center justify-center rounded-full text-on-surface-variant transition-colors hover:bg-on-surface/[0.06] hover:text-on-surface"
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
      className="toast-viewport pointer-events-none fixed inset-x-0 top-0 z-[300] mx-auto flex w-full max-w-md flex-col-reverse gap-2 px-3 sm:bottom-0 sm:top-auto"
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
