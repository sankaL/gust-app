export type WaveBackdropMode = 'idle' | 'recording' | 'extracting'

interface AtmosphericWaveBackdropProps {
  mode?: WaveBackdropMode
}

// Generate wide, elegant, sinusoidal wave ribbons with period 600
function generateWavePath(type: 'upper' | 'lower' | 'dashed') {
  let d = 'M -1800 100'
  const amp = type === 'upper' ? 34 : type === 'lower' ? 40 : 22
  for (let x = -1800; x < 2400; x += 600) {
    if (type === 'upper') {
      d += ` C ${x + 90} ${100 - amp}, ${x + 210} ${100 - amp}, ${x + 300} 100 C ${x + 390} ${100 + amp}, ${x + 510} ${100 + amp}, ${x + 600} 100`
    } else if (type === 'lower') {
      d += ` C ${x + 90} ${100 + amp}, ${x + 210} ${100 + amp}, ${x + 300} 100 C ${x + 390} ${100 - amp}, ${x + 510} ${100 - amp}, ${x + 600} 100`
    } else {
      d += ` C ${x + 75} ${100 - amp}, ${x + 225} ${100 - amp}, ${x + 300} 100 C ${x + 375} ${100 + amp}, ${x + 525} ${100 + amp}, ${x + 600} 100`
    }
  }
  return d
}

const WAVE_1_PATH = generateWavePath('upper')
const WAVE_2_PATH = generateWavePath('lower')
const WAVE_3_PATH = generateWavePath('dashed')

export function AtmosphericWaveBackdrop({ mode = 'idle' }: AtmosphericWaveBackdropProps) {
  // Gradients, glow, and animation speeds according to state
  const config = {
    idle: {
      glow: 'bg-[radial-gradient(circle,_rgba(168,85,247,0.35)_0%,_rgba(139,92,246,0.12)_45%,_transparent_70%)]',
      grad1: {
        mid1: '#c084fc',
        mid2: '#e9d5ff',
        mid3: '#a855f7',
      },
      grad2: {
        mid1: '#a855f7',
        mid2: '#ba9eff',
        mid3: '#9333ea',
      },
      wave1Dur: '9s',
      wave2Dur: '12s',
      wave3Dur: '15s',
      containerAnim: 'animate-wave-undulate',
      opacity: 'opacity-55',
    },
    recording: {
      glow: 'bg-[radial-gradient(circle,_rgba(244,63,94,0.45)_0%,_rgba(225,29,72,0.2)_45%,_transparent_70%)]',
      grad1: {
        mid1: '#fb7185',
        mid2: '#ffe4e6',
        mid3: '#f43f5e',
      },
      grad2: {
        mid1: '#f43f5e',
        mid2: '#fda4af',
        mid3: '#e11d48',
      },
      wave1Dur: '4s',
      wave2Dur: '5.5s',
      wave3Dur: '6.5s',
      containerAnim: 'animate-wave-undulate-active',
      opacity: 'opacity-75',
    },
    extracting: {
      glow: 'bg-[radial-gradient(circle,_rgba(16,185,129,0.42)_0%,_rgba(5,150,105,0.18)_45%,_transparent_70%)]',
      grad1: {
        mid1: '#34d399',
        mid2: '#d1fae5',
        mid3: '#10b981',
      },
      grad2: {
        mid1: '#10b981',
        mid2: '#6ee7b7',
        mid3: '#059669',
      },
      wave1Dur: '6s',
      wave2Dur: '8s',
      wave3Dur: '10s',
      containerAnim: 'animate-wave-undulate',
      opacity: 'opacity-70',
    },
  }[mode]

  const grad1Id = `wave-grad-1-${mode}`
  const grad2Id = `wave-grad-2-${mode}`

  return (
    <div className="pointer-events-none absolute inset-0 flex items-center justify-center overflow-visible">
      {/* Ambient center glow */}
      <div
        className={`absolute h-72 w-72 rounded-full ${config.glow} blur-2xl transition-all duration-500 animate-glow-breathe`}
      />

      {/* Full-width edge-to-edge soundwave ribbons centered vertically and horizontally */}
      <div
        className={`relative flex h-48 w-screen min-w-[100vw] items-center justify-center overflow-visible transition-opacity duration-500 transform-gpu ${config.opacity} ${config.containerAnim}`}
      >
        <svg
          className="h-full w-full overflow-visible transform-gpu"
          viewBox="-600 0 1200 200"
          fill="none"
          xmlns="http://www.w3.org/2000/svg"
          preserveAspectRatio="none"
        >
          <defs>
            <linearGradient id={grad1Id} gradientUnits="userSpaceOnUse" x1="-600" y1="0" x2="600" y2="0">
              <stop offset="0%" stopColor={config.grad1.mid1} stopOpacity="0.7" />
              <stop offset="25%" stopColor={config.grad1.mid1} stopOpacity="0.85" />
              <stop offset="50%" stopColor={config.grad1.mid2} stopOpacity="1" />
              <stop offset="75%" stopColor={config.grad1.mid3} stopOpacity="0.85" />
              <stop offset="100%" stopColor={config.grad1.mid3} stopOpacity="0.7" />
            </linearGradient>
            <linearGradient id={grad2Id} gradientUnits="userSpaceOnUse" x1="-600" y1="0" x2="600" y2="0">
              <stop offset="0%" stopColor={config.grad2.mid1} stopOpacity="0.6" />
              <stop offset="30%" stopColor={config.grad2.mid1} stopOpacity="0.8" />
              <stop offset="50%" stopColor={config.grad2.mid2} stopOpacity="0.95" />
              <stop offset="70%" stopColor={config.grad2.mid3} stopOpacity="0.8" />
              <stop offset="100%" stopColor={config.grad2.mid3} stopOpacity="0.6" />
            </linearGradient>
          </defs>

          {/* Primary upper wave (traveling left) */}
          <g className="will-change-transform">
            <animateTransform
              attributeName="transform"
              type="translate"
              from="0 0"
              to="-600 0"
              dur={config.wave1Dur}
              repeatCount="indefinite"
            />
            <path
              d={WAVE_1_PATH}
              stroke={`url(#${grad1Id})`}
              strokeWidth={mode === 'recording' ? '1.8' : '1.3'}
              strokeLinecap="round"
            />
          </g>

          {/* Secondary counter-flowing harmonic wave (traveling right) */}
          <g className="will-change-transform">
            <animateTransform
              attributeName="transform"
              type="translate"
              from="0 0"
              to="600 0"
              dur={config.wave2Dur}
              repeatCount="indefinite"
            />
            <path
              d={WAVE_2_PATH}
              stroke={`url(#${grad2Id})`}
              strokeWidth={mode === 'recording' ? '1.5' : '1.1'}
              strokeLinecap="round"
            />
          </g>

          {/* Tertiary rhythmic dashed wave */}
          <g className="will-change-transform">
            <animateTransform
              attributeName="transform"
              type="translate"
              from="0 0"
              to="-600 0"
              dur={config.wave3Dur}
              repeatCount="indefinite"
            />
            <path
              d={WAVE_3_PATH}
              stroke={`url(#${grad1Id})`}
              strokeWidth="0.85"
              strokeDasharray="5 6"
            />
          </g>
        </svg>
      </div>
    </div>
  )
}
