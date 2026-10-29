const WAVE_BARS = [
  [3, 9, 6],
  [7.5, 4, 16],
  [12, 7, 10],
  [16.5, 5, 14],
  [21, 9.5, 5],
]

/** Voice bars that bounce out of phase, for the capture orb while a note is transcribed and extracted. */
export function ProcessingWave({ className = '' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="currentColor" className={`processing-wave ${className}`}>
      {WAVE_BARS.map(([x, y, height], index) => (
        <rect key={x} className="processing-wave__bar" x={x - 1} y={y} width={2} height={height} rx={1} style={{ ['--i' as string]: index }} />
      ))}
    </svg>
  )
}

/** A lens scanning list lines, for the banner that points at tasks waiting for review. */
export function ReviewScan({ className = '' }: { className?: string }) {
  return (
    <svg aria-hidden="true" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={2} strokeLinecap="round" strokeLinejoin="round" className={`review-scan ${className}`}>
      <path d="M3 6h9M3 12h7M3 18h5" />
      <g className="review-scan__lens">
        <circle cx={16.5} cy={13.5} r={4} />
        <path d="M19.5 16.5L22 19" />
      </g>
    </svg>
  )
}
