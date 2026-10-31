import { useEffect, useId, useRef } from 'react'
import type { ReactNode } from 'react'
import { cn } from '../lib/cn'
import { IconX } from './Icons'

interface DialogProps {
  open: boolean
  onClose: () => void
  title: string
  subtitle?: string
  children: ReactNode
  footer?: ReactNode
  width?: number
}

export function Dialog({ open, onClose, title, subtitle, children, footer, width = 540 }: DialogProps) {
  const ref = useRef<HTMLDialogElement | null>(null)
  const titleId = useId()

  useEffect(() => {
    const element = ref.current
    if (!element) return
    if (open && !element.open) element.showModal()
    if (!open && element.open) element.close()
  }, [open])

  useEffect(() => {
    const element = ref.current
    if (!element) return
    const onCancel = (event: Event) => {
      event.preventDefault()
      onClose()
    }
    const onClick = (event: MouseEvent) => {
      if (event.target === element) onClose()
    }
    element.addEventListener('cancel', onCancel)
    element.addEventListener('click', onClick)
    return () => {
      element.removeEventListener('cancel', onCancel)
      element.removeEventListener('click', onClick)
    }
  }, [onClose])

  return (
    <dialog
      ref={ref}
      aria-labelledby={titleId}
      className="m-auto w-[calc(100vw-32px)] border p-0 text-ink"
      style={{
        maxWidth: width,
        background: 'var(--panel)',
        borderColor: 'var(--hair)',
        borderRadius: 20,
        boxShadow: 'var(--shadow-lg)',
      }}
    >
      <div className="flex max-h-[85vh] flex-col">
        <header
          className="flex items-start gap-3 border-b px-5 py-4"
          style={{ borderColor: 'var(--hair)' }}
        >
          <div className="min-w-0">
            <h2 id={titleId} className="font-display text-[1rem] font-semibold">
              {title}
            </h2>
            {subtitle ? <p className="mt-1 text-[0.75rem] leading-relaxed text-muted">{subtitle}</p> : null}
          </div>
          <button type="button" className="btn btn-quiet btn-sm ml-auto !h-8 !w-8 !px-0" onClick={onClose} aria-label="Close dialog">
            <IconX size={14} />
          </button>
        </header>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {footer ? (
          <footer
            className="flex flex-wrap items-center justify-end gap-2 border-t px-5 py-3.5"
            style={{ borderColor: 'var(--hair)' }}
          >
            {footer}
          </footer>
        ) : null}
      </div>
    </dialog>
  )
}

interface TooltipProps {
  label: string
  children: ReactNode
  className?: string
}

export function Tooltip({ label, children, className }: TooltipProps) {
  const id = useId()
  return (
    <span className={cn('group relative inline-flex', className)} tabIndex={0} aria-describedby={id}>
      {children}
      <span
        id={id}
        role="tooltip"
        className="pointer-events-none absolute bottom-full left-1/2 z-50 mb-1.5 hidden w-max max-w-[240px] -translate-x-1/2 px-2.5 py-1.5 text-[0.6875rem] font-medium leading-snug group-hover:block group-focus-visible:block"
        style={{
          background: 'var(--ink)',
          color: 'var(--panel)',
          borderRadius: 10,
          boxShadow: 'var(--shadow)',
        }}
      >
        {label}
      </span>
    </span>
  )
}
