import { ArrowDown, ArrowUp, CheckCircle2, Filter, RotateCcw, Search, X } from 'lucide-react'

import type { GroupSummary, TaskSummary } from '../lib/api'
import { formatDateTimeLabel, formatIsoDateLabel, type DesktopSortKey } from '../lib/desktopData'
import { DESKTOP_TASKS_PER_PAGE, type useDesktopTaskTableState } from '../hooks/useDesktopTaskTableState'
import { SelectDropdown } from './SelectDropdown'

type State = ReturnType<typeof useDesktopTaskTableState>
type Actions = {
  busyTaskIds: string[]; onComplete?: (task: TaskSummary) => void; onReopen?: (task: TaskSummary) => void
  onMoveDueDate?: (task: TaskSummary, dueDate: string | null) => void; onTaskOpen?: (taskId: string) => void
}
const labels: Record<DesktopSortKey, string> = { title: 'Title', group: 'Group', due_date: 'Due', created_at: 'Created', completed_at: 'Completed', review: 'Review', recurrence: 'Recurrence' }
const selectStyle = { className: 'space-y-1', labelClassName: 'font-body text-[0.68rem] uppercase tracking-[0.16em] text-on-surface-variant', triggerClassName: 'h-10 px-3 font-body text-sm ring-1 ring-white/10 focus:ring-primary' }

function FilterSelect({ label, value, options, onChange }: { label: string; value: string; options: { value: string; label: string }[]; onChange: (value: string) => void }) {
  return <SelectDropdown label={label} options={options} value={value} onChange={(value) => onChange(String(value))} {...selectStyle} />
}

function TaskFilterMenu({ state, groups, status, lockedGroupId }: { state: State; groups: GroupSummary[]; status: string; lockedGroupId?: string }) {
  if (!state.showFilters) return null
  return <div className="absolute right-0 top-12 z-50 w-64 rounded-card bg-surface-container-highest p-4 shadow-ambient ring-1 ring-white/10"><div className="flex flex-col gap-4">
    {lockedGroupId ? null : <FilterSelect label="Group" value={state.filters.groupId} options={[{ value: 'all', label: 'All groups' }, ...groups.map((group) => ({ value: group.id, label: group.name }))]} onChange={(value) => state.setParam('group', value)} />}
    {status === 'completed' ? null : <FilterSelect label="Bucket" value={state.filters.dueBucket} options={[{ value: 'all', label: 'All buckets' }, { value: 'overdue', label: 'Overdue' }, { value: 'due_soon', label: 'Due soon' }, { value: 'no_date', label: 'No date' }]} onChange={(value) => state.setParam('bucket', value)} />}
    <FilterSelect label="Review" value={state.filters.review} options={[{ value: 'all', label: 'All review states' }, { value: 'needs_review', label: 'Needs review' }, { value: 'clear', label: 'Clear' }]} onChange={(value) => state.setParam('review', value)} />
    <div className="flex gap-2">{(['from', 'to'] as const).map((key) => <label key={key} className="w-1/2 space-y-1"><span className="font-body text-[0.68rem] uppercase text-on-surface-variant">{key}</span><input type="date" value={key === 'from' ? state.filters.dueFrom : state.filters.dueTo} onChange={(event) => state.setParam(key, event.target.value)} className="h-10 w-full rounded-card bg-surface-dim px-3 text-sm" /></label>)}</div>
    <FilterSelect label="Recurrence" value={state.filters.recurrence} options={[{ value: 'all', label: 'All' }, { value: 'recurring', label: 'Recurring' }, { value: 'one_off', label: 'One-off' }]} onChange={(value) => state.setParam('recurrence', value)} />
    <FilterSelect label="Subtasks" value={state.filters.subtasks} options={[{ value: 'all', label: 'All' }, { value: 'has_subtasks', label: 'Has subtasks' }, { value: 'no_subtasks', label: 'No subtasks' }]} onChange={(value) => state.setParam('subtasks', value)} />
    {state.activeFilterCount ? <button type="button" onClick={state.clearFilters} className="inline-flex h-10 items-center justify-center gap-2 rounded-card bg-primary text-on-primary"><X className="h-3.5 w-3.5" />Clear filters</button> : null}
  </div></div>
}

