import { useCallback, useEffect, useRef, useState } from 'react'
import { clamp } from '../lib/format'
import { IconChevronLeft, IconChevronRight, IconX } from './Icons'

type Tab = 'overview' | 'signal-lab'

interface TourStep {
  selector: string
  title: string
  body: string
}

const STEPS: TourStep[] = [
  {
    selector: '[data-tour="next-action"]',
    title: 'Next action',
    body: 'This bar reads the live state and names the single most useful thing to do now. It is announced when the recommendation changes.',
  },
  {
    selector: '[data-tour="checklist"]',
    title: 'Setup checklist',
    body: 'Six checks for a healthy setup: backend, CSI stream, signal quality, Arduino link, gas readiness and monitoring. The hints say what to fix.',
  },
  {
    selector: '[data-tour="monitoring-button"]',
    title: 'Start or stop monitoring',
    body: 'The primary control. Starting monitoring lets notable observations open incidents. Stopping keeps every existing record intact.',
  },
  {
    selector: '[data-tour="readout"]',
    title: 'Readout strip',
    body: 'Six values at a glance. If the strip greys out, the update is stale; check the clock and the age in the top bar before trusting a number.',
  },
  {
    selector: '[data-tour="rf"]',
    title: 'RF observation',
    body: 'The Wi-Fi signal view. A repeating pattern is an observation for human review, never proof of a person. Confidence describes evidence quality, not risk.',
  },
  {
    selector: '[data-tour="gas"]',
    title: 'Environmental sensor',
    body: 'Raw ADC counts from an uncalibrated sensor, with a clean-air baseline and a review threshold. Counts are not ppm and no gas is named.',
  },
  {
    selector: '[data-tour="incidents"]',
    title: 'Incidents',
    body: 'The working record. Read the evidence, acknowledge, then close. Close stays locked until an acknowledgement exists, so the audit shows who reviewed it.',
  },
  {
    selector: '[data-tour="timeline"]',
    title: 'Event timeline',
    body: 'A newest-first audit trail of monitoring, observations, commands and operator actions. Filter it to the selected incident when a case gets busy.',
  },
  {
    selector: '[data-tour="signal-lab-tab"]',
    title: 'Signal lab',
    body: 'A diagnostic page served by the backend: live waveform, spectrum and calibration. Do the 30-second empty-room calibration there before relying on RF observations.',
  },
  {
    selector: '[data-tour="help"]',
    title: 'Help and glossary',
    body: 'Plain-language explanations of every state, quality term and command stage, plus what to do when something looks wrong. Reopen this tour from the toolbar.',
  },
]

interface TourProps {
  open: boolean
  onFinish: () => void
  onTab: (tab: Tab) => void
}

interface Rect {
  top: number
  left: number
  width: number
  height: number
  bottom: number
  right: number
}

