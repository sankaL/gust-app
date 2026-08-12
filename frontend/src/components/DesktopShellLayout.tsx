import { useMemo, useState, type RefObject } from 'react'
import {
  AlertTriangle,
  BellRing,
  BarChart3,
  CheckCircle2,
  ChevronDown,
  ClipboardList,
  FolderKanban,
  LayoutDashboard,
  LogOut,
  Mic,
  PanelLeftClose,
  PanelLeftOpen,
  Plus,
  Settings2,
  Smartphone,
} from 'lucide-react'
import { Link, NavLink, Outlet } from 'react-router-dom'

import type { GroupSummary, SessionStatus, TaskSummary } from '../lib/api'
import { buildGroupNavigationSignals, type GroupNavigationSignal } from '../lib/desktopData'
import { markDeviceRedirectOverride } from '../hooks/useDeviceRedirect'
import type { DesktopHeaderContent, DesktopOutletContext } from './DesktopShellContext'

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

type LogoutAction = { mutate: () => void; isPending: boolean }

function groupAriaLabel(name: string, count: number, signal?: GroupNavigationSignal) {
  return `${name} group, ${count} open task${count === 1 ? '' : 's'}${signal ? `, ${signal.label}` : ''}`
}

function NavigationItems({ collapsed }: { collapsed: boolean }) {
  return (
    <nav aria-label="Desktop primary" className="mt-8 space-y-1">
      {primaryNavigation.map(({ to, label, icon: Icon, end }) => (
        <NavLink key={to} to={to} end={end} aria-label={collapsed ? label : undefined}
          title={collapsed ? label : undefined}
          className={({ isActive }) => [
            'flex items-center gap-3 rounded-soft px-3 py-2.5 font-body text-sm transition-[background-color,color,transform] duration-200 active:scale-[0.98]',
            collapsed ? 'justify-center' : '',
            isActive ? 'bg-surface-container-highest text-primary shadow-ambient' : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface',
          ].join(' ')}>
          <Icon className="h-4 w-4 shrink-0" strokeWidth={1.8} />
          <span className={['overflow-hidden whitespace-nowrap transition-[opacity,transform,max-width] duration-200 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]', collapsed ? 'max-w-0 -translate-x-1 opacity-0' : 'max-w-32 translate-x-0 opacity-100'].join(' ')}>{label}</span>
        </NavLink>
      ))}
    </nav>
  )
}

const signalStyles: Record<GroupNavigationSignal['tone'], { className: string; icon: typeof AlertTriangle }> = {
  overdue: { className: 'bg-error/15 text-error', icon: AlertTriangle },
  review: { className: 'bg-warning/15 text-warning', icon: AlertTriangle },
  reminder: { className: 'bg-info/15 text-info', icon: BellRing },
  clear: { className: 'bg-success/15 text-success', icon: CheckCircle2 },
}

function GroupStatusBreadcrumb({ signal, collapsed }: { signal?: GroupNavigationSignal; collapsed: boolean }) {
  if (!signal || collapsed) return null
  const { className, icon: Icon } = signalStyles[signal.tone]
  return <span title={signal.label} aria-label={signal.label} className={['inline-flex h-6 shrink-0 items-center justify-center gap-1.5 rounded-pill px-2 font-body font-semibold tabular-nums', className].join(' ')}>
    <Icon className="h-3 w-3" strokeWidth={2.25} aria-hidden="true" />
    <span className="text-[0.65rem] leading-none">{signal.label}</span>
  </span>
}

function GroupStatusDot({ signal, collapsed }: { signal?: GroupNavigationSignal; collapsed: boolean }) {
  if (!collapsed || !signal || signal.tone === 'clear') return null
  const color = { overdue: 'bg-error', review: 'bg-warning', reminder: 'bg-info', clear: 'bg-success' }[signal.tone]
  return <span aria-hidden="true" className={`absolute -right-1 -top-1 h-2.5 w-2.5 rounded-full ring-2 ring-surface-dim ${color}`} />
}