function TaskFilters({ state, groups, status, lockedGroupId }: { state: State; groups: GroupSummary[]; status: string; lockedGroupId?: string }) {
  return <div className="relative space-y-3"><div className="flex items-center gap-3"><div className="relative flex-grow"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-on-surface-variant" /><input value={state.filters.search} onChange={(event) => state.setParam('q', event.target.value)} placeholder="Search for any tasks..." className="h-10 w-full rounded-card bg-surface-dim pl-10 pr-3 text-sm" /></div><button type="button" onClick={() => state.setShowFilters(!state.showFilters)} aria-label="Toggle filters" className="relative flex h-10 w-10 items-center justify-center rounded-card bg-surface-dim"><Filter className="h-4 w-4" />{state.activeFilterCount ? <span className="absolute -right-1 -top-1 rounded-full bg-black px-1 text-[0.6rem] text-white">{state.activeFilterCount}</span> : null}</button></div><TaskFilterMenu state={state} groups={groups} status={status} lockedGroupId={lockedGroupId} /></div>
}

function TaskTitleCell({ task, onOpen }: { task: TaskSummary; onOpen?: (taskId: string) => void }) {
  return <td className="max-w-[22rem] px-4 py-3 align-top"><button type="button" onClick={() => onOpen?.(task.id)} className="text-left text-sm font-semibold text-on-surface">{task.title}</button>{task.description ? <p className="mt-1 line-clamp-1 text-xs text-on-surface-variant">{task.description}</p> : null}</td>
}

function TaskDueCell({ task, todayIso, onMove }: { task: TaskSummary; todayIso?: string; onMove?: Actions['onMoveDueDate'] }) {
  const isOverdue = Boolean(task.status === 'open' && task.due_date && todayIso && task.due_date < todayIso)
  if (task.status === 'open' && onMove) return <td className="px-4 py-3"><input type="date" value={task.due_date ?? ''} onChange={(event) => onMove(task, event.target.value || null)} className={['w-36 rounded-card px-2 py-1.5 text-sm transition-[background-color,color,box-shadow] focus:outline-none', isOverdue ? 'bg-error/15 text-error shadow-[inset_0_0_0_1px_rgba(239,83,80,0.5)] focus:shadow-[inset_0_0_0_1px_rgba(239,83,80,0.9),0_0_18px_rgba(239,83,80,0.18)]' : 'bg-surface-dim focus:shadow-[inset_0_0_0_1px_var(--color-primary)]'].join(' ')} aria-label={`Move ${task.title} due date${isOverdue ? ', overdue' : ''}`} /></td>
  return <td className="px-4 py-3"><span className="text-sm text-on-surface-variant">{task.due_date ? formatIsoDateLabel(task.due_date) : 'No date'}</span></td>
}

function CompletedAtCell({ task, status }: { task: TaskSummary; status: string }) {
  if (status === 'open') return null
  return <td className="px-4 py-3 text-sm text-on-surface-variant">{formatDateTimeLabel(task.completed_at)}</td>
}

function TaskActionCell({ task, actions }: { task: TaskSummary; actions: Actions }) {
  const busy = actions.busyTaskIds.includes(task.id)
  if (task.status === 'open' && actions.onComplete) return <td className="px-4 py-3 text-right"><button type="button" onClick={() => actions.onComplete?.(task)} disabled={busy} className="rounded-pill bg-success/20 px-3 py-1.5 text-xs text-success"><CheckCircle2 className="mr-1 inline h-3.5 w-3.5" />Complete</button></td>
  if (task.status === 'completed' && actions.onReopen) return <td className="px-4 py-3 text-right"><button type="button" onClick={() => actions.onReopen?.(task)} disabled={busy} className="rounded-pill bg-surface-dim px-3 py-1.5 text-xs"><RotateCcw className="mr-1 inline h-3.5 w-3.5" />Restore</button></td>
  return <td className="px-4 py-3 text-right" />
}

