import type { ReactNode, RefObject } from 'react'
import { Link, NavLink } from 'react-router-dom'

import type { SessionStatus } from '../lib/api'
import { Button } from './Button'
import { Card } from './Card'

const navigation = [
  { to: '/capture', label: 'Capture', end: true },
  { to: '/tasks', label: 'Tasks', end: true },
  { to: '/tasks/groups', label: 'Groups', end: false },
]

type AccountMenuProps = {
  accountInitials: string
  email?: string
  isOpen: boolean
  isLoggingOut: boolean
  menuRef: RefObject<HTMLDivElement | null>
  onToggle: () => void
  onCompletedTasks: () => void
  onDesktopMode: () => void
  onLogout: () => void
}

function AccountMenu({
  accountInitials,
  email,
  isOpen,
  isLoggingOut,
  menuRef,
  onToggle,
  onCompletedTasks,
  onDesktopMode,
  onLogout,
}: AccountMenuProps) {
  return (
    <div className="relative" ref={menuRef}>
      <button
        type="button"
        className="flex h-10 w-10 items-center justify-center rounded-full bg-[radial-gradient(circle_at_top,_#ffffff_10%,_#e5e5e5_90%)] font-body text-xs font-bold uppercase tracking-[0.08em] text-black shadow-[0_4px_0_#a1a1aa,_0_6px_10px_rgba(0,0,0,0.4),_inset_0_1px_2px_rgba(255,255,255,0.8)] transition-all duration-200 outline-none hover:-translate-y-[1px] hover:shadow-[0_5px_0_#a1a1aa,_0_8px_12px_rgba(0,0,0,0.4),_inset_0_1px_2px_rgba(255,255,255,0.8)] active:translate-y-[4px] active:shadow-[0_0px_0_#a1a1aa,_0_2px_4px_rgba(0,0,0,0.4),_inset_0_2px_4px_rgba(0,0,0,0.1)]"
        aria-haspopup="menu"
        aria-expanded={isOpen}
        aria-label="Open account menu"
        onClick={onToggle}
      >
        {accountInitials}
      </button>
      {isOpen && (
        <AccountMenuPanel
          email={email}
          isLoggingOut={isLoggingOut}
          onCompletedTasks={onCompletedTasks}
          onDesktopMode={onDesktopMode}
          onLogout={onLogout}
        />
      )}
    </div>
  )
}

function AccountMenuPanel({
  email,
  isLoggingOut,
  onCompletedTasks,
  onDesktopMode,
  onLogout,
}: Omit<AccountMenuProps, 'accountInitials' | 'isOpen' | 'menuRef' | 'onToggle'>) {
  const menuItemClass =
    'flex w-full items-center gap-3 px-3 py-2 text-left font-body text-sm transition-colors hover:bg-surface-container-highest'
  return (
    <div
      role="menu"
      className="absolute right-0 top-12 z-50 w-64 overflow-hidden rounded-card bg-[linear-gradient(180deg,_rgb(38,38,38)_0%,_rgb(26,26,26)_100%)] py-1 shadow-[0_18px_40px_rgba(0,0,0,0.58),_inset_0_1px_0_rgba(255,255,255,0.05)]"
    >
      <div className="mb-1 bg-white/[0.03] px-3 py-3">
        <p className="font-body text-[0.65rem] uppercase tracking-[0.15em] text-on-surface-variant">Signed in</p>
        <p className="truncate font-body text-sm text-on-surface">{email}</p>
      </div>
      <div className="flex flex-col">
        <button type="button" role="menuitem" onClick={onCompletedTasks} className={`${menuItemClass} text-on-surface`}>Completed Tasks</button>
        <button type="button" role="menuitem" onClick={onDesktopMode} className={`${menuItemClass} text-on-surface`}>Desktop Mode</button>
        <button type="button" role="menuitem" onClick={onLogout} disabled={isLoggingOut} className={`${menuItemClass} text-tertiary disabled:opacity-60`}>{isLoggingOut ? 'Logging out...' : 'Logout'}</button>
      </div>
    </div>
  )
}

function InstallNotice() {
  return (
    <Card className="overflow-hidden bg-surface-container-high/90 shadow-[0_0_40px_rgba(186,158,255,0.08)]">
      <div className="space-y-2">
        <p className="font-body text-[0.65rem] uppercase tracking-[0.2em] text-primary">Install on iPhone</p>
        <p className="font-body text-sm leading-6 text-on-surface">Open Safari&apos;s Share menu, then choose <span className="font-semibold text-primary">Add to Home Screen</span> to install Gust.</p>
      </div>
    </Card>
  )
}