function GroupNavigation({ groups, collapsed, signals }: { groups: GroupSummary[]; collapsed: boolean; signals: Map<string, GroupNavigationSignal> }) {
  return (
    <div className="mt-8 min-h-0 flex-1">
      <div className={['mb-3 flex items-center px-3', collapsed ? 'justify-center' : 'justify-between'].join(' ')}>
        {collapsed ? null : <p className="font-body text-[0.68rem] uppercase tracking-[0.18em] text-on-surface-variant">Groups</p>}
        <BarChart3 className="h-3.5 w-3.5 text-on-surface-variant" strokeWidth={1.8} />
      </div>
      <div className="max-h-[42vh] space-y-1 overflow-y-auto pr-1">
        {groups.map((group) => (
          <NavLink key={group.id} to={`/desktop/groups/${group.id}`}
            aria-label={collapsed ? groupAriaLabel(group.name, group.open_task_count, signals.get(group.id)) : undefined}
            title={collapsed ? group.name : undefined}
            className={({ isActive }) => [
              'flex items-center gap-3 rounded-card px-3 py-2 font-body text-sm transition-[background-color,color,transform] duration-200 active:scale-[0.98]',
              collapsed ? 'justify-center' : 'justify-between',
              isActive ? 'bg-surface-container-high text-on-surface' : 'text-on-surface-variant hover:bg-surface-container hover:text-on-surface',
            ].join(' ')}>
            <span className={['flex min-w-0 items-center gap-2', collapsed ? 'justify-center' : ''].join(' ')}>
              <span className="relative shrink-0"><FolderKanban className="h-4 w-4" strokeWidth={1.8} /><GroupStatusDot signal={signals.get(group.id)} collapsed={collapsed} /></span>
              <span className={['overflow-hidden whitespace-nowrap transition-[opacity,transform,max-width] duration-200 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]', collapsed ? 'max-w-0 -translate-x-1 opacity-0' : 'max-w-32 translate-x-0 opacity-100'].join(' ')}>{group.name}</span>
            </span>
            <span className={['flex items-center transition-[opacity,transform] duration-200', collapsed ? 'absolute translate-x-1 opacity-0 pointer-events-none' : 'translate-x-0 opacity-100'].join(' ')}><span className="shrink-0 rounded-pill bg-surface-container-highest px-2 py-0.5 font-body text-[0.68rem] text-on-surface-variant">{group.open_task_count}</span></span>
            <GroupStatusBreadcrumb signal={signals.get(group.id)} collapsed={collapsed} />
          </NavLink>
        ))}
      </div>
    </div>
  )
}

function DesktopSidebar({ groups, signals, logout, collapsed, onToggle }: { groups: GroupSummary[]; signals: Map<string, GroupNavigationSignal>; logout: LogoutAction; collapsed: boolean; onToggle: () => void }) {
  const ToggleIcon = collapsed ? PanelLeftOpen : PanelLeftClose
  return (
    <aside id="desktop-sidebar" className={['sticky top-0 flex h-[100dvh] flex-col border-r border-white/10 bg-surface-dim/85 py-5 backdrop-blur-xl transition-[padding] duration-300 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] max-lg:hidden', collapsed ? 'px-3' : 'px-4'].join(' ')}>
      <div className={['flex items-center', collapsed ? 'flex-col gap-3' : 'justify-between gap-3'].join(' ')}>
        <Link to="/desktop" className={['flex min-w-0 items-center gap-3 px-2', collapsed ? 'justify-center' : ''].join(' ')} aria-label="Gust mission control" title={collapsed ? 'Gust' : undefined}>
          <img src="/logos/gust-wind-electric.svg" alt="" className="h-8 w-8 shrink-0" />
          <div className={['min-w-0 overflow-hidden whitespace-nowrap transition-[opacity,transform,max-width] duration-200 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)]', collapsed ? 'max-w-0 -translate-x-2 opacity-0' : 'max-w-36 translate-x-0 opacity-100'].join(' ')}><p className="font-display text-2xl leading-none text-on-surface">Gust</p><p className="truncate font-body text-[0.68rem] uppercase tracking-[0.18em] text-on-surface-variant">Mission Control</p></div>
        </Link>
        <button type="button" aria-controls="desktop-sidebar" aria-expanded={!collapsed}
          aria-label={collapsed ? 'Expand desktop sidebar' : 'Collapse desktop sidebar'}
          title={collapsed ? 'Expand sidebar' : 'Collapse sidebar'} onClick={onToggle}
          className="flex h-9 w-9 shrink-0 items-center justify-center rounded-full bg-surface-container text-on-surface-variant transition hover:bg-surface-container-high hover:text-on-surface active:scale-[0.96]">
          <ToggleIcon className="h-4 w-4" strokeWidth={1.8} />
        </button>
      </div>
      <NavigationItems collapsed={collapsed} />
      <GroupNavigation groups={groups} collapsed={collapsed} signals={signals} />
      <button type="button" onClick={logout.mutate} disabled={logout.isPending}
        aria-label={collapsed ? 'Logout' : undefined} title={collapsed ? 'Logout' : undefined}
        className="mt-5 flex w-full items-center justify-center gap-2 px-3 py-2 font-body text-sm font-semibold text-red-400 transition hover:text-red-300 disabled:opacity-60">
        <LogOut className="h-4 w-4 shrink-0" strokeWidth={1.8} />
        <span className={collapsed ? 'sr-only' : ''}>{logout.isPending ? 'Logging out' : 'Logout'}</span>
      </button>
    </aside>
  )
}

