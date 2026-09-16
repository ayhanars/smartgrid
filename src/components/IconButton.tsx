import type { ButtonHTMLAttributes, ReactNode } from 'react'
import './IconButton.css'

interface IconButtonProps extends ButtonHTMLAttributes<HTMLButtonElement> {
  active?: boolean
  size?: 'sm' | 'md'
  children: ReactNode
}

export function IconButton({ active, size = 'md', className, children, ...rest }: IconButtonProps) {
  const classes = ['icon-button', `icon-button--${size}`, active ? 'icon-button--active' : '', className]
    .filter(Boolean)
    .join(' ')
  return (
    <button type="button" className={classes} {...rest}>
      {children}
    </button>
  )
}
