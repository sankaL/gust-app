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
      <div className="w-full space-y-6 rounded-soft bg-surface-container py-10 shadow-ambient flex flex-col items-center justify-center">
        <div className="relative">
          <div className="h-16 w-16 animate-pulse rounded-full bg-[radial-gradient(circle_at_top,_rgba(186,158,255,0.4),_rgba(132,85,239,0.2))] shadow-[0_0_40px_rgba(186,158,255,0.4)]" />
          <div className="absolute inset-0 h-16 w-16 animate-ping rounded-full bg-primary/20" />
        </div>
        <p className="font-display text-lg text-primary transition-opacity duration-300">
          Transcribing voice...
        </p>
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
