import type { ReactNode } from 'react'
import { Link, useLocation } from 'react-router-dom'
import { Bell, CheckCircle2, Folder, House, Plus, type LucideIcon } from 'lucide-react'

import { useMobileShell } from './AppShellActions'
import { Button } from './Button'
import { InlineNotice } from './ui/controls'

type NavItem = { to: string; label: string; icon: LucideIcon; isActive: (pathname: string) => boolean }

const navigation: NavItem[] = [
  { to: '/tasks', label: 'Tasks', icon: House, isActive: (pathname) => pathname === '/tasks' || (/^\/tasks\/[^/]+$/.test(pathname) && !['/tasks/groups', '/tasks/completed'].includes(pathname)) },
  { to: '/tasks/completed', label: 'Completed', icon: CheckCircle2, isActive: (pathname) => pathname === '/tasks/completed' },
  { to: '/tasks/groups', label: 'Groups', icon: Folder, isActive: (pathname) => pathname === '/tasks/groups' },
]

function ReviewBell() {
  const shell = useMobileShell()
  if (!shell) return null
  const count = shell.pendingReviewCount
  const label = count > 0 ? `Review pending tasks (${count})` : 'Review pending tasks'
  return (
    <button
      type="button"
      onClick={() => shell.openSheet('review')}
      aria-label={label}
      title={label}
      className="clay-obsidian relative flex h-11 w-11 shrink-0 items-center justify-center rounded-full text-on-surface outline-none focus-visible:ring-2 focus-visible:ring-primary/60"
    >
      <Bell className={`h-[1.2rem] w-[1.2rem] ${count > 0 ? 'origin-top animate-[bell-ring_1.6s_ease-in-out_1]' : ''}`} strokeWidth={2.2} fill={count > 0 ? 'currentColor' : 'none'} fillOpacity={count > 0 ? 0.12 : 0} />
      {count > 0 ? (
        <span key={count} className="animate-pop-in absolute -right-0.5 -top-0.5 flex h-5 min-w-5 items-center justify-center rounded-full bg-tertiary px-1 font-body text-[0.65rem] font-bold leading-none text-white ring-2 ring-surface">
          {count > 99 ? '99+' : count}
        </span>
      ) : null}
    </button>
  )
}

export function ScreenHeader({ eyebrow, title, actions, showBell = true }: { eyebrow: ReactNode; title: ReactNode; actions?: ReactNode; showBell?: boolean }) {
  const shell = useMobileShell()
  return (
    <header className="flex items-start justify-between gap-3 pb-1 pt-4">
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

function NavAvatar({ initials, active, onClick }: { initials: string; active: boolean; onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-label="Open account menu"
      aria-haspopup="dialog"
      aria-expanded={active}
      className="group relative flex h-full flex-1 items-center justify-center outline-none"
    >
      <span className={`flex h-9 w-9 items-center justify-center rounded-full bg-gradient-to-br from-primary to-primary-dim font-body text-[0.72rem] font-bold uppercase tracking-[0.04em] text-on-primary shadow-card ring-2 transition-all duration-300 ease-out-expo group-active:scale-90 ${active ? 'ring-primary/60 ring-offset-2 ring-offset-nav' : 'ring-transparent'}`}>
        {initials}
      </span>
    </button>
  )
}

export function BottomNavigation({ accountInitials, isAccountOpen, onAccount, onCapture }: {
  accountInitials: string
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
    <>
      <button
        type="button"
        onClick={onCapture}
        aria-label="Add a new task"
        className="group fixed z-[60] flex h-[3.75rem] w-[3.75rem] items-center justify-center rounded-full bg-primary text-on-primary shadow-fab outline-none transition-transform duration-300 ease-spring hover:scale-105 focus-visible:ring-4 focus-visible:ring-primary/40 active:scale-90"
        style={{ right: 'max(1.1rem, calc((100vw - 28rem) / 2 + 1.1rem))', bottom: 'calc(var(--safe-area-bottom) + 5.1rem)' }}
      >
        <span aria-hidden="true" className="absolute inset-0 rounded-full bg-gradient-to-b from-white/25 to-transparent" />
        <Plus className="relative h-7 w-7 transition-transform duration-300 ease-out-expo group-hover:rotate-90" strokeWidth={2.4} aria-hidden="true" />
      </button>
      <nav aria-label="Primary" className="fixed inset-x-0 bottom-0 z-50 flex justify-center">
        <div className="w-full max-w-md rounded-t-[1.75rem] bg-nav/95 px-3 pb-[var(--safe-area-bottom)] shadow-sheet ring-1 ring-outline/40 backdrop-blur-xl">
          <div className="relative grid h-16 grid-cols-4 items-center">
            {activeIndex >= 0 ? (
              <span
                aria-hidden="true"
                className="pointer-events-none absolute left-0 top-0 flex h-full w-1/4 items-center justify-center transition-transform duration-500 ease-out-expo"
                style={{ transform: `translateX(${activeIndex * 100}%)` }}
              >
                <span className="h-10 w-[3.6rem] rounded-pill bg-surface-container-highest dark:bg-transparent" />
                <span className="absolute bottom-2 hidden h-1 w-1 rounded-full bg-primary dark:block" />
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
                  className={`relative flex h-full items-center justify-center outline-none transition-colors duration-300 focus-visible:text-primary active:scale-90 ${active ? 'text-on-surface dark:text-primary' : 'text-on-surface-variant/70 hover:text-on-surface'}`}
                >
                  <Icon className={`h-[1.4rem] w-[1.4rem] transition-transform duration-300 ease-spring ${active ? 'scale-105' : ''}`} strokeWidth={active ? 2.3 : 2} fill={active ? 'currentColor' : 'none'} fillOpacity={active ? 0.14 : 0} aria-hidden="true" />
                  <span className="sr-only">{item.label}</span>
                </Link>
              )
            })}
            <NavAvatar initials={accountInitials} active={isAccountOpen} onClick={onAccount} />
          </div>
        </div>
      </nav>
    </>
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
