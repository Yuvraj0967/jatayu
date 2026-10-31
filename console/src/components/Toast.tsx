import { createContext, useCallback, useContext, useRef, useState } from 'react'
import type { ReactNode } from 'react'
import { TONE_VAR, type Tone } from '../lib/rf'
import { IconX } from './Icons'

interface ToastInput {
  tone: Tone
  title: string
  message?: string
}

interface ToastItem extends ToastInput {
  id: number
}

const ToastContext = createContext<((toast: ToastInput) => void) | null>(null)

export function ToastProvider({ children }: { children: ReactNode }) {
  const [items, setItems] = useState<ToastItem[]>([])
  const counter = useRef(0)

  const push = useCallback((toast: ToastInput) => {
    counter.current += 1
    const id = counter.current
    setItems((previous) => [...previous.slice(-2), { ...toast, id }])
    window.setTimeout(() => {
      setItems((previous) => previous.filter((item) => item.id !== id))
    }, 6000)
  }, [])

  return (
    <ToastContext.Provider value={push}>
      {children}
      <div
        className="pointer-events-none fixed bottom-4 right-4 z-[80] flex w-[min(92vw,360px)] flex-col gap-2"
        aria-live="polite"
        aria-atomic="false"
      >
        {items.map((item) => (
          <div
            key={item.id}
            role="status"
            className="pointer-events-auto rounded-2xl border px-3.5 py-3"
            style={{
              background: 'var(--panel)',
              borderColor: 'var(--hair)',
              borderLeft: `4px solid ${TONE_VAR[item.tone]}`,
              boxShadow: 'var(--shadow-lg)',
            }}
          >
            <div className="flex items-start gap-2">
              <div className="min-w-0">
                <p className="text-[0.8125rem] font-semibold leading-snug">{item.title}</p>
                {item.message ? <p className="mt-0.5 text-[0.71875rem] leading-relaxed text-muted">{item.message}</p> : null}
              </div>
              <button
                type="button"
                className="btn btn-quiet btn-sm ml-auto !h-7 !w-7 !px-0"
                aria-label="Dismiss notification"
                onClick={() => setItems((previous) => previous.filter((entry) => entry.id !== item.id))}
              >
                <IconX size={12} />
              </button>
            </div>
          </div>
        ))}
      </div>
    </ToastContext.Provider>
  )
}

export function useToast() {
  const context = useContext(ToastContext)
  if (!context) throw new Error('useToast must be used inside ToastProvider')
  return context
}
