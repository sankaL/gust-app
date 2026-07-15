import { useEffect, useRef, useState } from 'react'
import { ChevronDown, Inbox, Layers } from 'lucide-react'

import type { GroupSummary } from '../lib/api'

const basePillClass = 'rounded-pill px-3 py-1.5 font-body text-xs font-medium transition-all duration-200 active:scale-95 outline-none flex items-center gap-1.5 sm:px-4 sm:py-2 sm:text-sm sm:gap-2'
const activePillClass = 'bg-[radial-gradient(circle_at_top_left,_#5b21b6_0%,_#2e1065_100%)] text-white shadow-[0_2px_0_#171033,_0_4px_8px_rgba(0,0,0,0.3),_inset_0_1px_2px_rgba(255,255,255,0.15)] -translate-y-[1px]'
const inactivePillClass = 'bg-surface-container-high text-on-surface-variant hover:text-on-surface hover:bg-surface-container-highest shadow-[inset_0_1px_1px_rgba(255,255,255,0.05)] border border-white/5'

function pillClass(active: boolean) {
  return `${basePillClass} ${active ? activePillClass : inactivePillClass}`
}

export function TaskGroupTabs({
  groups,
  inboxGroupId,
  selectedGroupId,
  onSelectGroup,
}: {
  groups: GroupSummary[]
  inboxGroupId?: string | null
  selectedGroupId: string
  onSelectGroup: (groupId: string) => void
}) {
  const [isOpen, setIsOpen] = useState(false)
  const menuRef = useRef<HTMLDivElement>(null)
  const inbox = groups.find((group) => group.id === inboxGroupId)
  const otherGroups = groups.filter((group) => group.id !== inboxGroupId)
  const selectedOther = otherGroups.find((group) => group.id === selectedGroupId)

  useEffect(() => {
    if (!isOpen) return
    const closeOutside = (event: MouseEvent) => {
      if (!menuRef.current?.contains(event.target as Node)) setIsOpen(false)
    }
    document.addEventListener('mousedown', closeOutside)
    return () => document.removeEventListener('mousedown', closeOutside)
  }, [isOpen])

  function selectOther(groupId: string) {
    onSelectGroup(groupId)
    setIsOpen(false)
  }

  return (
    <div className="flex w-full min-w-0 gap-1.5 sm:gap-2">
      <button type="button" onClick={() => onSelectGroup('all')} className={pillClass(selectedGroupId === 'all')}><Layers className="h-3.5 w-3.5 sm:h-4 sm:w-4" /><span className="truncate">All</span></button>
      {inbox && <button type="button" onClick={() => onSelectGroup(inbox.id)} className={pillClass(selectedGroupId === inbox.id)}><Inbox className="h-3.5 w-3.5 sm:h-4 sm:w-4" /><span className="truncate">Inbox</span><span className="shrink-0 text-[0.68rem] opacity-70 sm:text-xs">• {inbox.open_task_count}</span></button>}
      <div ref={menuRef} className="relative min-w-0 flex-1">
        <button type="button" onClick={() => setIsOpen((current) => !current)} className={`${pillClass(Boolean(selectedOther))} w-full min-w-0 justify-between`}>
          {selectedOther ? <span className="flex min-w-0 items-center gap-1.5"><span className="truncate">{selectedOther.name}</span><span className="shrink-0 text-[0.68rem] opacity-70 sm:text-xs">• {selectedOther.open_task_count}</span></span> : <span>Other</span>}
          <ChevronDown className={`h-3.5 w-3.5 shrink-0 transition-transform duration-200 sm:h-4 sm:w-4 ${isOpen ? 'rotate-180' : ''}`} />
        </button>
        {isOpen && otherGroups.length > 0 && <ul className="absolute z-50 mt-2 max-h-60 w-full overflow-y-auto rounded-card bg-[linear-gradient(180deg,_rgb(38,38,38)_0%,_rgb(26,26,26)_100%)] py-1 shadow-[0_18px_40px_rgba(0,0,0,0.58),_inset_0_1px_0_rgba(255,255,255,0.05)]">{otherGroups.map((group) => <li key={group.id}><button type="button" onClick={() => selectOther(group.id)} className={`flex w-full items-center justify-between px-3 py-2 text-sm text-on-surface transition-colors hover:bg-surface-container-highest ${group.id === selectedGroupId ? 'bg-surface-container-highest' : ''}`}><span className="truncate">{group.name}</span><span className="shrink-0 text-xs text-on-surface-variant">{group.open_task_count}</span></button></li>)}</ul>}
      </div>
    </div>
  )
}