function TaskRow({ task, status, todayIso, actions }: { task: TaskSummary; status: string; todayIso?: string; actions: Actions }) {
  const reviewLabel = task.needs_review ? 'Review' : 'Clear'
  const reviewClass = task.needs_review ? 'text-warning' : 'text-on-surface-variant'
  const subtaskLabel = task.subtask_count ? ` · ${task.subtask_count}` : ''
  return <tr className="transition hover:bg-surface-container-high/70"><TaskTitleCell task={task} onOpen={actions.onTaskOpen} /><td className="px-4 py-3 text-sm text-on-surface-variant">{task.group.name}</td><TaskDueCell task={task} todayIso={todayIso} onMove={actions.onMoveDueDate} /><td className="px-4 py-3 text-sm text-on-surface-variant">{formatDateTimeLabel(task.created_at)}</td><CompletedAtCell task={task} status={status} /><td className="px-4 py-3"><span className={reviewClass}>{reviewLabel}</span></td><td className="px-4 py-3 text-sm text-on-surface-variant">{task.recurrence_frequency ?? 'One-off'}{subtaskLabel}</td><TaskActionCell task={task} actions={actions} /></tr>
}

function TaskGrid({ state, status, todayIso, actions }: { state: State; status: string; todayIso?: string; actions: Actions }) {
  const keys = (Object.keys(labels) as DesktopSortKey[]).filter((key) => status !== 'open' || key !== 'completed_at')
  return <div className="overflow-x-auto rounded-soft bg-surface-container"><table className="w-full min-w-[980px]"><thead><tr className="bg-surface-container-high text-left">{keys.map((key) => <th key={key} className="px-4 py-3"><button type="button" onClick={() => state.setSort(key)} className="text-[0.68rem] uppercase text-on-surface-variant">{labels[key]}{state.sort.key === key ? state.sort.direction === 'asc' ? <ArrowUp className="ml-1 inline h-3 w-3" /> : <ArrowDown className="ml-1 inline h-3 w-3" /> : null}</button></th>)}<th className="px-4 py-3 text-right text-[0.68rem] uppercase">Actions</th></tr></thead><tbody className="divide-y divide-white/5">{state.visibleTasks.length ? state.pagedTasks.map((task) => <TaskRow key={task.id} task={task} status={status} todayIso={todayIso} actions={actions} />) : <tr><td colSpan={status === 'open' ? 7 : 8} className="px-4 py-10 text-center"><p className="font-display text-2xl">No tasks match this view</p><p className="mt-2 text-sm text-on-surface-variant">Adjust the search or filters to widen the mission board.</p></td></tr>}</tbody></table></div>
}

function Pagination({ state }: { state: State }) {
  if (state.visibleTasks.length <= DESKTOP_TASKS_PER_PAGE) return null
  const first = state.start + 1, last = Math.min(state.start + DESKTOP_TASKS_PER_PAGE, state.visibleTasks.length)
  return <div className="flex items-center justify-center gap-3 pb-24 text-sm text-on-surface-variant"><p>Showing {first}-{last} of {state.visibleTasks.length}</p><button type="button" onClick={() => state.setPage(state.page - 1)} disabled={state.page === 1}>Previous</button><span>Page {state.page} of {state.pageCount}</span><button type="button" onClick={() => state.setPage(state.page + 1)} disabled={state.page === state.pageCount}>Next</button></div>
}

export function DesktopTaskTableView({ title, total, hideHeader, groups, status, lockedGroupId, todayIso, state, actions }: { title: string; total: number; hideHeader: boolean; groups: GroupSummary[]; status: 'open' | 'completed' | 'all'; lockedGroupId?: string; todayIso?: string; state: State; actions: Actions }) {
  return <section className="space-y-4">{hideHeader ? null : <div><h2 className="font-display text-3xl">{title}</h2><p className="text-sm text-on-surface-variant">{state.visibleTasks.length} of {total} tasks visible</p></div>}<TaskFilters state={state} groups={groups} status={status} lockedGroupId={lockedGroupId} /><TaskGrid state={state} status={status} todayIso={todayIso} actions={actions} /><Pagination state={state} /></section>
}
