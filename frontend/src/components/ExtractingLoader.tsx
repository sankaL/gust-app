import { useState, useEffect } from 'react'
import { AtmosphericWaveBackdrop } from './AtmosphericWaveBackdrop'
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
      setMessageIndex((current) => (current + 1) % LOADING_MESSAGES.length)
    }, 2500)
    return () => clearInterval(interval)
  }, [])

  if (variant === 'voice') {
    return (
      <div className="relative overflow-visible py-2 text-center" role="status" aria-label="Transcribing voice">
        <div className="relative z-10 space-y-5">
          {/* Animated word loading indicator with smooth swap transition */}
          <div className="inline-flex items-center gap-2 py-1.5">
            <span className="relative flex h-2 w-2">
              <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
              <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
            </span>
            <p
              key={messageIndex}
              className="animate-word-swap font-body text-sm font-medium tracking-wide text-emerald-200"
            >
              {LOADING_MESSAGES[messageIndex]}
            </p>
          </div>

          <div className="relative flex items-center justify-center">
            {/* Atmospheric soundwave backdrop in extracting (greenish) mode */}
            <AtmosphericWaveBackdrop mode="extracting" />

            {/* Glowing 3D Spherical Orb in luminous emerald/greenish theme */}
            <div
              className="relative z-10 mx-auto flex h-44 w-44 items-center justify-center rounded-full bg-[radial-gradient(circle_at_42%_32%,_#a7f3d0_0%,_#34d399_28%,_#10b981_55%,_#059669_80%,_#047857_100%)] text-white shadow-[0_0_60px_rgba(16,185,129,0.7),_0_0_110px_rgba(5,150,105,0.4),_inset_0_1.5px_2px_rgba(255,255,255,0.8),_inset_0_-2px_6px_rgba(0,0,0,0.35)] border border-emerald-300/40"
              aria-hidden="true"
            >
              <div className="relative flex items-center justify-center">
                {/* Luminous spinning ring with emerald glow */}
                <span className="h-16 w-16 animate-spin rounded-full border-2 border-emerald-100/25 border-t-emerald-100 border-r-emerald-200/90 shadow-[0_0_16px_rgba(52,211,153,0.9)]" />
                {/* Center glowing microphone icon */}
                <svg
                  className="absolute h-7 w-7 text-white animate-pulse drop-shadow-[0_0_10px_rgba(255,255,255,0.95)]"
                  viewBox="0 0 24 24"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth={2}
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="M12 2a3 3 0 0 0-3 3v7a3 3 0 0 0 6 0V5a3 3 0 0 0-3-3Z" />
                  <path d="M19 10v2a7 7 0 0 1-14 0v-2" />
                  <line x1="12" x2="12" y1="19" y2="22" />
                </svg>
              </div>
            </div>
          </div>
        </div>
      </div>
    )
  }

  // Tasks variant
  return (
    <div className="w-full space-y-6 rounded-2xl border border-emerald-500/25 bg-[#051710]/80 p-6 shadow-[0_0_36px_rgba(16,185,129,0.1)] backdrop-blur-md">
      <div className="flex flex-col items-center justify-center space-y-3 py-4">
        <div className="inline-flex items-center gap-2 py-1.5">
          <span className="relative flex h-2 w-2">
            <span className="absolute inline-flex h-full w-full animate-ping rounded-full bg-emerald-400 opacity-75" />
            <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-400" />
          </span>
          <p
            key={messageIndex}
            className="animate-word-swap font-display text-base font-medium text-emerald-200"
          >
            {LOADING_MESSAGES[messageIndex]}
          </p>
        </div>
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
