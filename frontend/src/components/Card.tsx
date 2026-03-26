import { ReactNode } from 'react'

interface CardProps {
  children: ReactNode
  className?: string
  onClick?: (e: React.MouseEvent<HTMLDivElement>) => void
  interactive?: boolean
  variant?: 'elevated' | 'highest' | 'dim' | 'ghost'
  padding?: 'none' | 'small' | 'normal' | 'large'
}

export function Card({ 
  children, 
  className = '', 
  onClick, 
  interactive, 
  variant = 'elevated',
  padding = 'normal'
}: CardProps) {
  const baseClasses = 'rounded-card transition-all duration-300'
  
  const variantClasses = {
    elevated: 'bg-surface-container',
    highest: 'bg-surface-container-highest shadow-ambient',
    dim: 'bg-surface-dim',
    ghost: 'bg-transparent border border-outline/15'
  }

  const paddingClasses = {
    none: '',
    small: 'p-3',
    normal: 'p-4',
    large: 'p-6'
  }

  const isInteractive = interactive || onClick !== undefined
  const interactiveClasses = isInteractive 
    ? 'cursor-pointer active:scale-[0.98] active:bg-surface-bright' 
    : ''
    
  // If variant equals elevated, hovering makes it pop
  const hoverClasses = isInteractive && variant === 'elevated'
    ? 'hover:bg-surface-container-highest hover:shadow-ambient'
    : ''

  return (
    <div 
      className={[baseClasses, variantClasses[variant], paddingClasses[padding], interactiveClasses, hoverClasses, className].filter(Boolean).join(' ')}
      onClick={onClick}
      role={isInteractive ? 'button' : undefined}
      tabIndex={isInteractive ? 0 : undefined}
    >
      {children}
    </div>
  )
}
