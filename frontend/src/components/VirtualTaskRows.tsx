import type { VirtualItem } from '@tanstack/react-virtual'

import type { TaskSummary } from '../lib/api'
import { OpenTaskCard } from './OpenTaskCard'
import { SECTION_ICONS } from '../lib/taskSections'
import { SectionLabel } from './ui/controls'

export type VirtualTaskItem =
  | { type: 'header'; sectionKey: string; label: string; count: number }
  | { type: 'task'; task: TaskSummary; highlighted?: boolean }


const rowStyle = (start: number) => ({
  position: 'absolute' as const,
  top: 0,
  left: 0,
  width: '100%',
  transform: `translateY(${start}px)`,
})

function SectionHeaderRow({ row, item, offset, measure }: { row: VirtualItem; item: Extract<VirtualTaskItem, { type: 'header' }>; offset: number; measure: (node: Element | null) => void }) {
  return (
    <div key={row.key} data-index={row.index} ref={measure} style={rowStyle(offset)} className="pb-2.5 pt-4">
      <SectionLabel icon={SECTION_ICONS[item.sectionKey]} count={item.count} tone={item.sectionKey === 'overdue' ? 'alert' : 'default'}>{item.label}</SectionLabel>
    </div>
  )
}

function TaskRow({ row, item, todayIso, offset, measure, busy, onOpen, onPrepareOpen, onComplete, onDelete }: {
  row: VirtualItem
  item: Extract<VirtualTaskItem, { type: 'task' }>
  todayIso: string
  offset: number
  measure: (node: Element | null) => void
  busy: boolean
  onOpen: (taskId: string) => void
  onPrepareOpen?: (taskId: string) => void
  onComplete: (task: TaskSummary) => void
  onDelete: (task: TaskSummary) => void
}) {
  return (
    <div key={row.key} data-index={row.index} ref={measure} style={rowStyle(offset)} className="py-1.5">
      <OpenTaskCard task={item.task} todayIso={todayIso} onOpen={onOpen} onPrepareOpen={onPrepareOpen} onComplete={onComplete} onDelete={onDelete} isBusy={busy} highlighted={item.highlighted} enableSwipe showCollapsedGroupLabel />
    </div>
  )
}

export function VirtualTaskRows({ rows, items, todayIso, busyTaskIds, measure, onOpen, onPrepareOpen, onComplete, onDelete, scrollMargin = 0 }: {
  rows: VirtualItem[]
  items: VirtualTaskItem[]
  todayIso: string
  busyTaskIds: string[]
  measure: (node: Element | null) => void
  onOpen: (taskId: string) => void
  onPrepareOpen?: (taskId: string) => void
  onComplete: (task: TaskSummary) => void
  onDelete: (task: TaskSummary) => void
  scrollMargin?: number
}) {
  return rows.map((row) => {
    const item = items[row.index]
    if (!item) return null
    const offset = row.start - scrollMargin
    if (item.type === 'header') return <SectionHeaderRow key={row.key} row={row} item={item} offset={offset} measure={measure} />
    return <TaskRow key={row.key} row={row} item={item} todayIso={todayIso} offset={offset} measure={measure} busy={busyTaskIds.includes(item.task.id)} onOpen={onOpen} onPrepareOpen={onPrepareOpen} onComplete={onComplete} onDelete={onDelete} />
  })
}
