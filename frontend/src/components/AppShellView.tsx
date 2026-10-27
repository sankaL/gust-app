import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Bell, CheckCircle2, Folder, House, Plus, UserRound, type LucideIcon } from 'lucide-react'

import { useMobileShell } from './AppShellActions'
import { Button } from './Button'
import { InlineNotice } from './ui/controls'
import { useGlassRefraction } from './ui/LiquidGlass'

type NavItem = { to: string; label: string; icon: LucideIcon; isActive: (pathname: string) => boolean }

const navigation: NavItem[] = [
  { to: '/tasks', label: 'Tasks', icon: House, isActive: (pathname) => pathname === '/tasks' || (/^\/tasks\/[^/]+$/.test(pathname) && !['/tasks/groups', '/tasks/completed'].includes(pathname)) },
  { to: '/tasks/completed', label: 'Completed', icon: CheckCircle2, isActive: (pathname) => pathname === '/tasks/completed' },
  { to: '/tasks/groups', label: 'Groups', icon: Folder, isActive: (pathname) => pathname === '/tasks/groups' },
]

// Matches the bell's h-11 w-11 (44px).
const REVIEW_LENS = { width: 44, height: 44, radius: 22, bezel: 14, scale: 28, aberration: 0.08 }
// The nav floats just above the home indicator.
const NAV_BOTTOM = 'max(1rem, calc(var(--safe-area-bottom) + 0.25rem))'

