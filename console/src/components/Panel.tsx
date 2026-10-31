import { useId, useState } from 'react'
import type { ReactNode } from 'react'
import { cn } from '../lib/cn'

interface PanelProps {
  title: string
  help?: string
  right?: ReactNode
  children: ReactNode
  className?: string
  bodyClassName?: string
  tour?: string
  id?: string
}

export function Panel({ title, help, right, children, className, bodyClassName, tour, id }: PanelProps) {
  const [open, setOpen] = useState(false)
  const helpId = useId()

  return (
    <section id={id} data-tour={tour} className={cn('panel flex min-w-0 flex-col', className)}>
      <header
        className="flex min-h-[46px] flex-wrap items-center gap-x-2 gap-y-1 border-b px-4 py-2.5"
        style={{ borderColor: 'var(--hair)' }}
      >
        <h2 className="font-display text-[0.84375rem] font-semibold text-ink">{title}</h2>
        {help ? (
          <button
            type="button"
            className="help-square"
            aria-expanded={open}
            aria-controls={helpId}
            aria-label={`Explain ${title}`}
            title="Explain this panel"
            onClick={() => setOpen((value) => !value)}
          >
            ?
          </button>
        ) : null}
        {right ? <div className="ml-auto flex flex-wrap items-center justify-end gap-1.5">{right}</div> : null}
      </header>
      {open && help ? (
        <p
          id={helpId}
          className="mx-4 mb-3 mt-3 rounded-xl px-3 py-2 text-[0.75rem] leading-relaxed text-muted"
          style={{ background: 'var(--panel2)' }}
        >
          {help}
        </p>
      ) : null}
      <div className={cn('min-w-0 flex-1', bodyClassName)}>{children}</div>
    </section>
  )
}
