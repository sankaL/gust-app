import { useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import {
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Mic,
  Plus,
  Settings2,
  Smartphone,
} from 'lucide-react'
import {
  Link,
  Navigate,
  NavLink,
  Outlet,
  useLocation,
  useNavigate,
  useOutletContext,
} from 'react-router-dom'

import {
  ApiError,
  createVoiceCapture,
  getSessionStatus,
  listGroups,
  logoutSession,
  type GroupSummary,
  type SessionStatus,
} from '../lib/api'
import { TASK_SCREEN_GC_TIME_MS, TASK_SCREEN_STALE_TIME_MS } from '../lib/taskScreenCache'
import { useNotifications } from './Notifications'
import { markDeviceRedirectOverride, useDeviceRedirect } from '../hooks/useDeviceRedirect'

export type DesktopHeaderContent = {
  eyebrow: string
  title: string
  subtitle?: string
  action?: ReactNode
}

export type DesktopOutletContext = {
  session: SessionStatus
  groups: GroupSummary[]
  isGroupsLoading: boolean
  setDesktopHeader: (header: DesktopHeaderContent) => void
}

const DEFAULT_DESKTOP_HEADER: DesktopHeaderContent = {
  eyebrow: 'Mission Control',
  title: 'Weekly overview',
}

const primaryNavigation = [
  { to: '/desktop', label: 'Dashboard', icon: LayoutDashboard, end: true },
  { to: '/desktop/tasks', label: 'All Tasks', icon: ClipboardList, end: true },
  { to: '/desktop/capture', label: 'Capture Tasks', icon: Mic, end: true },
  { to: '/desktop/completed', label: 'Completed', icon: CheckCircle2, end: true },
  { to: '/desktop/groups', label: 'Groups', icon: Settings2, end: true },
]

const accountNavigation = [
  ...primaryNavigation.filter((item) => item.to !== '/desktop/groups'),
  { to: '/capture', label: 'Mobile Mode', icon: Smartphone, end: true },
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

function classifyMicrophoneError(error: unknown): string {
  const fallback = 'Microphone access failed. Check your device settings, then try again.'
  if (!(error instanceof DOMException)) {
    return fallback
  }

  switch (error.name) {
    case 'NotAllowedError':
    case 'SecurityError':
    case 'PermissionDeniedError':
      return 'Microphone permission was denied. Text capture is still available.'
    case 'NotFoundError':
    case 'DevicesNotFoundError':
      return 'No microphone was found. Connect a mic and try again, or use text capture.'
    case 'NotReadableError':
    case 'TrackStartError':
    case 'AbortError':
      return 'Microphone is unavailable or in use by another app. Try again, or use text capture.'
    case 'OverconstrainedError':
      return 'Microphone settings are unsupported on this device. Try default audio settings.'
    default:
      return fallback
  }
}

export function useDesktopHeader(header: DesktopHeaderContent) {
  const { setDesktopHeader } = useOutletContext<DesktopOutletContext>()

  useEffect(() => {
    setDesktopHeader(header)
    return () => {
      setDesktopHeader(DEFAULT_DESKTOP_HEADER)
    }
  }, [header, setDesktopHeader])
}

export function DesktopShell() {
  useDeviceRedirect()
  const location = useLocation()
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const { notifyError, notifySuccess } = useNotifications()
  const [desktopHeader, setDesktopHeader] = useState<DesktopHeaderContent>(DEFAULT_DESKTOP_HEADER)
  const mediaRecorderRef = useRef<MediaRecorder | null>(null)
  const mediaStreamRef = useRef<MediaStream | null>(null)
  const recordedChunksRef = useRef<BlobPart[]>([])
  const accountMenuRef = useRef<HTMLDivElement | null>(null)
  const [isRecording, setIsRecording] = useState(false)
  const [isRecorderLoading, setIsRecorderLoading] = useState(false)
  const [isAccountMenuOpen, setIsAccountMenuOpen] = useState(false)

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

  const voiceCaptureMutation = useMutation({
    mutationFn: async (audio: { blob: Blob; filename: string }) => {
      const csrfToken = sessionQuery.data?.csrf_token
      if (!csrfToken) {
        throw new ApiError('Your session is missing a CSRF token.', 'csrf_missing', 403)
      }
      return createVoiceCapture(audio.blob, audio.filename, csrfToken)
    },
    onSuccess: (payload) => {
      notifySuccess('Capture ready for review.')
      void navigate(`/desktop/capture?capture=${payload.capture_id}`)
    },
    onError: (error) => {
      notifyError(buildFriendlyMessage(error, 'Voice capture could not be prepared.'))
    },
  })

  useEffect(() => {
    return () => {
      mediaRecorderRef.current?.stream.getTracks().forEach((track) => track.stop())
      mediaRecorderRef.current = null
      mediaStreamRef.current?.getTracks().forEach((track) => track.stop())
      mediaStreamRef.current = null
    }
  }, [])

  useEffect(() => {
    if (!isAccountMenuOpen) {
      return
    }

    function handlePointerDown(event: PointerEvent) {
      if (!accountMenuRef.current?.contains(event.target as Node)) {
        setIsAccountMenuOpen(false)
      }
    }

    window.addEventListener('pointerdown', handlePointerDown)
    return () => {
      window.removeEventListener('pointerdown', handlePointerDown)
    }
  }, [isAccountMenuOpen])

  async function startDesktopRecording() {
    if (!navigator.mediaDevices?.getUserMedia) {
      notifyError('Microphone capture is unavailable in this browser.')
      return
    }

    setIsRecorderLoading(true)
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true })
      const recorder = new MediaRecorder(stream)
      recordedChunksRef.current = []
      mediaStreamRef.current = stream
      mediaRecorderRef.current = recorder

      recorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          recordedChunksRef.current.push(event.data)
        }
      }

      recorder.onstop = () => {
        const mimeType = recorder.mimeType || 'audio/webm'
        const fileExtension = mimeType.includes('mp4') ? 'mp4' : 'webm'
        const blob = new Blob(recordedChunksRef.current, { type: mimeType })
        stream.getTracks().forEach((track) => track.stop())
        mediaStreamRef.current = null
        mediaRecorderRef.current = null
        setIsRecording(false)

        if (blob.size === 0) {
          notifyError('No audio was captured. Try again.')
          return
        }

        voiceCaptureMutation.mutate({
          blob,
          filename: `capture.${fileExtension}`,
        })
      }

      recorder.start()
      setIsRecording(true)
    } catch (error) {
      notifyError(classifyMicrophoneError(error))
    } finally {
      setIsRecorderLoading(false)
    }
  }

  function stopDesktopRecording() {
    const recorder = mediaRecorderRef.current
    if (recorder && recorder.state !== 'inactive') {
      recorder.stop()
    }
  }

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
            <button
              type="button"
              onClick={() => logoutMutation.mutate()}
              disabled={logoutMutation.isPending}
              className="flex w-full items-center justify-center gap-2 px-3 py-2 font-body text-sm font-semibold text-red-400 transition duration-200 hover:text-red-300 active:scale-[0.98] disabled:opacity-60"
            >
              <LogOut className="h-4 w-4" strokeWidth={1.8} />
              {logoutMutation.isPending ? 'Logging out' : 'Logout'}
            </button>
          </div>
        </aside>

        <div className="min-w-0">
          <header className="sticky top-0 z-20 border-b border-white/10 bg-surface/90 px-6 py-4 backdrop-blur-xl max-lg:px-4">
            <div className="flex items-center justify-between gap-4">
              <div className="min-w-0 flex-1">
                <p className="truncate font-body text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-primary">
                  {desktopHeader.eyebrow}
                </p>
                <h1 className="truncate font-display text-[1.55rem] leading-7 tracking-tight text-on-surface">
                  {desktopHeader.title}
                </h1>
                {desktopHeader.subtitle ? (
                  <p className="truncate font-body text-xs leading-4 text-on-surface-variant">
                    {desktopHeader.subtitle}
                  </p>
                ) : null}
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {desktopHeader.action}
                <Link
                  to="/capture"
                  onClick={markDeviceRedirectOverride}
                  className="hidden items-center gap-2 rounded-pill bg-surface-container px-3 py-2 font-body text-sm text-on-surface-variant transition hover:bg-surface-container-high hover:text-on-surface max-lg:flex"
                >
                  <Mic className="h-4 w-4" strokeWidth={1.8} />
                  Capture
                </Link>
                <div className="relative" ref={accountMenuRef}>
                  <button
                    type="button"
                    className="flex h-10 items-center gap-2 rounded-full bg-on-surface px-3 font-body text-xs font-bold uppercase tracking-[0.08em] text-surface transition hover:-translate-y-0.5 active:translate-y-0"
                    aria-haspopup="menu"
                    aria-expanded={isAccountMenuOpen}
                    aria-label="Open account menu"
                    onClick={() => setIsAccountMenuOpen((current) => !current)}
                  >
                    <span>{accountInitials}</span>
                    <ChevronDown
                      className={[
                        'h-3.5 w-3.5 transition-transform duration-200',
                        isAccountMenuOpen ? 'rotate-180' : '',
                      ].join(' ')}
                      strokeWidth={2}
                    />
                  </button>
                  {isAccountMenuOpen ? (
                    <div
                      role="menu"
                      className="absolute right-0 top-12 z-50 w-64 overflow-hidden rounded-card bg-[linear-gradient(180deg,_rgb(38,38,38)_0%,_rgb(26,26,26)_100%)] py-1 shadow-[0_18px_40px_rgba(0,0,0,0.58),_inset_0_1px_0_rgba(255,255,255,0.05)]"
                    >
                      <div className="mb-1 bg-white/[0.03] px-3 py-3">
                        <p className="font-body text-[0.65rem] uppercase tracking-[0.15em] text-on-surface-variant">
                          Signed in
                        </p>
                        <p className="truncate font-body text-sm text-on-surface">
                          {sessionQuery.data.user?.email}
                        </p>
                      </div>
                      <div className="flex flex-col">
                        {accountNavigation.map((item) => {
                          const Icon = item.icon
                          return (
                            <NavLink
                              key={item.to}
                              to={item.to}
                              end={item.end}
                              role="menuitem"
                              onClick={() => {
                                if (item.to === '/capture') {
                                  markDeviceRedirectOverride()
                                }
                                setIsAccountMenuOpen(false)
                              }}
                              className={({ isActive }) =>
                                [
                                  'flex w-full items-center gap-3 px-3 py-2 text-left font-body text-sm transition-colors hover:bg-surface-container-highest',
                                  isActive ? 'text-primary' : 'text-on-surface',
                                ].join(' ')
                              }
                            >
                              <Icon className="h-4 w-4 text-on-surface-variant" strokeWidth={1.8} />
                              {item.label}
                            </NavLink>
                          )
                        })}
                      </div>
                    </div>
                  ) : null}
                </div>
                <button
                  type="button"
                  onClick={() => logoutMutation.mutate()}
                  disabled={logoutMutation.isPending}
                  className="inline-flex items-center gap-2 rounded-pill bg-surface-container px-3 py-2 font-body text-sm text-on-surface-variant transition hover:bg-surface-container-high hover:text-on-surface active:scale-[0.98] disabled:opacity-60 lg:hidden"
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
                setDesktopHeader,
              }}
            />
          </main>
        </div>
      </div>

      <div className="fixed bottom-7 right-7 z-50 hidden flex-col items-center gap-4 lg:flex">
        <button
          type="button"
          onClick={isRecording ? stopDesktopRecording : () => void startDesktopRecording()}
          disabled={(isRecorderLoading || voiceCaptureMutation.isPending) && !isRecording}
          className={[
            'group relative flex h-14 w-14 items-center justify-center rounded-full font-body text-xs font-bold uppercase tracking-[0.08em] transition-all duration-200 outline-none select-none',
            isRecording
              ? 'translate-y-[4px] bg-[radial-gradient(circle_at_top,_#fb7185_10%,_#be123c_90%)] text-white shadow-[0_0px_0_#881337,_0_10px_20px_rgba(0,0,0,0.36),_inset_0_4px_8px_rgba(0,0,0,0.26)]'
              : 'bg-[radial-gradient(circle_at_top,_#ffffff_10%,_#e5e5e5_90%)] text-black shadow-[0_4px_0_#a1a1aa,_0_6px_10px_rgba(0,0,0,0.4),_inset_0_1px_2px_rgba(255,255,255,0.8)] hover:-translate-y-[1px] hover:shadow-[0_5px_0_#a1a1aa,_0_8px_12px_rgba(0,0,0,0.4),_inset_0_1px_2px_rgba(255,255,255,0.8)] active:translate-y-[4px] active:shadow-[0_0px_0_#a1a1aa,_0_2px_4px_rgba(0,0,0,0.4),_inset_0_2px_4px_rgba(0,0,0,0.1)]',
          ].join(' ')}
          aria-label={isRecording ? 'Stop desktop recording' : 'Start desktop recording'}
        >
          {isRecording ? (
            <>
              <span className="absolute inset-0 rounded-full border border-rose-200/70 animate-ping" />
              <span className="absolute inset-1 rounded-full border border-white/30" />
              <span className="h-4 w-4 rounded-[4px] bg-white shadow-[0_0_18px_rgba(255,255,255,0.55)]" />
            </>
          ) : (
            <Mic className="h-6 w-6" strokeWidth={2.2} />
          )}
        </button>

        <Link
          to="/desktop/tasks/new"
          className="group flex h-14 w-14 items-center justify-center rounded-full bg-[radial-gradient(circle_at_top,_#c4b5fd_10%,_#7c3aed_90%)] text-white shadow-[0_8px_0_#4c1d95,_0_15px_20px_rgba(0,0,0,0.4),_inset_0_2px_3px_rgba(255,255,255,0.6)] transition-all duration-200 outline-none select-none hover:-translate-y-[2px] hover:shadow-[0_10px_0_#4c1d95,_0_18px_24px_rgba(0,0,0,0.4),_inset_0_2px_3px_rgba(255,255,255,0.6)] active:translate-y-[8px] active:shadow-[0_0px_0_#4c1d95,_0_4px_8px_rgba(0,0,0,0.4),_inset_0_4px_8px_rgba(0,0,0,0.3)]"
          aria-label="Create desktop task"
        >
          <Plus className="h-7 w-7 drop-shadow-md" strokeWidth={2.5} />
        </Link>
      </div>
    </div>
  )
}
