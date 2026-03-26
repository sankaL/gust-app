interface SkeletonProps {
  className?: string
  width?: string
  height?: string
  variant?: 'text' | 'circular' | 'rectangular'
}

export function Skeleton({ className = '', width, height, variant = 'text' }: SkeletonProps) {
  const baseClasses = 'animate-pulse bg-surface-container-highest overflow-hidden relative'
  
  const variantClasses = {
    text: 'rounded-sm',
    circular: 'rounded-full',
    rectangular: 'rounded-card'
  }
  
  // Default sizes if none provided
  const heightStyle = height || (variant === 'text' ? '1rem' : undefined)
  const widthStyle = width || (variant === 'text' ? '100%' : undefined)

  return (
    <div 
      className={[baseClasses, variantClasses[variant], className].filter(Boolean).join(' ')}
      style={{ width: widthStyle, height: heightStyle }}
    >
      <div 
        className="absolute inset-0 -translate-x-full animate-[shimmer_1.5s_infinite] bg-gradient-to-r from-transparent via-white/5 to-transparent" 
      />
    </div>
  )
}
