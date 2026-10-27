import type { Config } from 'tailwindcss'

const token = (name: string) => `rgb(var(--color-${name}) / <alpha-value>)`

const config: Config = {
  content: ['./index.html', './src/**/*.{ts,tsx}'],
  darkMode: ['selector', '[data-theme="dark"]'],
  theme: {
    extend: {
      colors: {
        surface: token('surface'),
        'surface-dim': token('surface-dim'),
        'surface-container': token('surface-container'),
        'surface-container-high': token('surface-container-high'),
        'surface-container-highest': token('surface-container-highest'),
        'surface-bright': token('surface-bright'),
        'surface-variant': token('surface-variant'),
        primary: token('primary'),
        'primary-dim': token('primary-dim'),
        'on-primary': token('on-primary'),
        secondary: token('secondary'),
        'secondary-dim': token('secondary-dim'),
        tertiary: token('tertiary'),
        'on-tertiary': token('on-tertiary'),
        success: token('success'),
        'success-dim': token('success-dim'),
        warning: token('warning'),
        'warning-dim': token('warning-dim'),
        error: token('error'),
        'error-dim': token('error-dim'),
        info: token('info'),
        'info-dim': token('info-dim'),
        'on-surface': token('on-surface'),
        'on-surface-variant': token('on-surface-variant'),
        outline: token('outline'),
        'card-active': token('card-active'),
        'card-active-line': token('card-active-line'),
        nav: token('nav'),
        backdrop: token('backdrop'),
        chip: {
          neutral: token('chip-neutral'),
          'neutral-ink': token('chip-neutral-ink'),
          blue: token('chip-blue'),
          'blue-ink': token('chip-blue-ink'),
          violet: token('chip-violet'),
          'violet-ink': token('chip-violet-ink'),
          amber: token('chip-amber'),
          'amber-ink': token('chip-amber-ink'),
          green: token('chip-green'),
          'green-ink': token('chip-green-ink'),
          rose: token('chip-rose'),
          'rose-ink': token('chip-rose-ink')
        }
      },
      fontFamily: {
        display: ['Manrope', 'sans-serif'],
        body: ['Inter', 'sans-serif']
      },
      borderRadius: {
        card: '1rem',
        soft: '1.5rem',
        pill: '9999px',
        sheet: '2.25rem'
      },
      boxShadow: {
        ambient: 'var(--shadow-ambient)',
        card: 'var(--shadow-card)',
        float: 'var(--shadow-float)',
        sheet: 'var(--shadow-sheet)'
      },
      transitionTimingFunction: {
        'out-expo': 'cubic-bezier(0.16, 1, 0.3, 1)',
        sheet: 'cubic-bezier(0.32, 0.72, 0, 1)',
        spring: 'cubic-bezier(0.34, 1.56, 0.64, 1)'
      },
      spacing: {
        4: '1.4rem',
        8: '2.75rem',
        16: '5.5rem'
      }
    }
  },
  plugins: []
}

export default config
