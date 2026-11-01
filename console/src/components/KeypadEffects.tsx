import { useEffect, useRef, useState } from 'react'
import { ApiClient } from '../api/client'
import type { Status } from '../api/types'

// Keypad 3, 5, 6, 7 and 9 open the matching section (docs/system-guide.md).
const KEY_SECTIONS: Record<string, string> = {
  SHOW_SENSOR_STATUS: 'gas-panel',
  SHOW_RF_STATUS: 'rf-panel',
  SHOW_SYSTEM_STATUS: 'readout-strip',
  SHOW_INCIDENT_SUMMARY: 'incidents-panel',
  DIAGNOSTICS: 'timeline',
}

interface KeypadEffectsProps {
  status: Status | null
  apiBase: string
  onShowOverview: () => void
}

export function KeypadEffects({ status, apiBase, onShowOverview }: KeypadEffectsProps) {
  const [popup, setPopup] = useState<{ text: string; total: number } | null>(null)
  const keySeen = useRef<number | null>(null)
  const livesSeen = useRef<number | null>(null)
  const lastKey = status?.last_key ?? null
  const lives = status?.lives ?? null
  const livesId = status ? (lives?.last?.id ?? 0) : null

  // Laptop key 7 toggles the scripted simulation.
  useEffect(() => {
    function onKey(event: KeyboardEvent) {
      const target = event.target as HTMLElement | null
      if (event.key !== '7' || /^(INPUT|TEXTAREA|SELECT)$/.test(target?.tagName ?? '')) return
      void new ApiClient(apiBase).post('/demo').catch(() => {})
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [apiBase])

  useEffect(() => {
    if (!status) return
    const at = lastKey?.at ?? 0
    const first = keySeen.current === null
    const changed = at !== keySeen.current
    keySeen.current = at
    if (first || !changed || !lastKey) return
    const id = KEY_SECTIONS[lastKey.action]
    if (!id) return
    onShowOverview()
    window.setTimeout(() => {
      const section = document.getElementById(id)
      if (!section) return
      section.scrollIntoView({ behavior: 'smooth', block: 'center' })
      section.style.outline = '2px solid var(--mint-deep)'
      section.style.outlineOffset = '3px'
      window.setTimeout(() => {
        section.style.outline = ''
        section.style.outlineOffset = ''
      }, 3000)
    }, 80)
  }, [status, lastKey, onShowOverview])

  // Depends on the report id alone: status updates must not restart the timer.
  useEffect(() => {
    if (livesId === null) return
    const first = livesSeen.current === null
    const changed = livesId !== livesSeen.current
    livesSeen.current = livesId
    if (first || !changed || !lives?.last) return
    setPopup({ text: lives.last.text, total: lives.total })
    const timer = window.setTimeout(() => setPopup(null), 6000)
    return () => window.clearTimeout(timer)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [livesId])

  if (!popup) return null
  return (
    <div
      id="lives-popup"
      role="status"
      className="fixed left-1/2 top-[18%] z-50 -translate-x-1/2 rounded-xl px-8 py-5 text-center shadow-2xl"
      style={{ background: 'var(--panel)', border: '2px solid var(--mint-deep)', color: 'var(--ink)' }}
    >
      <b className="mb-1 block text-3xl">{popup.text}</b>
      <span className="text-sm text-muted">Reported from the keypad · total {popup.total}</span>
    </div>
  )
}