type AccountMenuProps = {
  initials: string
  email?: string
  isOpen: boolean
  setIsOpen: (open: boolean) => void
  menuRef: RefObject<HTMLDivElement | null>
}

function AccountMenu({ initials, email, isOpen, setIsOpen, menuRef }: AccountMenuProps) {
  return (
    <div className="relative" ref={menuRef}>
      <button type="button" className="flex h-10 items-center gap-2 rounded-full bg-on-surface px-3 font-body text-xs font-bold uppercase tracking-[0.08em] text-surface"
        aria-haspopup="menu" aria-expanded={isOpen} aria-label="Open account menu" onClick={() => setIsOpen(!isOpen)}>
        <span>{initials}</span><ChevronDown className={['h-3.5 w-3.5 transition-transform duration-200', isOpen ? 'rotate-180' : ''].join(' ')} strokeWidth={2} />
      </button>
      {isOpen ? <div role="menu" className="absolute right-0 top-12 z-50 w-64 overflow-hidden rounded-card bg-[linear-gradient(180deg,_rgb(38,38,38)_0%,_rgb(26,26,26)_100%)] py-1 shadow-[0_18px_40px_rgba(0,0,0,0.58)]">
        <div className="mb-1 bg-white/[0.03] px-3 py-3"><p className="font-body text-[0.65rem] uppercase tracking-[0.15em] text-on-surface-variant">Signed in</p><p className="truncate font-body text-sm text-on-surface">{email}</p></div>
        {accountNavigation.map(({ to, label, icon: Icon, end }) => <NavLink key={to} to={to} end={end} role="menuitem"
          onClick={() => { if (to === '/capture') markDeviceRedirectOverride(); setIsOpen(false) }}
          className={({ isActive }) => ['flex w-full items-center gap-3 px-3 py-2 text-left font-body text-sm hover:bg-surface-container-highest', isActive ? 'text-primary' : 'text-on-surface'].join(' ')}>
          <Icon className="h-4 w-4 text-on-surface-variant" strokeWidth={1.8} />{label}
        </NavLink>)}
      </div> : null}
    </div>
  )
}

type TopBarProps = AccountMenuProps & { header: DesktopHeaderContent; logout: LogoutAction }

