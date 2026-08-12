import { useState, useEffect } from 'react'
import { Skeleton } from './Skeleton'

const LOADING_MESSAGES = [
  "Analyzing your voice...",
  "Extracting action items...",
  "Organizing your tasks...",
  "Connecting the dots...",
  "Almost there..."
]

interface ExtractingLoaderProps {
  variant: 'voice' | 'tasks'
}

export function ExtractingLoader({ variant }: ExtractingLoaderProps) {
  const [messageIndex, setMessageIndex] = useState(0)

  useEffect(() => {
    const interval = setInterval(() => {
      setMessageIndex(current => (current + 1) % LOADING_MESSAGES.length)
    }, 2500)
    return () => clearInterval(interval)
  }, [])

  if (variant === 'voice') {
    return (
      <div className="flex w-full items-center justify-center rounded-soft bg-[radial-gradient(circle_at_top,_rgba(186,158,255,0.24),_rgba(16,16,16,0.94)_58%)] px-4 py-10 shadow-ambient" role="status" aria-label="Transcribing voice">
        <div className="relative h-36 w-36" aria-hidden="true">
          <div className="absolute inset-0 animate-pulse rounded-full bg-[radial-gradient(circle_at_top,_rgba(196,181,253,0.9),_rgba(124,58,237,0.88))] shadow-[0_8px_0_#4c1d95,_0_15px_20px_rgba(0,0,0,0.4),_inset_0_2px_3px_rgba(255,255,255,0.6)]" />
          <div className="absolute inset-3 animate-ping rounded-full bg-primary/20" />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="h-11 w-11 animate-spin rounded-full border-2 border-white/85 border-r-transparent" />
          </div>
        </div>
      </div>
    )
  }

  // Tasks variant
  return (
    <div className="w-full space-y-6 rounded-soft bg-surface-container p-6 shadow-ambient">
      <div className="flex flex-col items-center justify-center space-y-3 py-4">
        <p className="font-display text-lg text-primary transition-opacity duration-300">
          {LOADING_MESSAGES[messageIndex]}
        </p>
      </div>

      <div className="space-y-4">
        <Skeleton variant="text" height="1.5rem" width="40%" />
        <div className="space-y-3">
          <Skeleton variant="rectangular" height="4.5rem" />
          <Skeleton variant="rectangular" height="4.5rem" />
        </div>
      </div>
    </div>
  )
}
