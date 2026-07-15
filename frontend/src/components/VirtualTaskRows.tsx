import type { VirtualItem } from '@tanstack/react-virtual'

import type { TaskSummary } from '../lib/api'
import { OpenTaskCard } from './OpenTaskCard'

export type VirtualTaskItem =
  | { type: 'header'; sectionKey: string; label: string; count: number }
  | { type: 'task'; task: TaskSummary }

const rowStyle = (start: number) => ({
  position: 'absolute' as const,
  top: 0,
  left: 0,
  width: '100%',
  transform: `translateY(${start}px)`,
})

function SectionHeaderRow({ row, item, measure }: { row: VirtualItem; item: Extract<VirtualTaskItem, { type: 'header' }>; measure: (node: Element | null) => void }) {
  return (
    <div key={row.key} data-index={row.index} ref={measure} style={rowStyle(row.start)} className="flex items-center justify-between px-1">
      <h3 className="font-display text-xl text-on-surface">{item.label}</h3>
      <span className="font-body text-xs uppercase tracking-[0.1em] text-on-surface-variant">{item.count} tasks</span>
    </div>
  )
}

function TaskRow({ row, item, measure, busy, onOpen, onPrepareOpen, onComplete, onDelete }: {
  row: VirtualItem
  item: Extract<VirtualTaskItem, { type: 'task' }>
  measure: (node: Element | null) => void
  busy: boolean
  onOpen: (taskId: string) => void
  onPrepareOpen?: (taskId: string) => void
  onComplete: (task: TaskSummary) => void
  onDelete: (task: TaskSummary) => void
}) {
  return (
    <div key={row.key} data-index={row.index} ref={measure} style={rowStyle(row.start)} className="px-1 py-1">
      <OpenTaskCard task={item.task} onOpen={onOpen} onPrepareOpen={onPrepareOpen} onComplete={onComplete} onDelete={onDelete} isBusy={busy} showCollapsedGroupLabel />
    </div>
  )
}

export function VirtualTaskRows({ rows, items, busyTaskIds, measure, onOpen, onPrepareOpen, onComplete, onDelete }: {
  rows: VirtualItem[]
  items: VirtualTaskItem[]
  busyTaskIds: string[]
  measure: (node: Element | null) => void
  onOpen: (taskId: string) => void
  onPrepareOpen?: (taskId: string) => void
  onComplete: (task: TaskSummary) => void
  onDelete: (task: TaskSummary) => void
}) {
  return rows.map((row) => {
    const item = items[row.index]
    if (!item) return null
    if (item.type === 'header') return <SectionHeaderRow key={row.key} row={row} item={item} measure={measure} />
    return <TaskRow key={row.key} row={row} item={item} measure={measure} busy={busyTaskIds.includes(item.task.id)} onOpen={onOpen} onPrepareOpen={onPrepareOpen} onComplete={onComplete} onDelete={onDelete} />
  })
}
