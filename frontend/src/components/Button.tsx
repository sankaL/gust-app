import { ButtonHTMLAttributes, forwardRef } from 'react'

export interface ButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'tertiary' | 'ghost' | 'mic'
  size?: 'sm' | 'md' | 'lg'
  fullWidth?: boolean
}

export const Button = forwardRef<HTMLButtonElement, ButtonProps>(
  ({ className = '', variant = 'secondary', size = 'md', fullWidth = false, children, ...props }, ref) => {
    const baseClasses = 'inline-flex items-center justify-center font-medium transition-all duration-200 disabled:opacity-50 disabled:cursor-not-allowed active:scale-95'
    
    const sizeClasses = {
      sm: 'px-3 py-1.5 text-xs rounded-pill',
      md: 'px-4 py-2 text-sm rounded-pill font-display tracking-wide',
      lg: 'px-5 py-3 text-base rounded-pill font-display tracking-wide'
    }

    const variantClasses = {
      primary: 'bg-[radial-gradient(circle_at_top,_rgba(186,158,255,0.92),_rgba(132,85,239,0.82))] text-surface shadow-[0_0_40px_rgba(186,158,255,0.4)] hover:shadow-[0_0_60px_rgba(186,158,255,0.6)]',
      secondary: 'bg-surface-container-high text-on-surface hover:bg-surface-container-highest hover:shadow-ambient border border-outline/20',
      tertiary: 'bg-tertiary/10 text-tertiary hover:bg-tertiary/20 hover:shadow-ambient',
      ghost: 'bg-transparent text-on-surface-variant hover:text-on-surface hover:bg-surface-variant/30',
      mic: 'flex h-48 w-48 items-center justify-center rounded-pill border border-white/10 bg-[radial-gradient(circle_at_top,_rgba(186,158,255,0.92),_rgba(132,85,239,0.82))] text-surface shadow-[0_0_40px_rgba(186,158,255,0.4)] hover:shadow-[0_0_60px_rgba(186,158,255,0.6)] font-display text-xl transition-all duration-300'
    }
    
    const widthClass = fullWidth ? 'w-full' : ''

    const buttonClasses = [
      baseClasses,
      variant !== 'mic' ? sizeClasses[size] : '', // mic uses defined h-48 w-48
      variantClasses[variant],
      widthClass,
      className
    ].filter(Boolean).join(' ')

    return (
      <button ref={ref} className={buttonClasses} {...props}>
        {children}
      </button>
    )
  }
)

Button.displayName = 'Button'
