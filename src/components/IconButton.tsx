import type { ButtonHTMLAttributes, ReactNode } from 'react'
import './IconButton.css'

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
  size?: 'sm' | 'md'
  /** Label shown in the hover tooltip — defaults to aria-label so most
   * buttons get one for free without repeating the text. Pass `tooltip={false}`
   * to opt a button out entirely. */
  tooltip?: string | false
  /** Optional keyboard shortcut shown next to the tooltip label, e.g. "H" or "⇧1". */
  shortcut?: string
  children: ReactNode
}

export function IconButton({ active, size = 'md', tooltip, shortcut, className, children, ...rest }: IconButtonProps) {
  const classes = ['icon-button', `icon-button--${size}`, active ? 'icon-button--active' : '', className]
    .filter(Boolean)
    .join(' ')
  const label = tooltip === false ? null : (tooltip ?? (rest['aria-label'] as string | undefined))
  return (
    <button type="button" className={classes} {...rest}>
      {children}
      {label && (
        <span className="icon-button__tooltip" role="tooltip">
          {label}
          {shortcut && <span className="icon-button__tooltip-shortcut">{shortcut}</span>}
        </span>
      )}
    </button>
  )
}
