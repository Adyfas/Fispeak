interface IconProps {
  className?: string
}

export function GlobeIcon({ className }: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className}>
      <circle cx="12" cy="12" r="9" />
      <path d="M3 12h18M12 3c2.5 2.6 2.5 15.4 0 18M12 3c-2.5 2.6-2.5 15.4 0 18" />
    </svg>
  )
}

export function PlusIcon({ className }: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className}>
      <path d="M12 5v14M5 12h14" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function MinusIcon({ className }: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className}>
      <path d="M5 12h14" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function SettingsIcon({ className }: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className}>
      <circle cx="12" cy="12" r="3" />
      <path d="M19.4 15a1.7 1.7 0 0 0 .3 1.9l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.7 1.7 0 0 0-1.9-.3 1.7 1.7 0 0 0-1 1.6V21a2 2 0 1 1-4 0v-.1a1.7 1.7 0 0 0-1.1-1.6 1.7 1.7 0 0 0-1.9.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.7 1.7 0 0 0 .3-1.9 1.7 1.7 0 0 0-1.6-1H3a2 2 0 1 1 0-4h.1a1.7 1.7 0 0 0 1.6-1.1 1.7 1.7 0 0 0-.3-1.9l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.7 1.7 0 0 0 1.9.3H9a1.7 1.7 0 0 0 1-1.6V3a2 2 0 1 1 4 0v.1a1.7 1.7 0 0 0 1 1.6 1.7 1.7 0 0 0 1.9-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.7 1.7 0 0 0-.3 1.9V9a1.7 1.7 0 0 0 1.6 1H21a2 2 0 1 1 0 4h-.1a1.7 1.7 0 0 0-1.5 1Z" />
    </svg>
  )
}

export function PlayIcon({ className }: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <path d="M8 5.5v13l11-6.5-11-6.5Z" />
    </svg>
  )
}

export function PauseIcon({ className }: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <rect x="6" y="5" width="4" height="14" rx="1" />
      <rect x="14" y="5" width="4" height="14" rx="1" />
    </svg>
  )
}

export function ResetIcon({ className }: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className}>
      <path d="M4 10a8 8 0 1 1 2.3 6.4" />
      <path d="M4 5v5h5" />
    </svg>
  )
}

export function ChecklistIcon({ className }: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className}>
      <path d="M4 7l2 2 3-3M4 16l2 2 3-3" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M12 7h8M12 17h8" strokeLinecap="round" />
    </svg>
  )
}

export function ClockIcon({ className }: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className}>
      <circle cx="12" cy="12" r="8.5" />
      <path d="M12 7.5V12l3 1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}

export function XIcon({ className }: IconProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2.2}
      strokeLinecap="round"
      className={className}
    >
      <path d="M6 6l12 12M18 6L6 18" />
    </svg>
  )
}

/** Prompt page: a pen over a line of text, i.e. "dictate into whatever field has focus". */
export function PromptIcon({ className }: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className}>
      <path d="M4 19.5h9" strokeLinecap="round" />
      <path d="M4 15.5h6" strokeLinecap="round" />
      <path
        d="M13.6 17.8l5.9-5.9a2.1 2.1 0 0 0-3-3l-5.9 5.9-.8 3.8 3.8-.8Z"
        strokeLinejoin="round"
      />
    </svg>
  )
}

export function FocusIcon({ className }: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className}>
      <circle cx="12" cy="13" r="7.5" />
      <path d="M12 9.5V13l2.4 1.5" strokeLinecap="round" strokeLinejoin="round" />
      <path d="M9.5 3h5M18.5 5.5l1.5 1.5" strokeLinecap="round" />
    </svg>
  )
}

export function StopIcon({ className }: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="currentColor" className={className}>
      <rect x="6" y="6" width="12" height="12" rx="2" />
    </svg>
  )
}

export function HistoryIcon({ className }: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className}>
      <path d="M3.5 12a8.5 8.5 0 1 0 2.6-6.1" />
      <path d="M3 4v5h5" />
      <path d="M12 8v4.5l3 1.8" />
    </svg>
  )
}

export function MicIcon({ className }: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className}>
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  )
}

export function SpeakerIcon({ className }: IconProps): JSX.Element {
  return (
    <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth={1.8} className={className}>
      <path d="M4 9v6h4l5 4V5L8 9H4Z" />
      <path d="M17 9.5a4 4 0 0 1 0 5" />
    </svg>
  )
}

export function ChevronLeftIcon({ className }: IconProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="m15 4l-8 8l8 8" />
    </svg>
  )
}

export function ChevronRightIcon({ className }: IconProps): JSX.Element {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth={2}
      strokeLinecap="round"
      strokeLinejoin="round"
      className={className}
    >
      <path d="m8 4l8 8l-8 8" />
    </svg>
  )
}
