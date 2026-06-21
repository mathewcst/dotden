import type { ReactNode } from 'react'
import { cn } from '@/shared/lib/utils'

const toneClass = {
  incoming: 'bg-dd-blue-950 text-dd-blue-100',
  offline: 'bg-muted text-muted-foreground',
  error: 'bg-dd-red-950 text-dd-red-100',
} as const

/** Shared persistent banner shell for global sync state strips. */
export function Banner({
  tone,
  children,
  className,
  role = tone === 'error' ? 'alert' : 'status',
}: {
  tone: keyof typeof toneClass
  children: ReactNode
  className?: string
  role?: 'alert' | 'status'
}) {
  return (
    <div className={cn('flex items-center gap-2 px-4 py-2 text-sm', toneClass[tone], className)} role={role}>
      {children}
    </div>
  )
}
