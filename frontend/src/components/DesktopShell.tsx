import { useMemo } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BarChart3,
  CheckCircle2,
  ClipboardList,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Mic,
  Plus,
  Settings2,
} from 'lucide-react'
import { Link, Navigate, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom'

import {
  ApiError,
  getSessionStatus,
  listGroups,
  logoutSession,
  type GroupSummary,
  type SessionStatus,
} from '../lib/api'
import { TASK_SCREEN_GC_TIME_MS, TASK_SCREEN_STALE_TIME_MS } from '../lib/taskScreenCache'
import { useNotifications } from './Notifications'

export type DesktopOutletContext = {
  session: SessionStatus
  groups: GroupSummary[]
  isGroupsLoading: boolean
}

const primaryNavigation = [
  { to: '/desktop', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/desktop/tasks', label: 'All Tasks', icon: ClipboardList, end: true },
  { to: '/desktop/completed', label: 'Completed', icon: CheckCircle2, end: true },
  { to: '/desktop/groups', label: 'Groups', icon: Settings2, end: true },
]

function buildLoginPath(pathname: string, search: string, authError?: string) {
  const nextPath = `${pathname}${search}`
  const params = new URLSearchParams({ next: nextPath })
  if (authError) {
    params.set('auth_error', authError)
  }
  return `/login?${params.toString()}`
}

function buildAvatarLabel(displayName: string | null, email: string) {
  const source = (displayName?.trim() || email.split('@')[0] || 'G').replace(/\s+/g, ' ')
  const parts = source.split(' ').filter(Boolean)
  if (parts.length >= 2) {
    return `${parts[0][0]}${parts[1][0]}`.toUpperCase()
  }
  return source.slice(0, 2).toUpperCase()
}

function buildFriendlyMessage(error: unknown, fallback: string) {
  if (error instanceof ApiError) {
    return error.message
  }
  return fallback
}

export function DesktopShell() {
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { notifyError } = useNotifications()

  const sessionQuery = useQuery({
    queryKey: ['session-status'],
    queryFn: getSessionStatus,
    retry: false,
  })

  const groupsQuery = useQuery({
    queryKey: ['groups'],
    queryFn: listGroups,
    enabled: sessionQuery.data?.signed_in === true,
    staleTime: TASK_SCREEN_STALE_TIME_MS,
    gcTime: TASK_SCREEN_GC_TIME_MS,
  })

  const logoutMutation = useMutation({
    mutationFn: async () => {
      const csrfToken = sessionQuery.data?.csrf_token
      if (!csrfToken) {
        throw new ApiError('Your session is missing a CSRF token.', 'csrf_missing', 403)
      }
      return logoutSession(csrfToken)
    },
    onSuccess: () => {
      queryClient.clear()
      void navigate('/login', { replace: true })
    },
    onError: (error) => {
      notifyError(buildFriendlyMessage(error, 'Logout failed. Refresh and try again.'))
    },
  })

  const accountInitials = useMemo(() => {
    const user = sessionQuery.data?.user
    return user ? buildAvatarLabel(user.display_name, user.email) : 'G'
  }, [sessionQuery.data?.user])

  if (sessionQuery.isLoading) {
    return (
      <div className="min-h-[100dvh] bg-surface text-on-surface">
        <div className="mx-auto flex min-h-[100dvh] max-w-7xl items-center px-8">
          <section className="space-y-3" aria-busy="true">
            <p className="font-body text-xs uppercase tracking-[0.18em] text-on-surface-variant">
              Session check
            </p>
            <h1 className="font-display text-4xl tracking-tight text-on-surface">
              Loading mission control
            </h1>
            <p className="font-body text-sm text-on-surface-variant">
              Verifying your account before opening the desktop workspace.
            </p>
          </section>
        </div>
      </div>
    )
  }

  if (sessionQuery.isError) {
    const authError =
      sessionQuery.error instanceof ApiError && sessionQuery.error.code === 'auth_email_not_allowed'
        ? 'email_not_allowed'
        : undefined
    return <Navigate to={buildLoginPath(location.pathname, location.search, authError)} replace />
  }

  if (!sessionQuery.data?.signed_in) {
    return <Navigate to={buildLoginPath(location.pathname, location.search)} replace />
  }

  const groups = groupsQuery.data ?? []

  return (
    <div className="min-h-[100dvh] bg-surface text-on-surface">
      <div className="grid min-h-[100dvh] grid-cols-[18rem_minmax(0,1fr)] max-lg:grid-cols-1">
        <aside className="sticky top-0 flex h-[100dvh] flex-col border-r border-white/10 bg-surface-dim/85 px-4 py-5 backdrop-blur-xl max-lg:hidden">
          <Link to="/desktop" className="flex items-center gap-3 px-2">
            <img src="/logos/gust-wind-electric.svg" alt="Gust" className="h-8 w-8" />
            <div>
              <p className="font-display text-2xl leading-none text-on-surface">Gust</p>
              <p className="font-body text-[0.68rem] uppercase tracking-[0.18em] text-on-surface-variant">
                Mission Control
              </p>
            </div>
          </Link>

          <nav aria-label="Desktop primary" className="mt-8 space-y-1">
            {primaryNavigation.map((item) => {
              const Icon = item.icon
              return (
                <NavLink
                  key={item.to}
                  to={item.to}
                  end={item.end}
                  className={({ isActive }) =>
                    [
                      'flex items-center gap-3 rounded-soft px-3 py-2.5 font-body text-sm transition duration-200 active:scale-[0.98]',
                      isActive
                        ? 'bg-surface-container-highest text-primary shadow-ambient'
                        : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface',
                    ].join(' ')
                  }
                >
                  <Icon className="h-4 w-4" strokeWidth={1.8} />
                  {item.label}
                </NavLink>
              )
            })}
          </nav>

          <div className="mt-8 min-h-0 flex-1">
            <div className="mb-3 flex items-center justify-between px-3">
              <p className="font-body text-[0.68rem] uppercase tracking-[0.18em] text-on-surface-variant">
                Groups
              </p>
              <BarChart3 className="h-3.5 w-3.5 text-on-surface-variant" strokeWidth={1.8} />
            </div>
            <div className="max-h-[42vh] space-y-1 overflow-y-auto pr-1">
              {groups.map((group) => (
                <NavLink
                  key={group.id}
                  to={`/desktop/groups/${group.id}`}
                  className={({ isActive }) =>
                    [
                      'flex items-center justify-between gap-3 rounded-card px-3 py-2 font-body text-sm transition duration-200 active:scale-[0.98]',
                      isActive
                        ? 'bg-surface-container-high text-on-surface'
                        : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface',
                    ].join(' ')
                  }
                >
                  <span className="flex min-w-0 items-center gap-2">
                    <FolderKanban className="h-4 w-4 shrink-0" strokeWidth={1.8} />
                    <span className="truncate">{group.name}</span>
                  </span>
                  <span className="shrink-0 rounded-pill bg-surface-container-highest px-2 py-0.5 font-body text-[0.68rem] text-on-surface-variant">
                    {group.open_task_count}
                  </span>
                </NavLink>
              ))}
            </div>
          </div>

          <div className="mt-5 space-y-2">
            <Link
              to="/"
              className="flex items-center justify-center gap-2 rounded-pill bg-primary px-4 py-2.5 font-body text-sm font-semibold text-surface transition duration-200 hover:-translate-y-0.5 active:translate-y-0"
            >
              <Mic className="h-4 w-4" strokeWidth={2} />
              Capture
            </Link>
            <Link
              to="/tasks"
              className="flex items-center justify-center gap-2 rounded-pill bg-surface-container px-4 py-2.5 font-body text-sm font-semibold text-on-surface-variant transition duration-200 hover:bg-surface-container-high hover:text-on-surface active:scale-[0.98]"
            >
              <Plus className="h-4 w-4" strokeWidth={2} />
              Mobile Tasks
            </Link>
          </div>
        </aside>

        <div className="min-w-0">
          <header className="sticky top-0 z-20 border-b border-white/10 bg-surface/90 px-6 py-4 backdrop-blur-xl max-lg:px-4">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0">
                <p className="font-body text-[0.68rem] uppercase tracking-[0.18em] text-primary">
                  Desktop workspace
                </p>
                <p className="truncate font-body text-sm text-on-surface-variant">
                  {sessionQuery.data.user?.email}
                </p>
              </div>
              <div className="flex items-center gap-2">
                <Link
                  to="/"
                  className="hidden items-center gap-2 rounded-pill bg-surface-container px-3 py-2 font-body text-sm text-on-surface-variant transition hover:bg-surface-container-high hover:text-on-surface max-lg:flex"
                >
                  <Mic className="h-4 w-4" strokeWidth={1.8} />
                  Capture
                </Link>
                <div className="flex h-10 w-10 items-center justify-center rounded-full bg-on-surface font-body text-xs font-bold uppercase tracking-[0.08em] text-surface">
                  {accountInitials}
                </div>
                <button
                  type="button"
                  onClick={() => logoutMutation.mutate()}
                  disabled={logoutMutation.isPending}
                  className="inline-flex items-center gap-2 rounded-pill bg-surface-container px-3 py-2 font-body text-sm text-on-surface-variant transition hover:bg-surface-container-high hover:text-on-surface active:scale-[0.98] disabled:opacity-60"
                >
                  <LogOut className="h-4 w-4" strokeWidth={1.8} />
                  {logoutMutation.isPending ? 'Logging out' : 'Logout'}
                </button>
              </div>
            </div>
          </header>

          <main className="min-h-[calc(100dvh-73px)] overflow-x-hidden px-6 py-6 max-lg:px-4">
            <Outlet
              context={{
                session: sessionQuery.data,
                groups,
                isGroupsLoading: groupsQuery.isLoading,
              }}
            />
          </main>
        </div>
      </div>
    </div>
  )
}