function DesktopTopBar({ header, logout, ...account }: TopBarProps) {
  return (
    <header className="sticky top-0 z-20 border-b border-white/10 bg-surface/90 px-6 py-4 backdrop-blur-xl max-lg:px-4">
      <div className="flex items-center justify-between gap-4">
        <div className="min-w-0 flex-1"><p className="truncate font-body text-[0.65rem] font-semibold uppercase tracking-[0.16em] text-primary">{header.eyebrow}</p><h1 className="truncate font-display text-[1.55rem] leading-7 tracking-tight text-on-surface">{header.title}</h1>{header.subtitle ? <p className="truncate font-body text-xs leading-4 text-on-surface-variant">{header.subtitle}</p> : null}</div>
        <div className="flex shrink-0 items-center gap-2">{header.action}<Link to="/capture" onClick={markDeviceRedirectOverride} className="hidden items-center gap-2 rounded-pill bg-surface-container px-3 py-2 font-body text-sm text-on-surface-variant max-lg:flex"><Mic className="h-4 w-4" />Capture</Link><AccountMenu {...account} /><button type="button" onClick={logout.mutate} disabled={logout.isPending} className="inline-flex items-center gap-2 rounded-pill bg-surface-container px-3 py-2 font-body text-sm text-on-surface-variant lg:hidden"><LogOut className="h-4 w-4" />{logout.isPending ? 'Logging out' : 'Logout'}</button></div>
      </div>
    </header>
  )
}

function QuickActions({ isRecording, isLoading, isSaving, start, stop }: { isRecording: boolean; isLoading: boolean; isSaving: boolean; start: () => Promise<void>; stop: () => void }) {
  return <div className="fixed bottom-7 right-7 z-50 hidden flex-col items-center gap-4 lg:flex">
    <button type="button" onClick={isRecording ? stop : () => void start()} disabled={(isLoading || isSaving) && !isRecording}
      className={['group relative flex h-14 w-14 items-center justify-center rounded-full transition-all', isRecording ? 'translate-y-[4px] bg-rose-600 text-white' : 'bg-white text-black shadow-ambient'].join(' ')} aria-label={isRecording ? 'Stop desktop recording' : 'Start desktop recording'}>
      {isRecording ? <span className="h-4 w-4 rounded-[4px] bg-white" /> : <Mic className="h-6 w-6" strokeWidth={2.2} />}
    </button>
    <Link to="/desktop/tasks/new" className="flex h-14 w-14 items-center justify-center rounded-full bg-primary text-white shadow-ambient" aria-label="Create desktop task"><Plus className="h-7 w-7" strokeWidth={2.5} /></Link>
  </div>
}

type DesktopShellLayoutProps = {
  session: SessionStatus
  groups: GroupSummary[]
  isGroupsLoading: boolean
  openTasks: TaskSummary[]
  areNavigationSignalsLoading: boolean
  header: DesktopHeaderContent
  setHeader: DesktopOutletContext['setDesktopHeader']
  logout: LogoutAction
  account: AccountMenuProps
  recorder: { isRecording: boolean; isLoading: boolean; isSaving: boolean; start: () => Promise<void>; stop: () => void }
}

export function DesktopShellLayout({ session, groups, isGroupsLoading, openTasks, areNavigationSignalsLoading, header, setHeader, logout, account, recorder }: DesktopShellLayoutProps) {
  const [collapsed, setCollapsed] = useState(false)
  const signals = useMemo(() => areNavigationSignalsLoading ? new Map<string, GroupNavigationSignal>() : buildGroupNavigationSignals(groups, openTasks, session.timezone), [areNavigationSignalsLoading, groups, openTasks, session.timezone])
  return <div className="min-h-[100dvh] bg-surface text-on-surface"><div className={['grid min-h-[100dvh] transition-[grid-template-columns] duration-300 [transition-timing-function:cubic-bezier(0.23,1,0.32,1)] max-lg:grid-cols-1', collapsed ? 'grid-cols-[5.75rem_minmax(0,1fr)]' : 'grid-cols-[18rem_minmax(0,1fr)]'].join(' ')}><DesktopSidebar groups={groups} signals={signals} logout={logout} collapsed={collapsed} onToggle={() => setCollapsed((value) => !value)} /><div className="min-w-0"><DesktopTopBar header={header} logout={logout} {...account} /><main className="min-h-[calc(100dvh-73px)] overflow-x-hidden px-6 py-6 max-lg:px-4"><Outlet context={{ session, groups, isGroupsLoading, setDesktopHeader: setHeader }} /></main></div></div><QuickActions {...recorder} /></div>
}
