import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Inbox, Layers, Search, X } from 'lucide-react'

import type { GroupSummary } from '../lib/api'

const basePillClass = 'flex h-10 items-center gap-1.5 rounded-pill px-3 py-1.5 font-body text-xs font-medium outline-none transition-all duration-200 active:scale-95 sm:gap-2 sm:px-4 sm:py-2 sm:text-sm'
const activePillClass = 'bg-[radial-gradient(circle_at_top_left,_#5b21b6_0%,_#2e1065_100%)] text-white shadow-[0_2px_0_#171033,_0_4px_8px_rgba(0,0,0,0.3),_inset_0_1px_2px_rgba(255,255,255,0.15)] -translate-y-[1px]'
const inactivePillClass = 'bg-surface-container-high text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] border border-white/5'

function pillClass(active: boolean) {
  return `${basePillClass} ${active ? activePillClass : inactivePillClass}`
}

type TaskGroupTabsProps = {
  groups: GroupSummary[]
  inboxGroupId?: string | null
  selectedGroupId: string
  searchQuery: string
  isSearchActive: boolean
  onSelectGroup: (groupId: string) => void
  onSearchOpen: () => void
  onSearchChange: (value: string) => void
  onSearchClear: () => void
}

function TaskSearchField({ active, value, inputRef, onChange, onClear }: {
  active: boolean
  value: string
  inputRef: React.RefObject<HTMLInputElement | null>
  onChange: (value: string) => void
  onClear: () => void
}) {
  return (
    <div
      aria-hidden={!active}
      className={`absolute inset-0 flex items-center transition-all duration-200 ease-out motion-reduce:transition-none ${active ? 'pointer-events-auto translate-x-0 scale-100 opacity-100' : 'pointer-events-none -translate-x-2 scale-[0.98] opacity-0'}`}
    >
      <Search aria-hidden="true" className="pointer-events-none absolute left-3.5 h-4 w-4 text-primary" />
      <input
        ref={inputRef}
        type="text"
        inputMode="search"
        aria-label="Search tasks"
        value={value}
        maxLength={200}
        tabIndex={active ? 0 : -1}
        onChange={(event) => onChange(event.target.value)}
        onKeyDown={(event) => { if (event.key === 'Escape') onClear() }}
        placeholder="Search tasks..."
        className="h-10 w-full rounded-pill bg-surface-container-high pl-10 pr-12 font-body text-sm text-on-surface shadow-[inset_0_1px_2px_rgba(255,255,255,0.06),_0_8px_22px_rgba(0,0,0,0.28)] outline-none ring-1 ring-outline/15 transition-shadow placeholder:text-on-surface-variant/55 focus:ring-2 focus:ring-primary/65"
      />
      <button
        type="button"
        aria-label="Clear search"
        title="Clear search"
        tabIndex={active ? 0 : -1}
        onClick={onClear}
        className="absolute right-0 flex h-10 w-10 items-center justify-center rounded-full text-on-surface-variant outline-none transition-all duration-200 hover:bg-surface-container-highest hover:text-on-surface focus-visible:ring-2 focus-visible:ring-primary/70 active:scale-90 motion-reduce:transition-none"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  )
}

