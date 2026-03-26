import { useState } from 'react'
import { ExtractedTask } from '../lib/api'
import { Card } from './Card'

const getDueDateColor = (dueDate: string | null): string => {
  if (!dueDate) return 'text-on-surface-variant/50'
  const today = new Date()
  const due = new Date(`${dueDate}T00:00:00`)
  const todayDay = Date.UTC(today.getFullYear(), today.getMonth(), today.getDate()) / 86400000
  const dueDay = Date.UTC(due.getFullYear(), due.getMonth(), due.getDate()) / 86400000
  const diff = dueDay - todayDay
  if (diff < 0) return 'text-error'
  if (diff === 0) return 'text-warning'
  return 'text-primary'
}

interface ExtractedTaskCardProps {
  task: ExtractedTask
  onApprove: (taskId: string) => void
  onDiscard: (taskId: string) => void
  onClick: (task: ExtractedTask) => void
}

export function ExtractedTaskCard({
  task,
  onApprove,
  onDiscard,
  onClick
}: ExtractedTaskCardProps) {
  const [isApproving, setIsApproving] = useState(false)
  const [isDiscarding, setIsDiscarding] = useState(false)

  const handleApprove = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setIsApproving(true)
    try {
      await onApprove(task.id)
    } finally {
      setIsApproving(false)
    }
  }

  const handleDiscard = async (e: React.MouseEvent) => {
    e.stopPropagation()
    setIsDiscarding(true)
    try {
      await onDiscard(task.id)
    } finally {
      setIsDiscarding(false)
    }
  }

  const handleCardClick = () => {
    onClick(task)
  }

  const getConfidenceColor = (confidence: number) => {
    if (confidence >= 0.8) return 'text-primary'
    if (confidence >= 0.7) return 'text-warning'
    return 'text-tertiary'
  }

  const getConfidenceLabel = (confidence: number) => {
    if (confidence >= 0.8) return 'High'
    if (confidence >= 0.7) return 'Medium'
    return 'Low'
  }

  return (
    <Card 
      interactive 
      onClick={handleCardClick}
      className="bg-surface-container-high border border-white/5"
    >
      <div className="flex flex-col gap-3">
        
        <div className="flex items-stretch justify-between gap-4">
          
          {/* Left Column: Title & Metadata */}
          <div className="flex-1 min-w-0 flex flex-col justify-between py-0.5">
            <div className="flex flex-col gap-1.5 align-top">
              <h3 className="font-display text-lg font-medium text-on-surface truncate leading-tight">
                {task.title}
              </h3>
              
              <div className="flex items-center gap-2 font-body text-xs text-on-surface-variant flex-wrap">
                <span className="text-on-surface-variant/80 font-medium">
                  {task.group_name || 'Inbox'}
                </span>
                {task.needs_review && (
                  <span className="inline-block px-2 py-0.5 text-[0.65rem] uppercase tracking-widest font-bold bg-warning/20 text-warning rounded-pill">
                    Needs Review
                  </span>
                )}
              </div>
            </div>

            <div className="mt-4">
              <span className={`${getDueDateColor(task.due_date)} uppercase tracking-wider text-[0.65rem] font-bold`}>
                Due: {task.due_date ? new Date(task.due_date + 'T00:00:00').toLocaleDateString() : '--'}
              </span>
            </div>
          </div>

          {/* Right Column: Badges & Actions */}
          <div className="flex flex-col items-end justify-between gap-4 shrink-0">
            {/* Top Right: Badges */}
            <div className="flex items-center gap-2">
              <span className={`font-body text-[0.65rem] uppercase tracking-widest px-2 py-0.5 rounded-pill ${
                task.recurrence_frequency && task.recurrence_frequency !== 'none' 
                  ? 'bg-primary/20 text-primary' 
                  : 'bg-surface-dim text-on-surface-variant/40'
              }`} title={task.recurrence_frequency && task.recurrence_frequency !== 'none' ? `Recurring: ${task.recurrence_frequency}` : 'No recurrence'}>
                {task.recurrence_frequency && task.recurrence_frequency !== 'none' ? task.recurrence_frequency : 'ONE-OFF'}
              </span>
              
              <div 
                className="flex items-center gap-1 bg-surface-dim px-2 py-0.5 rounded-pill cursor-help"
                title={`Confidence Score: ${getConfidenceLabel(task.top_confidence)}`}
              >
                <span className={`text-[0.65rem] ${getConfidenceColor(task.top_confidence)}`}>●</span>
                <span className="font-body text-[0.65rem] text-on-surface-variant uppercase tracking-widest">
                  {getConfidenceLabel(task.top_confidence)}
                </span>
              </div>
            </div>

            {/* Bottom Right: Actions */}
            <div 
              className="flex items-center gap-3 shrink-0"
              onClick={(e) => e.stopPropagation()}
            >
              <button
                onClick={handleApprove}
                disabled={isApproving || isDiscarding}
                className="flex items-center justify-center w-8 h-8 rounded-full bg-surface-dim border border-white/10 shadow-[0_4px_12px_rgba(0,0,0,0.5),_inset_0_2px_4px_rgba(255,255,255,0.1)] text-primary hover:bg-surface-container-highest hover:-translate-y-0.5 transition-all duration-200 active:scale-90 active:translate-y-0 disabled:opacity-50 disabled:hover:-translate-y-0 disabled:active:scale-100"
                aria-label="Approve"
              >
                {isApproving ? (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M5 13l4 4L19 7" /></svg>
                )}
              </button>
              <button
                onClick={handleDiscard}
                disabled={isApproving || isDiscarding}
                className="flex items-center justify-center w-8 h-8 rounded-full bg-surface-dim border border-white/10 shadow-[0_4px_12px_rgba(0,0,0,0.5),_inset_0_2px_4px_rgba(255,255,255,0.1)] text-tertiary hover:bg-surface-container-highest hover:-translate-y-0.5 transition-all duration-200 active:scale-90 active:translate-y-0 disabled:opacity-50 disabled:hover:-translate-y-0 disabled:active:scale-100"
                aria-label="Discard"
              >
                {isDiscarding ? (
                  <svg className="w-4 h-4 animate-spin" fill="none" viewBox="0 0 24 24"><circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="3" /><path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" /></svg>
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24"><path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2.5} d="M6 18L18 6M6 6l12 12" /></svg>
                )}
              </button>
            </div>
          </div>
        </div>
      </div>
    </Card>
  )
}
