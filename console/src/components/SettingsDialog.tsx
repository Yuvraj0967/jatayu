import { useEffect, useState } from 'react'
import type { Mode } from '../api/types'
import type { ThemePreference } from '../settings/SettingsContext'
import { Dialog } from './ui'

interface SettingsDialogProps {
  open: boolean
  apiBase: string
  mode: Mode
  theme: ThemePreference
  onClose: () => void
  onSave: (apiBase: string) => void
  onTheme: (theme: ThemePreference) => void
}

function normalise(value: string): string {
  return value.trim().replace(/\/+$/, '')
}

function valid(value: string): boolean {
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:'
  } catch {
    return false
  }
}

export function SettingsDialog({ open, apiBase, mode, theme, onClose, onSave, onTheme }: SettingsDialogProps) {
  const [value, setValue] = useState(apiBase)
  const [touched, setTouched] = useState(false)

  useEffect(() => {
    if (open) {
      setValue(apiBase)
      setTouched(false)
    }
  }, [open, apiBase])

  const clean = normalise(value)
  const ok = valid(clean)

  function save() {
    setTouched(true)
    if (!ok) return
    onSave(clean)
    onClose()
  }

  return (
    <Dialog
      open={open}
      onClose={onClose}
      title="Settings"
      subtitle="Where the console looks for the site backend. Stored in this browser only."
      width={520}
      footer={
        <>
          <button type="button" className="btn" onClick={onClose}>
            Cancel
          </button>
          <button type="button" className="btn btn-primary" onClick={save} disabled={!ok}>
            Save and reconnect
          </button>
        </>
      }
    >
      <label htmlFor="api-base" className="label block">
        API base address
      </label>
      <input
        id="api-base"
        className="input machine mt-1.5"
        value={value}
        spellCheck={false}
        autoCapitalize="off"
        autoCorrect="off"
        placeholder="http://localhost:8000"
        onChange={(event) => {
          setValue(event.target.value)
          setTouched(false)
        }}
        onKeyDown={(event) => {
          if (event.key === 'Enter') save()
        }}
        aria-describedby="api-base-help api-base-error"
        aria-invalid={touched && !ok}
        style={{ borderColor: touched && !ok ? 'var(--critical)' : undefined }}
      />
      {touched && !ok ? (
        <p id="api-base-error" className="mt-1.5 text-[0.6875rem]" style={{ color: 'var(--critical)' }}>
          Enter a full http:// or https:// address, for example http://localhost:8000.
        </p>
      ) : null}
      <p id="api-base-help" className="mt-2 text-[0.71875rem] leading-relaxed text-muted">
        The console checks this address on load and polls it every few seconds. If it does not answer within three
        seconds, the console runs in demo mode with generated values. Demo and live data are never mixed.
      </p>

      <div className="mt-5 border-t pt-4" style={{ borderColor: 'var(--hair)' }}>
        <div className="flex flex-wrap items-center gap-x-4 gap-y-2">
          <span className="label">Appearance</span>
          <div className="seg" role="group" aria-label="Appearance">
            {(
              [
                { value: 'light', label: 'Daylight' },
                { value: 'dark', label: 'Low light' },
                { value: 'system', label: 'Match system' },
              ] as const
            ).map((option) => {
              const selected = theme === option.value
              return (
                <button
                  key={option.value}
                  type="button"
                  className="px-3 py-1"
                  aria-pressed={selected}
                  onClick={() => onTheme(option.value)}
                >
                  {option.label}
                </button>
              )
            })}
          </div>
        </div>
        <p className="mt-2 text-[0.71875rem] leading-relaxed text-muted">
          Daylight is a bright, low-contrast surface for a lit room. Low light is a soft charcoal version for dim
          rooms. The setting is kept in this browser.
        </p>
      </div>

      <div className="mt-3 rounded-xl px-3.5 py-3" style={{ background: 'var(--panel2)' }}>
        <div className="flex items-baseline justify-between gap-2">
          <span className="label">Current source</span>
          <span className="text-[0.75rem] font-semibold">
            {mode === 'demo' ? 'Demo data' : mode === 'live' ? 'Backend connected' : 'Connecting'}
          </span>
        </div>
        <p className="mt-1.5 text-[0.71875rem] leading-relaxed text-muted">
          Start the backend with <span className="machine">python app.py</span> in the backend folder, then use Try again
          from the Next action bar. The WebSocket feed reconnects on its own after a drop.
        </p>
      </div>
    </Dialog>
  )
}