function GroupPills({ props, menuRef, searchButtonRef, isOpen, setIsOpen, inbox, otherGroups, selectedOther, onSelectOther }: {
  props: TaskGroupTabsProps
  menuRef: React.RefObject<HTMLDivElement | null>
  searchButtonRef: React.RefObject<HTMLButtonElement | null>
  isOpen: boolean
  setIsOpen: React.Dispatch<React.SetStateAction<boolean>>
  inbox?: GroupSummary
  otherGroups: GroupSummary[]
  selectedOther?: GroupSummary
  onSelectOther: (groupId: string) => void
}) {
  const tabIndex = props.isSearchActive ? -1 : 0
  return (
    <div
      aria-hidden={props.isSearchActive}
      className={`absolute inset-0 flex w-full min-w-0 items-center gap-1.5 transition-all duration-200 ease-out motion-reduce:transition-none sm:gap-2 ${props.isSearchActive ? 'pointer-events-none translate-x-2 scale-[0.98] opacity-0' : 'pointer-events-auto translate-x-0 scale-100 opacity-100'}`}
    >
      <button
        ref={searchButtonRef}
        type="button"
        aria-label="Search tasks"
        title="Search tasks"
        tabIndex={tabIndex}
        onClick={props.onSearchOpen}
        className="flex h-10 w-10 shrink-0 items-center justify-center rounded-full bg-surface-container-high text-primary shadow-[inset_0_1px_2px_rgba(255,255,255,0.06),_0_4px_12px_rgba(0,0,0,0.3)] outline-none transition-all duration-200 hover:-translate-y-0.5 hover:bg-surface-container-highest hover:text-white focus-visible:ring-2 focus-visible:ring-primary/70 active:translate-y-0 active:scale-90 motion-reduce:transition-none"
      >
        <Search className="h-4 w-4" />
      </button>
      <button type="button" tabIndex={tabIndex} onClick={() => props.onSelectGroup('all')} className={pillClass(props.selectedGroupId === 'all')}><Layers className="h-3.5 w-3.5 sm:h-4 sm:w-4" /><span className="truncate">All</span></button>
      {inbox && <button type="button" tabIndex={tabIndex} onClick={() => props.onSelectGroup(inbox.id)} className={pillClass(props.selectedGroupId === inbox.id)}><Inbox className="h-3.5 w-3.5 sm:h-4 sm:w-4" /><span className="truncate">Inbox</span><span className="shrink-0 text-[0.68rem] opacity-70 sm:text-xs">• {inbox.open_task_count}</span></button>}
      <div ref={menuRef} className="relative min-w-0 flex-1">
        <button type="button" tabIndex={tabIndex} onClick={() => setIsOpen((current) => !current)} className={`${pillClass(Boolean(selectedOther))} w-full min-w-0 justify-between`}>
          {selectedOther ? <span className="flex min-w-0 items-center gap-1.5"><span className="truncate">{selectedOther.name}</span><span className="shrink-0 text-[0.68rem] opacity-70 sm:text-xs">• {selectedOther.open_task_count}</span></span> : <span>Other</span>}
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 sm:h-4 sm:w-4 ${isOpen ? 'rotate-180' : ''}`} />
        </button>
        {isOpen && otherGroups.length > 0 && <ul className="absolute z-50 mt-2 max-h-60 w-full overflow-y-auto rounded-card bg-[linear-gradient(180deg,_rgb(38,38,38)_0%,_rgb(26,26,26)_100%)] py-1 shadow-[0_18px_40px_rgba(0,0,0,0.58),_inset_0_1px_0_rgba(255,255,255,0.05)]">{otherGroups.map((group) => <li key={group.id}><button type="button" onClick={() => onSelectOther(group.id)} className={`flex w-full items-center justify-between px-3 py-2 text-sm text-on-surface transition-colors hover:bg-surface-container-highest ${group.id === props.selectedGroupId ? 'bg-surface-container-highest' : ''}`}><span className="truncate">{group.name}</span><span className="shrink-0 text-xs text-on-surface-variant">{group.open_task_count}</span></button></li>)}</ul>}
      </div>
    </div>
  )
}

export function TaskGroupTabs(props: TaskGroupTabsProps) {
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const searchButtonRef = useRef<HTMLButtonElement>(null)
  const searchInputRef = useRef<HTMLInputElement>(null)
  const wasSearchActive = useRef(props.isSearchActive)
  const inbox = props.groups.find((group) => group.id === props.inboxGroupId)
  const otherGroups = props.groups.filter((group) => group.id !== props.inboxGroupId)
  const selectedOther = otherGroups.find((group) => group.id === props.selectedGroupId)

  useEffect(() => {
    if (!isOpen) return
    const closeOutside = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setIsOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    return () => document.removeEventListener('mousedown', closeOutside)
  }, [isOpen])

  useEffect(() => {
    if (props.isSearchActive) {
      setIsOpen(false)
      searchInputRef.current?.focus()
    } else if (wasSearchActive.current) {
      searchButtonRef.current?.focus()
    }
    wasSearchActive.current = props.isSearchActive
  }, [props.isSearchActive])

  function selectOther(groupId: string) {
    props.onSelectGroup(groupId)
    setIsOpen(false)
  }

  return (
    <div className={`relative h-10 w-full min-w-0 ${isOpen ? 'z-30' : ''}`}>
      <GroupPills props={props} menuRef={menuRef} searchButtonRef={searchButtonRef} isOpen={isOpen} setIsOpen={setIsOpen} inbox={inbox} otherGroups={otherGroups} selectedOther={selectedOther} onSelectOther={selectOther} />
      <TaskSearchField active={props.isSearchActive} value={props.searchQuery} inputRef={searchInputRef} onChange={props.onSearchChange} onClear={props.onSearchClear} />
    </div>
  )
}
