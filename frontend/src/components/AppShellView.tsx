import type { ReactNode, RefObject } from 'react'
import { Link, NavLink } from 'react-router-dom'
import { CheckCircle2, Folder, Laptop, ListTodo, LogOut, Mic, Plus, Settings } from 'lucide-react'

import type { SessionStatus } from '../lib/api'
import { Button } from './Button'
import { Card } from './Card'

const navigation = [
  { to: '/capture', label: 'Capture', icon: Mic, end: true },
  { to: '/tasks', label: 'Tasks', icon: ListTodo, end: true },
  { to: '/tasks/groups', label: 'Groups', icon: Folder, end: false },
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
        className="flex h-10 w-10 items-center justify-center rounded-full bg-gradient-to-b from-white to-neutral-200 font-body text-xs font-bold uppercase tracking-[0.08em] text-black shadow-[0_0_18px_rgba(168,85,247,0.55),_0_0_32px_rgba(139,92,246,0.25)] ring-1 ring-white/40 transition-all duration-200 outline-none hover:scale-105 active:scale-95"
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
          onClose={onToggle}
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
  onClose,
  onLogout,
}: Omit<AccountMenuProps, 'accountInitials' | 'isOpen' | 'menuRef' | 'onToggle'> & { onClose: () => void }) {
  return (
    <div
      role="menu"
      className="absolute right-0 top-12 z-50 w-64 overflow-hidden rounded-2xl border border-purple-500/30 bg-black p-2 shadow-[0_20px_50px_rgba(0,0,0,0.95),_0_0_25px_rgba(139,92,246,0.2),_inset_0_2px_3px_rgba(255,255,255,0.22),_inset_0_1px_1px_rgba(216,180,254,0.35),_inset_0_-4px_8px_rgba(0,0,0,0.9)] transition-all duration-200"
    >
      <div className="mb-1.5 rounded-xl border border-purple-400/20 bg-[#140b29] px-3.5 py-3 shadow-[inset_0_1px_2px_rgba(255,255,255,0.18),_inset_0_-2px_4px_rgba(0,0,0,0.7)]">
        <p className="font-body text-[0.65rem] font-bold uppercase tracking-[0.18em] text-purple-300">
          Signed in
        </p>
        <p className="truncate font-body text-sm font-semibold text-white mt-0.5">{email}</p>
      </div>
      <div className="flex flex-col gap-1">
        <button
          type="button"
          role="menuitem"
          onClick={onCompletedTasks}
          className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left font-body text-sm font-medium text-zinc-200 transition-all hover:bg-[#1a1136] hover:text-white active:scale-[0.98]"
        >
          <CheckCircle2 className="h-4 w-4 text-purple-400 transition-colors group-hover:text-purple-300" strokeWidth={1.9} />
          <span>Completed Tasks</span>
        </button>
        <button
          type="button"
          role="menuitem"
          onClick={onDesktopMode}
          className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left font-body text-sm font-medium text-zinc-200 transition-all hover:bg-[#1a1136] hover:text-white active:scale-[0.98]"
        >
          <Laptop className="h-4 w-4 text-purple-400 transition-colors group-hover:text-purple-300" strokeWidth={1.9} />
          <span>Desktop Mode</span>
        </button>
        <Link
          to="/settings"
          role="menuitem"
          onClick={onClose}
          className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left font-body text-sm font-medium text-zinc-200 transition-all hover:bg-[#1a1136] hover:text-white"
        >
          <Settings className="h-4 w-4 text-purple-400" strokeWidth={1.9} />
          <span>Settings</span>
        </Link>
        <div className="my-0.5 h-px bg-purple-500/20" />
        <button
          type="button"
          role="menuitem"
          onClick={onLogout}
          disabled={isLoggingOut}
          className="group flex w-full items-center gap-3 rounded-xl px-3 py-2.5 text-left font-body text-sm font-medium text-rose-300 transition-all hover:bg-[#2b0c16] hover:text-rose-200 active:scale-[0.98] disabled:opacity-60"
        >
          <LogOut className="h-4 w-4 text-rose-400 transition-colors group-hover:text-rose-300" strokeWidth={1.9} />
          <span>{isLoggingOut ? 'Logging out...' : 'Logout'}</span>
        </button>
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

export function BottomNavigation({
  isRecording = false,
  isRecordingActionDisabled = false,
  onToggleRecording,
}: {
  isRecording?: boolean
  isRecordingActionDisabled?: boolean
  onToggleRecording?: (() => void) | null
}) {
  const handleActionClick = (event: React.MouseEvent) => {
    if (isRecordingActionDisabled) {
      event.preventDefault()
      return
    }
    if (onToggleRecording) {
      event.preventDefault()
      onToggleRecording()
    }
  }

  return (
    <nav aria-label="Primary" className="pointer-events-none fixed inset-x-0 bottom-0 z-50 bg-transparent px-4 pb-[calc(var(--safe-area-bottom)+0.75rem)] pt-2">
      <div className="mx-auto flex w-full max-w-md items-center gap-3">
        {/* Left Pill Container with sleek black obsidian & dark purple floating styling */}
        <div className="clay-obsidian pointer-events-auto flex h-14 flex-1 items-center justify-around rounded-[2rem] px-3">
          {navigation.map((item) => {
            const Icon = item.icon
            return (
              <NavLink
                key={item.to}
                to={item.to}
                end={item.end}
                className={({ isActive }) => [
                  'group relative flex h-full flex-1 flex-col items-center justify-center transition-all duration-200 outline-none',
                  isActive
                    ? 'text-white'
                    : 'text-zinc-400/50 hover:text-purple-200 active:scale-95',
                ].join(' ')}
              >
                {({ isActive }) => (
                  <>
                    <Icon
                      className={`h-6 w-6 transition-transform duration-200 ${
                        isActive ? 'scale-110 drop-shadow-[0_0_10px_rgba(186,158,255,0.5)]' : ''
                      }`}
                      strokeWidth={1.75}
                      aria-hidden="true"
                    />
                    {isActive && (
                      <span className="absolute bottom-1.5 h-1.5 w-1.5 rounded-full bg-purple-400 shadow-[0_0_8px_#a855f7,_0_0_12px_#ba9eff]" />
                    )}
                    <span className="sr-only">{item.label}</span>
                  </>
                )}
              </NavLink>
            )
          })}
        </div>

        {/* Right Circular Action Button */}
        <Link
          to="/capture?record=1"
          replace
          onClick={handleActionClick}
          className={[
            'pointer-events-auto flex h-14 w-14 shrink-0 items-center justify-center rounded-full transition-all duration-300 active:scale-95 outline-none',
            isRecordingActionDisabled ? 'cursor-not-allowed opacity-50' : '',
            isRecording
              ? 'bg-[radial-gradient(circle_at_42%_32%,_#fda4af_0%,_#f43f5e_30%,_#e11d48_60%,_#9f1239_85%,_#881337_100%)] text-white shadow-[0_0_28px_rgba(244,63,94,0.65),_0_0_50px_rgba(225,29,72,0.35),_inset_0_1.5px_2px_rgba(255,255,255,0.7)] border border-rose-300/30 animate-pulse'
              : 'bg-[radial-gradient(circle_at_35%_28%,_#c084fc_0%,_#8b5cf6_40%,_#6d28d9_75%,_#4c1d95_100%)] text-white shadow-[0_12px_28px_rgba(139,92,246,0.45),_0_4px_12px_rgba(0,0,0,0.6),_inset_0_1.5px_2px_rgba(255,255,255,0.6),_inset_0_-2px_4px_rgba(0,0,0,0.4)] border border-purple-300/30 hover:scale-105 hover:shadow-[0_16px_32px_rgba(147,51,234,0.55),_0_6px_16px_rgba(0,0,0,0.5),_inset_0_2px_3px_rgba(255,255,255,0.7)]',
          ].join(' ')}
          aria-label={isRecording ? 'Stop recording' : 'Add a new task'}
          aria-disabled={isRecordingActionDisabled || undefined}
        >
          {isRecording ? (
            <svg className="h-6 w-6 text-white drop-shadow-[0_2px_6px_rgba(0,0,0,0.4)]" fill="currentColor" viewBox="0 0 24 24">
              <rect x="6" y="6" width="12" height="12" rx="2.5" />
            </svg>
          ) : (
            <Plus className="h-7 w-7 text-white drop-shadow-sm" strokeWidth={2.4} aria-hidden="true" />
          )}
        </Link>
      </div>
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
    <header className="safe-area-sticky-top sticky top-0 z-40 -mx-4 -mt-3 mb-3 px-4 pt-3 pb-3 bg-[#090614]/90 backdrop-blur-xl border-b border-purple-500/15 shadow-[0_8px_24px_rgba(0,0,0,0.6)] transition-all">
      <div className="flex items-center justify-between gap-3">
        <Link to="/capture" className="flex items-center gap-2.5 transition-opacity hover:opacity-90">
          <img src="/logos/gust-wind-electric.svg" alt="Gust" className="h-6 w-6 drop-shadow-[0_0_8px_rgba(186,158,255,0.4)]" />
          <h1 className="font-display text-2xl font-bold tracking-tight text-on-surface">Gust</h1>
        </Link>
        <div className="flex items-center gap-3">
          {props.shouldShowInstallButton && <Button type="button" variant="primary" size="sm" onClick={props.onInstall} aria-label={props.hasInstallPrompt ? 'Install Gust app' : 'Show iPhone install instructions'}>{props.hasInstallPrompt ? 'Install' : 'Add to Home'}</Button>}
          {props.topBarAction}
          <AccountMenu accountInitials={props.accountInitials} email={props.session.user?.email} isOpen={props.isAccountMenuOpen} isLoggingOut={props.isLoggingOut} menuRef={props.accountMenuRef} onToggle={props.onToggleAccountMenu} onCompletedTasks={props.onCompletedTasks} onDesktopMode={props.onDesktopMode} onLogout={props.onLogout} />
        </div>
      </div>
      {props.showIosInstallHelp && <InstallNotice />}
      {props.needRefresh && <UpdateNotice onUpdate={props.onUpdate} />}
      {props.offlineReady && <Card className="overflow-hidden bg-surface-container-high/90"><p className="font-body text-sm leading-6 text-on-surface-variant">App shell cached for faster launches.</p></Card>}
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
