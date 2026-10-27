export type ChipTone = 'neutral' | 'blue' | 'violet' | 'amber' | 'green' | 'rose'

const CHIP_TONES: Record<ChipTone, string> = {
  neutral: 'bg-chip-neutral text-chip-neutral-ink',
  blue: 'bg-chip-blue text-chip-blue-ink',
  violet: 'bg-chip-violet text-chip-violet-ink',
  amber: 'bg-chip-amber text-chip-amber-ink',
  green: 'bg-chip-green text-chip-green-ink',
  rose: 'bg-chip-rose text-chip-rose-ink',
}

export function chipClass(tone: ChipTone = 'neutral', className = '') {
  return `inline-flex h-6 max-w-full shrink-0 items-center gap-1 rounded-pill px-2.5 font-body text-[0.7rem] font-semibold leading-none ${CHIP_TONES[tone]} ${className}`
}

const GROUP_TONES: ChipTone[] = ['blue', 'violet', 'amber', 'green', 'rose']

/** Stable, name-derived tone so a group keeps its color across screens. */
export function groupTone(name: string | null | undefined): ChipTone {
  if (!name || name.toLowerCase() === 'inbox') return 'neutral'
  let hash = 0
  for (const character of name) hash = (hash * 31 + character.charCodeAt(0)) >>> 0
  return GROUP_TONES[hash % GROUP_TONES.length]
}
