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
      className="pointer-events-none fixed inset-x-0 bottom-0 z-[80] mx-auto flex w-full max-w-md flex-col-reverse gap-3 px-3 pt-4"
      style={{ paddingBottom: 'max(env(safe-area-inset-bottom), 1.5rem)' }}
    >
      {notifications.map((notification) => {
        const style = notificationStyles[notification.type]

        return (
          <section
            key={notification.id}
            role={notification.type === 'error' ? 'alert' : 'status'}
            className={[
              'pointer-events-auto relative overflow-hidden rounded-soft border p-4 shadow-[0_18px_45px_rgba(0,0,0,0.5)] backdrop-blur-xl',
              'bg-[rgba(16,16,16,0.92)]',
              style.container,
            ].join(' ')}
          >
            <div className={['absolute inset-y-0 left-0 w-1', style.accent].join(' ')} />

            <div className="flex items-start gap-3">
              <div
                className={[
                  'mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-sm',
                  style.iconShell,
                ].join(' ')}
                aria-hidden="true"
              >
                {style.icon}
              </div>

              <div className="min-w-0 flex-1 space-y-3">
                <p className="font-body text-sm font-medium leading-6 text-on-surface">
                  {notification.message}
                </p>

                {notification.actionLabel || notification.dismissible !== false ? (
                  <div className="flex flex-wrap items-center gap-2">
                    {notification.actionLabel && notification.onAction ? (
                      <button
                        type="button"
                        onClick={() => {
                          void notification.onAction?.()
                        }}
                        className={[
                          'rounded-pill px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] transition-all active:scale-95',
                          style.actionButton,
                        ].join(' ')}
                      >
                        {notification.actionLabel}
                      </button>
                    ) : null}

                    {notification.dismissible !== false ? (
                      <button
                        type="button"
                        onClick={() => onDismiss(notification.id)}
                        className="rounded-pill border border-white/10 bg-white/5 px-3 py-1.5 text-xs font-semibold uppercase tracking-[0.12em] text-on-surface-variant transition-colors hover:bg-white/10 hover:text-on-surface"
                      >
                        Dismiss
                      </button>
                    ) : null}
                  </div>
                ) : null}
              </div>
            </div>
          </section>
        )
      })}
    </div>
  )
}

const notificationStyles: Record<
  NotificationType,
  {
    container: string
    accent: string
    iconShell: string
    actionButton: string
    icon: string
  }
> = {
  success: {
    container: 'border-success/35',
    accent: 'bg-success',
    iconShell: 'border-success/30 bg-success/15 text-success',
    actionButton: 'bg-success text-surface hover:bg-success-dim',
    icon: '✓',
  },
  error: {
    container: 'border-error/35',
    accent: 'bg-error',
    iconShell: 'border-error/30 bg-error/15 text-error',
    actionButton: 'bg-error text-white hover:bg-error-dim',
    icon: '!',
  },
  warning: {
    container: 'border-warning/35',
    accent: 'bg-warning',
    iconShell: 'border-warning/30 bg-warning/15 text-warning',
    actionButton: 'bg-warning text-surface hover:bg-warning-dim',
    icon: '!',
  },
  info: {
    container: 'border-secondary/35',
    accent: 'bg-secondary',
    iconShell: 'border-secondary/30 bg-secondary/15 text-secondary',
    actionButton: 'bg-secondary text-surface hover:bg-secondary-dim',
    icon: 'i',
  },
  loading: {
    container: 'border-primary/35',
    accent: 'bg-primary',
    iconShell: 'border-primary/30 bg-primary/15 text-primary',
    actionButton: 'bg-primary text-surface hover:bg-primary-dim',
    icon: '…',
  },
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
    throw new Error('useNotifications must be used within a NotificationsProvider.')
  }

  return context
}
