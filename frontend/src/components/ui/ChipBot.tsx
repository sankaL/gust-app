// Pins listed clockwise from the top-left so the working pulse travels around the chip.
const PIN_OFFSETS = [21.5, 28.5, 35.5, 42.5]
const PINS = [
  ...PIN_OFFSETS.map((p) => [p, 7, p, 14]),
  ...PIN_OFFSETS.map((p) => [50, p, 57, p]),
  ...[...PIN_OFFSETS].reverse().map((p) => [p, 50, p, 57]),
  ...[...PIN_OFFSETS].reverse().map((p) => [7, p, 14, p]),
]
const DOTS = [27.5, 32, 36.5]

/**
 * Gust's bot: a microchip with a screen face, tinted from the theme primary so it blends in.
 * `tone="primary"` is for the capture orb (primary background); `surface` is for light/dark surfaces.
 * `working` pulses the pins, looks around and bounces thinking dots; otherwise it smiles and blinks.
 */
export function ChipBot({ working = false, tone = 'surface', className = '' }: { working?: boolean; tone?: 'primary' | 'surface'; className?: string }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 64 64"
      fill="none"
      strokeLinecap="round"
      className={`chip-bot chip-bot--on-${tone} ${working ? 'chip-bot--working' : ''} ${className}`}
    >
      {PINS.map(([x1, y1, x2, y2], index) => (
        <line key={index} className="chip-bot__pin" x1={x1} y1={y1} x2={x2} y2={y2} strokeWidth={3} style={{ ['--i' as string]: index }} />
      ))}
      <rect className="chip-bot__body" x={14} y={14} width={36} height={36} rx={7} strokeWidth={2} />
      <rect className="chip-bot__screen" x={20} y={20} width={24} height={24} rx={5} />
      <g className="chip-bot__eyes">
        <g className="chip-bot__blink">
          <rect className="chip-bot__eye" x={24.5} y={26} width={4.5} height={6.5} rx={2.2} />
          <rect className="chip-bot__eye" x={35} y={26} width={4.5} height={6.5} rx={2.2} />
        </g>
      </g>
      {working ? (
        <g className="chip-bot__dots">
          {DOTS.map((cx, index) => <circle key={cx} className="chip-bot__eye" cx={cx} cy={39} r={1.6} style={{ ['--i' as string]: index }} />)}
        </g>
      ) : (
        <path className="chip-bot__smile" d="M28.5 37.5q3.5 3 7 0" strokeWidth={2} />
      )}
    </svg>
  )
}