function UpdateNotice({ onUpdate }: { onUpdate: () => void }) {
  return (
    <Card className="overflow-hidden bg-surface-container-highest shadow-[0_0_48px_rgba(186,158,255,0.12)]">
      <div className="flex items-center justify-between gap-3">
        <div className="space-y-1"><p className="font-body text-[0.65rem] uppercase tracking-[0.2em] text-primary">Update ready</p><p className="font-body text-sm leading-6 text-on-surface">A newer build is available. Reload to update the app shell.</p></div>
        <Button type="button" variant="primary" size="sm" onClick={onUpdate}>Update</Button>
      </div>
    </Card>
  )
}

function PrimaryNavigation() {
  return (
    <nav aria-label="Primary" className="grid grid-cols-3 gap-2 rounded-soft bg-surface-container p-1.5">
      {navigation.map((item) => (
        <NavLink key={item.to} to={item.to} end={item.end} className={({ isActive }) => ['rounded-soft px-3 py-2 text-center font-body text-sm transition', isActive ? 'bg-surface-container-highest text-primary shadow-ambient' : 'text-on-surface-variant hover:bg-surface-container-high'].join(' ')}>{item.label}</NavLink>
      ))}
    </nav>
  )
}

export type AppShellHeaderProps = {
  session: SessionStatus
  topBarAction: ReactNode
  accountInitials: string
  shouldShowInstallButton: boolean
  hasInstallPrompt: boolean
  isAccountMenuOpen: boolean
  isLoggingOut: boolean
  showIosInstallHelp: boolean
  needRefresh: boolean
  offlineReady: boolean
  accountMenuRef: RefObject<HTMLDivElement | null>
  onInstall: () => void
  onToggleAccountMenu: () => void
  onCompletedTasks: () => void
  onDesktopMode: () => void
  onLogout: () => void
  onUpdate: () => void
}

export function AppShellHeader(props: AppShellHeaderProps) {
  return (
    <header className="safe-area-sticky-top sticky z-50 mb-4 space-y-5 bg-surface/95 pt-2 backdrop-blur-sm">
      <div className="flex items-center justify-between gap-3">
        <Link to="/capture" className="flex items-center gap-2"><img src="/logos/gust-wind-electric.svg" alt="Gust" className="h-6 w-6" /><h1 className="font-display text-2xl leading-none text-on-surface">Gust</h1></Link>
        <div className="flex items-center gap-2">
          {props.shouldShowInstallButton && <Button type="button" variant="primary" size="sm" onClick={props.onInstall} aria-label={props.hasInstallPrompt ? 'Install Gust app' : 'Show iPhone install instructions'}>{props.hasInstallPrompt ? 'Install' : 'Add to Home'}</Button>}
          {props.topBarAction}
          <AccountMenu accountInitials={props.accountInitials} email={props.session.user?.email} isOpen={props.isAccountMenuOpen} isLoggingOut={props.isLoggingOut} menuRef={props.accountMenuRef} onToggle={props.onToggleAccountMenu} onCompletedTasks={props.onCompletedTasks} onDesktopMode={props.onDesktopMode} onLogout={props.onLogout} />
        </div>
      </div>
      {props.showIosInstallHelp && <InstallNotice />}
      {props.needRefresh && <UpdateNotice onUpdate={props.onUpdate} />}
      {props.offlineReady && <Card className="overflow-hidden bg-surface-container-high/90"><p className="font-body text-sm leading-6 text-on-surface-variant">App shell cached for faster launches.</p></Card>}
      <PrimaryNavigation />
    </header>
  )
}

export function AppShellLoading() {
  return (
    <div className="safe-area-shell min-h-screen bg-surface text-on-surface">
      <div className="mx-auto flex min-h-screen w-full max-w-md items-center px-4">
        <section className="w-full space-y-3" aria-busy="true"><p className="font-body text-xs uppercase tracking-[0.15em] text-on-surface-variant">Session check</p><h1 className="font-display text-3xl text-on-surface">Loading workspace</h1><p className="font-body text-sm leading-6 text-on-surface-variant">Verifying your account before loading Gust.</p></section>
      </div>
    </div>
  )
}
