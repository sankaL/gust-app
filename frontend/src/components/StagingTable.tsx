import { useState } from 'react'
import { ExtractedTask } from '../lib/api'
import { ExtractedTaskCard } from './ExtractedTaskCard'
import { Button } from './Button'
import { useNotifications } from './Notifications'
interface StagingTableProps {
  tasks: ExtractedTask[]
  onApprove: (taskId: string) => Promise<void>
  onDiscard: (taskId: string) => Promise<void>
  onApproveAll: () => Promise<void>
  onDiscardAll: () => Promise<void>
  onTaskClick: (task: ExtractedTask) => void
  isLoading?: boolean
  title?: string
  subtext?: string
  emptyMessage?: string
  variant?: 'mobile' | 'desktop'
}

type BulkActionButtonsProps = {
  isApproving: boolean
  isDiscarding: boolean
  disabled: boolean
  onApprove: () => void
  onDiscard: () => void
  className: string
}

function BulkActionButtons({
  isApproving,
  isDiscarding,
  disabled,
  onApprove,
  onDiscard,
  className,
}: BulkActionButtonsProps) {
  return (
    <div className={className}>
      <Button size="sm" variant="solid" onClick={onApprove} disabled={disabled} className="min-w-max flex-1 justify-center whitespace-nowrap sm:flex-none">
        {isApproving ? '...' : 'Approve All'}
      </Button>
      <Button
        size="sm"
        variant="ghost"
        onClick={onDiscard}
        disabled={disabled}
        className="min-w-max flex-1 justify-center whitespace-nowrap text-tertiary hover:bg-tertiary/10 hover:text-tertiary sm:flex-none"
      >
        {isDiscarding ? '...' : 'Discard All'}
      </Button>
    </div>
  )
}

function ReviewCount({ count, className }: { count: number; className: string }) {
  if (count === 0) return null
  return (
    <span className={className}>
      {count} task{count !== 1 ? 's' : ''} need{count === 1 ? 's' : ''} review
    </span>
  )
}

function StagingLoading() {
  return <div className="space-y-3"><div className="space-y-2"><div className="h-4 w-40 animate-pulse rounded-full bg-white/10" /><div className="h-3 w-56 animate-pulse rounded-full bg-white/5" /></div>{Array.from({ length: 3 }).map((_, index) => <div key={index} className="rounded-card bg-surface-container-high p-4"><div className="space-y-3"><div className="h-4 w-3/4 animate-pulse rounded-full bg-white/10" /><div className="h-3 w-full animate-pulse rounded-full bg-white/5" /><div className="h-3 w-2/3 animate-pulse rounded-full bg-white/5" /></div></div>)}<p className="text-center text-sm text-on-surface-variant">Loading extracted tasks...</p></div>
}

function StagingHeader({ variant, title, subtext, pendingCount, reviewCount, actions }: { variant: 'mobile' | 'desktop'; title: string; subtext?: string; pendingCount: number; reviewCount: number; actions: BulkActionButtonsProps }) {
  if (variant === 'desktop') {
    return <div className="flex items-center justify-between gap-3 border-b border-outline/60 pb-3"><h2 className="sr-only">{title} ({pendingCount})</h2><div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 font-body text-xs text-on-surface-variant"><span>{pendingCount} pending</span><ReviewCount count={reviewCount} className="font-semibold text-warning" /></div><BulkActionButtons {...actions} className="flex flex-col gap-2 sm:flex-row sm:shrink-0 sm:items-center" /></div>
  }
  return <div className="space-y-3"><div className="min-w-0"><h2 className="truncate font-display text-base text-on-surface">{title} <span className="font-body text-on-surface-variant">({pendingCount})</span></h2>{subtext ? <p className="mt-1.5 text-xs leading-relaxed text-on-surface-variant">{subtext}</p> : null}<ReviewCount count={reviewCount} className="mt-1 block text-xs text-warning" /></div><BulkActionButtons {...actions} className="flex w-full items-stretch gap-2" /></div>
}

function StagedTaskCards({ tasks, variant, onApprove, onDiscard, onTaskClick }: Pick<StagingTableProps, 'tasks' | 'variant' | 'onApprove' | 'onDiscard' | 'onTaskClick'>) {
  return <div className={variant === 'desktop' ? 'flex flex-col gap-2' : 'space-y-3'}>{tasks.map((task) => <ExtractedTaskCard key={task.id} task={task} onApprove={onApprove} onDiscard={onDiscard} onClick={onTaskClick} variant={variant} />)}</div>
}

export function StagingTable({
  tasks,
  onApprove,
  onDiscard,
  onApproveAll,
  onDiscardAll,
  onTaskClick,
  isLoading = false,
  title = 'Extracted Tasks',
  subtext,
  emptyMessage = 'No extracted tasks to review',
  variant = 'mobile'
}: StagingTableProps) {
  const [isApprovingAll, setIsApprovingAll] = useState(false)
  const [isDiscardingAll, setIsDiscardingAll] = useState(false)
  const { notifyError } = useNotifications()

  const handleApproveAll = async () => {
    setIsApprovingAll(true)
    try {
      await onApproveAll()
    } catch (error) {
      notifyError(
        error instanceof Error ? error.message : 'Approve all could not be completed.'
      )
    } finally {
      setIsApprovingAll(false)
    }
  }

  const handleDiscardAll = async () => {
    setIsDiscardingAll(true)
    try {
      await onDiscardAll()
    } catch (error) {
      notifyError(
        error instanceof Error ? error.message : 'Discard all could not be completed.'
      )
    } finally {
      setIsDiscardingAll(false)
    }
  }

  const pendingTasks = tasks.filter(t => t.status === 'pending')
  const needsReviewCount = pendingTasks.filter(t => t.needs_review).length
  const bulkActionsDisabled =
    isApprovingAll || isDiscardingAll || isLoading || pendingTasks.length === 0
  const bulkActionProps = {
    isApproving: isApprovingAll,
    isDiscarding: isDiscardingAll,
    disabled: bulkActionsDisabled,
    onApprove: () => { void handleApproveAll() },
    onDiscard: () => { void handleDiscardAll() },
  }

  if (isLoading) {
    return <StagingLoading />
  }

  if (tasks.length === 0) {
    return (
      <div className="py-8 text-center">
        <p className="text-on-surface-variant text-sm">{emptyMessage}</p>
      </div>
    )
  }

  return (
    <div className="w-full space-y-4">
      <StagingHeader variant={variant} title={title} subtext={subtext} pendingCount={pendingTasks.length} reviewCount={needsReviewCount} actions={{ ...bulkActionProps, className: '' }} />
      <StagedTaskCards tasks={pendingTasks} variant={variant} onApprove={onApprove} onDiscard={onDiscard} onTaskClick={onTaskClick} />
    </div>
  )
}