function ReviewBell() {
  const shell = useMobileShell()
  const lens = useGlassRefraction(REVIEW_LENS)
  if (!shell) return null
  const count = shell.pendingReviewCount
  const label = count > 0 ? `Review pending tasks (${count})` : 'Review pending tasks'
  return (
    <span className="relative flex shrink-0">
      <button
        type="button"
        onClick={() => shell.openSheet('review')}
        aria-label={label}
        title={label}
        className="liquid-lens relative flex h-11 w-11 items-center justify-center overflow-hidden rounded-full text-on-surface outline-none transition-transform duration-200 ease-out-expo focus-visible:ring-2 focus-visible:ring-primary/60 active:scale-95"
      >
        <span aria-hidden="true" className="liquid-warp" style={lens.warpStyle} />
        <Bell className={`relative z-[2] h-[1.2rem] w-[1.2rem] ${count > 0 ? 'origin-top animate-[bell-ring_1.6s_ease-in-out_1]' : ''}`} strokeWidth={2.2} fill={count > 0 ? 'currentColor' : 'none'} fillOpacity={count > 0 ? 0.12 : 0} />
      </button>
      {count > 0 ? (
        <span key={count} aria-hidden="true" className="lens-bead animate-pop-in pointer-events-none absolute -right-1 -top-1 z-[3] flex h-5 min-w-5 items-center justify-center rounded-full px-1 font-body text-[0.65rem] font-bold leading-none">
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
      {lens.filter}
    </span>
  )
}

export function ScreenHeader({ eyebrow, title, actions, showBell = true }: { eyebrow: ReactNode; title: ReactNode; actions?: ReactNode; showBell?: boolean }) {
  const shell = useMobileShell()
  return (
    <header className="flex items-start justify-between gap-3 pb-5 pt-4">
      <div className="min-w-0 animate-rise-in">
        <p className="font-body text-[1.02rem] font-semibold text-on-surface/80 dark:text-[0.78rem] dark:uppercase dark:tracking-[0.16em] dark:text-on-surface-variant">{eyebrow}</p>
        <h1 className="mt-0.5 truncate font-display text-[clamp(1.6rem,7.4vw,2.05rem)] font-extrabold leading-[1.12] tracking-[-0.025em] text-on-surface">{title}</h1>
      </div>
      <div className="flex shrink-0 items-center gap-2 pt-1.5">
        {actions}
        {shell?.topBarAction}
        {showBell ? <ReviewBell /> : null}
      </div>
    </header>
  )
}

// Slot order in the bar: Tasks, Completed, capture (+), Groups, Account.
const NAV_SLOTS = [0, 1, 3]

export function BottomNavigation({ isAccountOpen, onAccount, onCapture }: {
  isAccountOpen: boolean
  onAccount: () => void
  onCapture: () => void
}) {
  const { pathname } = useLocation()
  const activeIndex = navigation.findIndex((item) => item.isActive(pathname))
  // The task detail page brings its own action dock, so the global chrome steps aside.
  const isDetailRoute = /^\/tasks\/[^/]+$/.test(pathname) && !['/tasks/groups', '/tasks/completed'].includes(pathname)
  if (isDetailRoute) return null

  return (
    <nav aria-label="Primary" className="pointer-events-none fixed inset-x-0 z-50 flex justify-center px-3.5" style={{ bottom: NAV_BOTTOM }}>
      <div className="clay clay-nav pointer-events-auto w-full max-w-[26.25rem] rounded-pill px-1.5">
        <div className="relative grid h-[3.875rem] grid-cols-5 items-center">
          {activeIndex >= 0 ? (
            <span
              aria-hidden="true"
              className="pointer-events-none absolute left-0 top-0 flex h-full w-1/5 items-center justify-center transition-transform duration-500 ease-out-expo"
              style={{ transform: `translateX(${NAV_SLOTS[activeIndex] * 100}%)` }}
            >
              <span className="clay clay-accent-sm h-[2.6rem] w-[3.4rem] rounded-[1.3rem]" />
            </span>
          ) : null}
          {navigation.map((item, index) => {
            const Icon = item.icon
            const active = index === activeIndex
            return (
              <Link
                key={item.to}
                to={item.to}
                aria-current={active ? 'page' : undefined}
                style={{ gridColumnStart: NAV_SLOTS[index] + 1, gridRowStart: 1 }}
                className={`relative flex h-full items-center justify-center outline-none transition-colors duration-300 focus-visible:text-primary active:scale-90 ${active ? 'text-on-primary' : 'text-on-surface-variant/70 hover:text-on-surface'}`}
              >
                <Icon className={`h-[1.4rem] w-[1.4rem] transition-transform duration-300 ease-spring ${active ? 'scale-105' : ''}`} strokeWidth={active ? 2.3 : 2} fill={active ? 'currentColor' : 'none'} fillOpacity={active ? 0.14 : 0} aria-hidden="true" />
                <span className="sr-only">{item.label}</span>
              </Link>
            )
          })}
          <div className="relative col-start-3 row-start-1 flex h-full items-center justify-center">
            <button
              type="button"
              onClick={onCapture}
              aria-label="Add a new task"
              className="clay clay-capture group flex h-[3.6rem] w-[3.6rem] -translate-y-3 items-center justify-center rounded-full text-surface transition-transform duration-300 ease-spring hover:scale-105 active:scale-90"
            >
              <Plus className="h-7 w-7 transition-transform duration-300 ease-out-expo group-hover:rotate-90" strokeWidth={2.6} aria-hidden="true" />
            </button>
          </div>
          <button
            type="button"
            onClick={onAccount}
            aria-label="Open account menu"
            aria-haspopup="dialog"
            aria-expanded={isAccountOpen}
            className={`relative col-start-5 row-start-1 flex h-full items-center justify-center outline-none transition-colors duration-300 focus-visible:text-primary active:scale-90 ${isAccountOpen ? 'text-on-surface' : 'text-on-surface-variant/70 hover:text-on-surface'}`}
          >
            <UserRound className="h-[1.4rem] w-[1.4rem]" strokeWidth={isAccountOpen ? 2.3 : 2} aria-hidden="true" />
          </button>
        </div>
      </div>
    </nav>
  )
}

export function ShellNotices({ showIosInstallHelp, needRefresh, offlineReady, onUpdate }: { showIosInstallHelp: boolean; needRefresh: boolean; offlineReady: boolean; onUpdate: () => void }) {
  if (!showIosInstallHelp && !needRefresh && !offlineReady) return null
  return (
    <div className="space-y-2 pt-3">
      {showIosInstallHelp ? (
        <InlineNotice title="Install on iPhone">
          Open Safari&apos;s Share menu, then choose <span className="font-semibold text-primary">Add to Home Screen</span> to install Gust.
        </InlineNotice>
      ) : null}
      {needRefresh ? (
        <InlineNotice title="Update ready" action={<Button variant="primary" size="sm" onClick={onUpdate}>Update</Button>}>
          A newer build is available. Reload to update the app shell.
        </InlineNotice>
      ) : null}
      {offlineReady ? <InlineNotice>App shell cached for faster launches.</InlineNotice> : null}
    </div>
  )
}

export function AppShellLoading() {
  return (
    <div className="safe-area-shell min-h-screen text-on-surface">
      <div className="mx-auto flex min-h-screen w-full max-w-md items-center px-5">
        <section className="w-full space-y-3 text-center" aria-busy="true">
          <img src="/logos/gust-wind-electric.svg" alt="" className="mx-auto h-10 w-10 animate-orb-breathe" />
          <p className="font-body text-xs font-semibold uppercase tracking-[0.16em] text-on-surface-variant">Session check</p>
          <h1 className="font-display text-3xl font-extrabold tracking-[-0.02em] text-on-surface">Loading workspace</h1>
          <p className="font-body text-sm leading-6 text-on-surface-variant">Verifying your account before loading Gust.</p>
        </section>
      </div>
    </div>
  )
}
