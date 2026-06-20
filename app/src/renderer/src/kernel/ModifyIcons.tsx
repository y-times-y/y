import * as React from 'react'

export function ModifyMark({ size = 18 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M12.5 3.5l4 4L8 16H4v-4l8.5-8.5z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
      <path d="M11 5l4 4" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

export function ModifySendIcon({ size = 16 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M4 10l12-6-2.5 12-3-4.5-4.5-1.5L16 4 4 10z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function ModifyStopIcon({ size = 16 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden>
      <rect x="6" y="6" width="8" height="8" rx="1.2" fill="currentColor" />
    </svg>
  )
}

export function ModifyToolIcon({ size = 14 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden>
      <path
        d="M4 14l2-2 8-8 2 2-8 8-2 2H4v-2z"
        stroke="currentColor"
        strokeWidth="1.5"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function ModifyCopyIcon({ size = 16 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden>
      <rect x="6.5" y="6.5" width="9" height="9" rx="1.5" stroke="currentColor" strokeWidth="1.5" />
      <path d="M13.5 6.5V5A1.5 1.5 0 0012 3.5H5A1.5 1.5 0 003.5 5v7A1.5 1.5 0 005 13.5h1.5" stroke="currentColor" strokeWidth="1.5" />
    </svg>
  )
}

export function ModifyMenuIcon({ size = 16 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden>
      <circle cx="5" cy="10" r="1.3" fill="currentColor" />
      <circle cx="10" cy="10" r="1.3" fill="currentColor" />
      <circle cx="15" cy="10" r="1.3" fill="currentColor" />
    </svg>
  )
}

export function ModifyResetIcon({ size = 16 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M8 5L4 9l4 4M4.5 9H12a4 4 0 014 4v2" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function ModifyBrainIcon({ size = 15 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M8 5.5a3 3 0 00-3 3v3A3.5 3.5 0 008.5 15H9V5.5H8zM12 5.5a3 3 0 013 3v3a3.5 3.5 0 01-3.5 3.5H11V5.5h1z" stroke="currentColor" strokeWidth="1.35" strokeLinejoin="round" />
      <path d="M6 9h3M11 9h3M6.5 12H9M11 12h2.5" stroke="currentColor" strokeWidth="1.2" strokeLinecap="round" />
    </svg>
  )
}

export function ModifyChevronIcon({ size = 12 }: { size?: number }): React.JSX.Element {
  return (
    <svg width={size} height={size} viewBox="0 0 20 20" fill="none" aria-hidden>
      <path d="M6 8l4 4 4-4" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
