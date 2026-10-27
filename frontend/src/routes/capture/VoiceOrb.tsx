import { useEffect, useRef } from 'react'
import { Mic, Sparkles } from 'lucide-react'

type OrbState = 'idle' | 'starting' | 'recording' | 'processing'

type AudioContextConstructor = typeof AudioContext
type WindowWithWebkitAudio = Window & { webkitAudioContext?: AudioContextConstructor }

/**
 * Streams a smoothed 0..1 microphone level into a CSS custom property on `targetRef`
 * so the orb reacts to the voice without re-rendering React every animation frame.
 */
function useAudioLevel(stream: MediaStream | null, targetRef: React.RefObject<HTMLElement | null>) {
  useEffect(() => {
    const target = targetRef.current
    if (!stream || !target) return undefined
    const AudioContextClass = window.AudioContext ?? (window as WindowWithWebkitAudio).webkitAudioContext
    if (!AudioContextClass) return undefined

    let context: AudioContext
    let source: MediaStreamAudioSourceNode
    try {
      context = new AudioContextClass()
      source = context.createMediaStreamSource(stream)
    } catch {
      return undefined
    }
    const analyser = context.createAnalyser()
    analyser.fftSize = 512
    source.connect(analyser)
    const samples = new Uint8Array(analyser.fftSize)
    let level = 0
    let frame = 0

    const tick = () => {
      analyser.getByteTimeDomainData(samples)
      let sum = 0
      for (const sample of samples) {
        const centered = (sample - 128) / 128
        sum += centered * centered
      }
      const rms = Math.sqrt(sum / samples.length)
      const next = Math.min(1, rms * 4.5)
      level = next > level ? level * 0.45 + next * 0.55 : level * 0.88 + next * 0.12
      target.style.setProperty('--level', level.toFixed(3))
      frame = requestAnimationFrame(tick)
    }
    tick()

    return () => {
      cancelAnimationFrame(frame)
      target.style.setProperty('--level', '0')
      source.disconnect()
      void context.close().catch(() => undefined)
    }
  }, [stream, targetRef])
}

function StopGlyph() {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" className="h-11 w-11" fill="currentColor">
      <rect x="6" y="6" width="12" height="12" rx="3.5" />
    </svg>
  )
}

export function VoiceOrb({ state, stream, disabled, onClick, label }: {
  state: OrbState
  stream: MediaStream | null
  disabled?: boolean
  onClick?: () => void
  label: string
}) {
  const levelRef = useRef<HTMLDivElement>(null)
  useAudioLevel(state === 'recording' ? stream : null, levelRef)
  const recording = state === 'recording'
  const processing = state === 'processing'

  const coreTone = recording
    ? 'from-tertiary/75 via-tertiary to-error-dim text-white'
    : 'from-primary via-primary to-primary-dim text-on-primary'

  return (
    <div ref={levelRef} className="relative mx-auto flex h-[15rem] w-[15rem] items-center justify-center" style={{ ['--level' as string]: 0 }}>
      {/* soft aura */}
      <span
        aria-hidden="true"
        className={`absolute inset-6 rounded-full blur-2xl transition-colors duration-500 ${recording ? 'bg-tertiary/35' : 'bg-primary/30'} ${state === 'idle' ? 'animate-glow-breathe' : ''}`}
        style={recording ? { transform: 'scale(calc(1 + var(--level) * 0.55))' } : undefined}
      />
      {/* voice-reactive rings */}
      {recording ? (
        <>
          <span aria-hidden="true" className="absolute h-[9.5rem] w-[9.5rem] rounded-full border-2 border-tertiary/40 animate-ring-pulse" />
          <span aria-hidden="true" className="absolute h-[9.5rem] w-[9.5rem] rounded-full border-2 border-tertiary/30 animate-ring-pulse [animation-delay:0.9s]" />
          <span
            aria-hidden="true"
            className="absolute h-[9.5rem] w-[9.5rem] rounded-full bg-tertiary/15 transition-transform duration-75"
            style={{ transform: 'scale(calc(1.05 + var(--level) * 0.5))' }}
          />
        </>
      ) : null}
      {processing ? (
        <span aria-hidden="true" className="absolute h-[11rem] w-[11rem] animate-spin-slow rounded-full p-[3px] [background:conic-gradient(from_0deg,transparent_0%,rgb(var(--color-primary))_35%,transparent_70%)] [mask:radial-gradient(farthest-side,transparent_calc(100%-3px),#000_calc(100%-3px))]" />
      ) : null}
      {state === 'idle' ? <span aria-hidden="true" className="absolute h-[11rem] w-[11rem] rounded-full border border-primary/20" /> : null}
      <button
        type="button"
        onClick={onClick}
        disabled={disabled}
        aria-label={label}
        className={`group relative z-10 flex h-[9.5rem] w-[9.5rem] items-center justify-center rounded-full bg-gradient-to-br shadow-[0_24px_50px_-18px_rgb(var(--color-primary-dim)),inset_0_2px_3px_rgba(255,255,255,0.35),inset_0_-6px_14px_rgba(0,0,0,0.18)] outline-none transition-all duration-500 ease-out-expo focus-visible:ring-4 focus-visible:ring-primary/40 enabled:hover:scale-[1.03] enabled:active:scale-95 disabled:cursor-default ${coreTone} ${state === 'idle' ? 'animate-orb-breathe' : ''}`}
      >
        <span aria-hidden="true" className="absolute inset-0 rounded-full bg-[radial-gradient(circle_at_35%_25%,rgba(255,255,255,0.45),transparent_55%)]" />
        <span className="relative transition-transform duration-300 ease-spring">
          {recording ? <StopGlyph /> : processing ? <Sparkles aria-hidden="true" className="h-11 w-11 animate-pulse" strokeWidth={1.8} /> : <Mic aria-hidden="true" className={`h-12 w-12 ${state === 'starting' ? 'animate-pulse' : ''}`} strokeWidth={1.9} />}
        </span>
      </button>
    </div>
  )
}

/** Small equalizer used beside the recording timer. */
export function LiveBars() {
  return (
    <span aria-hidden="true" className="inline-flex h-4 items-center gap-[3px]">
      {[0, 1, 2, 3, 4].map((bar) => (
        <span key={bar} className="animate-bar-dance h-full w-[3px] rounded-full bg-tertiary" style={{ animationDelay: `${bar * 0.12}s` }} />
      ))}
    </span>
  )
}