export function Tour({ open, onFinish, onTab }: TourProps) {
  const [index, setIndex] = useState(0)
  const [rect, setRect] = useState<Rect | null>(null)
  const [viewport, setViewport] = useState(() => ({ w: window.innerWidth, h: window.innerHeight }))
  const popRef = useRef<HTMLDivElement | null>(null)
  const previousFocus = useRef<HTMLElement | null>(null)
  const tabRef = useRef(onTab)
  const finishRef = useRef(onFinish)

  useEffect(() => {
    tabRef.current = onTab
    finishRef.current = onFinish
  }, [onTab, onFinish])

  useEffect(() => {
    if (open) setIndex(0)
  }, [open])

  const step = STEPS[index]

  const measure = useCallback(() => {
    const element = document.querySelector<HTMLElement>(step.selector)
    setViewport({ w: window.innerWidth, h: window.innerHeight })
    if (!element) {
      setRect(null)
      return
    }
    const box = element.getBoundingClientRect()
    setRect({ top: box.top, left: box.left, width: box.width, height: box.height, bottom: box.bottom, right: box.right })
  }, [step.selector])

  useEffect(() => {
    if (!open) return
    setRect(null)
    tabRef.current('overview')
    let timer = 0
    const frame = window.requestAnimationFrame(() => {
      const element = document.querySelector<HTMLElement>(step.selector)
      if (element && !element.closest('header')) {
        element.scrollIntoView({ block: 'center', behavior: 'auto' })
      }
      timer = window.setTimeout(measure, 90)
    })
    const onResize = () => measure()
    window.addEventListener('resize', onResize)
    window.addEventListener('scroll', measure, true)
    return () => {
      window.cancelAnimationFrame(frame)
      window.clearTimeout(timer)
      window.removeEventListener('resize', onResize)
      window.removeEventListener('scroll', measure, true)
    }
  }, [open, index, step.selector, measure])

  useEffect(() => {
    if (!open) {
      previousFocus.current?.focus?.()
      return
    }
    previousFocus.current = document.activeElement as HTMLElement | null
    const timer = window.setTimeout(() => popRef.current?.focus(), 30)
    return () => window.clearTimeout(timer)
  }, [open])

  useEffect(() => {
    if (!open) return
    const onKey = (event: KeyboardEvent) => {
      if (event.key === 'ArrowRight' || event.key === 'Enter') {
        event.preventDefault()
        event.stopPropagation()
        if (index >= STEPS.length - 1) finishRef.current()
        else setIndex((value) => Math.min(STEPS.length - 1, value + 1))
      } else if (event.key === 'ArrowLeft') {
        event.preventDefault()
        event.stopPropagation()
        setIndex((value) => Math.max(0, value - 1))
      } else if (event.key === 'Escape') {
        event.preventDefault()
        event.stopPropagation()
        finishRef.current()
      }
    }
    window.addEventListener('keydown', onKey, true)
    return () => window.removeEventListener('keydown', onKey, true)
  }, [open, index])

  if (!open) return null

  const width = Math.min(340, viewport.w - 24)
  let top = Math.max(12, (viewport.h - 220) / 2)
  let left = Math.max(12, (viewport.w - width) / 2)

  if (rect) {
    left = clamp(rect.left + rect.width / 2 - width / 2, 12, Math.max(12, viewport.w - width - 12))
    const spaceBelow = viewport.h - rect.bottom
    if (spaceBelow >= 230 || rect.top < 230) {
      top = Math.min(rect.bottom + 12, viewport.h - 236)
    } else {
      top = Math.max(12, rect.top - 12 - 210)
    }
  }

  return (
    <>
      <div className="fixed inset-0 z-[85]" aria-hidden="true" />
      {rect ? (
        <div
          className="pointer-events-none fixed z-[86]"
          aria-hidden="true"
          style={{
            top: Math.max(0, rect.top - 4),
            left: Math.max(0, rect.left - 4),
            width: rect.width + 8,
            height: rect.height + 8,
            border: '2px solid var(--mint-deep)',
            borderRadius: 14,
            boxShadow: '0 0 0 9999px rgba(12, 10, 9, 0.45)',
          }}
        />
      ) : (
        <div className="fixed inset-0 z-[84]" style={{ background: 'rgba(12, 10, 9, 0.45)' }} aria-hidden="true" />
      )}

      <div
        ref={popRef}
        role="dialog"
        aria-modal="true"
        aria-labelledby="tour-title"
        tabIndex={-1}
        className="fixed z-[95] border p-4 text-ink"
        style={{
          top,
          left,
          width,
          background: 'var(--panel)',
          borderColor: 'var(--hair)',
          borderRadius: 18,
          boxShadow: 'var(--shadow-lg)',
          maxHeight: viewport.h - 24,
          overflowY: 'auto',
        }}
      >
        <div className="flex items-center gap-2">
          <span className="text-[0.6875rem] font-semibold text-muted">Guided tour</span>
          <span className="mono ml-auto text-[0.6875rem] font-semibold text-muted" aria-live="polite">
            {index + 1} of {STEPS.length}
          </span>
          <button
            type="button"
            className="btn btn-quiet btn-sm -mr-1 !h-7 !w-7 !px-0"
            aria-label="End the tour"
            onClick={() => finishRef.current()}
          >
            <IconX size={12} />
          </button>
        </div>

        <h2 id="tour-title" className="mt-1.5 font-display text-[1rem] font-semibold">
          {step.title}
        </h2>
        <p className="mt-1.5 text-[0.78125rem] leading-relaxed text-muted">{step.body}</p>
        <p className="mt-2 text-[0.6875rem] text-muted">Arrow keys move; Escape ends the tour.</p>

        <div className="mt-3 flex flex-wrap items-center gap-1.5">
          <button type="button" className="btn btn-quiet btn-sm" onClick={() => finishRef.current()}>
            Skip
          </button>
          <span className="ml-auto flex items-center gap-1.5">
            <button
              type="button"
              className="btn btn-sm"
              disabled={index === 0}
              onClick={() => setIndex((value) => Math.max(0, value - 1))}
            >
              <IconChevronLeft size={11} />
              Back
            </button>
            <button
              type="button"
              className="btn btn-sm btn-primary"
              onClick={() => {
                if (index >= STEPS.length - 1) finishRef.current()
                else setIndex((value) => Math.min(STEPS.length - 1, value + 1))
              }}
            >
              {index >= STEPS.length - 1 ? 'Done' : 'Next'}
              {index >= STEPS.length - 1 ? null : <IconChevronRight size={11} />}
            </button>
          </span>
        </div>
      </div>
    </>
  )
}
