/**
 * A drawn stand-in for a generator's picture until an admin uploads
 * one: a small scene per product family, in the accent colours.
 */
export function GeneratorArt({ template }: { template: string }) {
  const kind = template.startsWith('drawer-tray') ? 'tray' : template.startsWith('drawer-divider') ? 'divider' : template.endsWith('hook') ? 'hook' : 'bin'
  return (
    <svg viewBox="0 0 160 120" className={`generator-art generator-art--${kind}`} aria-hidden="true">
      <defs>
        <linearGradient id={`ga-${kind}`} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0" stopColor="currentColor" stopOpacity="0.35" />
          <stop offset="1" stopColor="currentColor" stopOpacity="0.1" />
        </linearGradient>
      </defs>
      {kind === 'bin' && (
        <g>
          <g className="generator-art__board">
            {Array.from({ length: 5 }, (_, r) => Array.from({ length: 8 }, (_, c) => <circle key={`${r}-${c}`} cx={12 + c * 20 + (r % 2) * 10} cy={12 + r * 20} r={2.2} />))}
          </g>
          <path d="M40 46 h80 l-6 52 h-68 z" fill={`url(#ga-${kind})`} stroke="currentColor" strokeWidth="2" strokeLinejoin="round" />
          <path d="M40 46 l8 -10 h80 l-8 10 z" fill="currentColor" opacity="0.5" />
          <path d="M120 46 l8 -10 l-6 52 l-8 10 z" fill="currentColor" opacity="0.3" />
          <path d="M58 36 v-8 M82 36 v-8 M106 36 v-8" stroke="currentColor" strokeWidth="4" strokeLinecap="round" />
        </g>
      )}
      {kind === 'hook' && (
        <g>
          <g className="generator-art__board">
            {Array.from({ length: 5 }, (_, r) => Array.from({ length: 8 }, (_, c) => <circle key={`${r}-${c}`} cx={12 + c * 20 + (r % 2) * 10} cy={12 + r * 20} r={2.2} />))}
          </g>
          <path d="M64 32 v40 q0 14 14 14 h22 q14 0 14 -14 v-10" fill="none" stroke="currentColor" strokeWidth="9" strokeLinecap="round" strokeLinejoin="round" />
          <rect x="58" y="24" width="12" height="16" rx="3" fill="currentColor" opacity="0.6" />
        </g>
      )}
      {kind === 'tray' && (
        <g>
          <path d="M18 34 h124 v66 h-124 z" fill={`url(#ga-${kind})`} stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
          <path d="M18 34 l14 -12 h124 l-14 12 z" fill="currentColor" opacity="0.4" />
          <path d="M142 34 l14 -12 v66 l-14 12 z" fill="currentColor" opacity="0.25" />
          <path d="M60 34 v66 M100 34 v66 M18 70 h124" stroke="currentColor" strokeWidth="2.5" opacity="0.8" />
        </g>
      )}
      {kind === 'divider' && (
        <g>
          <path d="M20 40 h120 v40 h-120 z" fill={`url(#ga-${kind})`} stroke="currentColor" strokeWidth="3" strokeLinejoin="round" />
          <path d="M56 40 v20 h8 v-20 M96 40 v20 h8 v-20" fill="var(--bg-canvas)" stroke="currentColor" strokeWidth="2.5" />
          <path d="M60 24 v16 M100 24 v16" stroke="currentColor" strokeWidth="6" opacity="0.6" strokeLinecap="round" />
          <path d="M30 88 h100" stroke="currentColor" strokeWidth="2" strokeDasharray="4 4" opacity="0.5" />
        </g>
      )}
    </svg>
  )
}
