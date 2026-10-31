import { useEffect, useRef, useState } from 'react'
import type { Status } from '../api/types'
import { fmtNumber, fmtTime, sentence } from '../lib/format'
import { Panel } from './Panel'

const KEYS = ['1', '2', '3', '4', '5', '6', '7', '8', '9', '*', '0', '#']

interface PhysicalControlsProps {
  status: Status | null
  busy: boolean
  onKey: (key: string) => Promise<void>
  onGas: (offset: number) => Promise<void>
}

export function PhysicalControls({ status, busy, onKey, onGas }: PhysicalControlsProps) {
  const [offset, setOffset] = useState(0)
  const [keyBusy, setKeyBusy] = useState<string | null>(null)
  const timer = useRef<number | null>(null)

  useEffect(
    () => () => {
      if (timer.current != null) window.clearTimeout(timer.current)
    },
    [],
  )

  const simulated = status?.source === 'simulated'
  const link = status?.arduino_link
  const last = status?.last_key ?? null

  function queue(name: string, action: () => Promise<void>) {
    if (busy) return
    if (name.startsWith('key:')) setKeyBusy(name.slice(4))
    else setKeyBusy('gas')
    action()
      .catch(() => {
        /* the calling layer surfaces the error as a toast */
      })
      .finally(() => setKeyBusy(null))
  }

  function changeOffset(next: number) {
    setOffset(next)
    if (timer.current != null) window.clearTimeout(timer.current)
    timer.current = window.setTimeout(() => {
      queue('gas', () => onGas(next))
    }, 350)
  }

  return (
    <Panel
      title="Physical controls"
      id="physical-panel"
      help="The keypad on the device and the LCD page show what a person at the site would see. Simulation controls exist only when the backend reports a simulated source; they never touch real hardware."
    >
      <dl className="grid grid-cols-2 gap-2.5 px-4 pt-3.5 sm:grid-cols-4">
        <div className="rounded-xl px-3 py-2.5" style={{ background: 'var(--panel2)' }}>
          <dt className="label">Last keypad key</dt>
          <dd className="mono mt-1 text-[0.875rem] font-semibold leading-tight">
            {last ? `“${last.key}”` : '—'}
          </dd>
          <dd className="mt-0.5 truncate text-[0.6875rem] text-muted" title={last?.action}>
            {last ? `${sentence(last.action)} · ${fmtTime(last.at)}` : 'no press recorded'}
          </dd>
        </div>
        <div className="rounded-xl px-3 py-2.5" style={{ background: 'var(--panel2)' }}>
          <dt className="label">LCD page</dt>
          <dd className="mono mt-1 truncate text-[0.875rem] font-semibold leading-tight" title={status?.lcd_page}>
            {status?.lcd_page ?? '—'}
          </dd>
          <dd className="mt-0.5 text-[0.6875rem] text-muted">shown on the device</dd>
        </div>
        <div className="rounded-xl px-3 py-2.5" style={{ background: 'var(--panel2)' }}>
          <dt className="label">Arduino link</dt>
          <dd className="mono mt-1 text-[0.875rem] font-semibold leading-tight">
            {link ? link.state : status ? 'not reported' : '—'}
          </dd>
          <dd className="mt-0.5 truncate text-[0.6875rem] text-muted" title={link?.error ?? link?.port ?? undefined}>
            {link?.error ? String(link.error) : link?.port ? String(link.port) : 'no port'}
          </dd>
        </div>
        <div className="rounded-xl px-3 py-2.5" style={{ background: 'var(--panel2)' }}>
          <dt className="label">Backend cycle</dt>
          <dd className="mono mt-1 text-[0.875rem] font-semibold leading-tight">
            {status ? `${fmtNumber(status.performance?.tick_ms)} ms` : '—'}
          </dd>
          <dd className="mt-0.5 text-[0.6875rem] text-muted">tick interval</dd>
        </div>
      </dl>

      {simulated ? (
        <div
          className="mx-4 mb-3.5 mt-3 grid gap-4 rounded-xl px-4 py-4 sm:grid-cols-[220px_1fr]"
          style={{ background: 'var(--panel2)' }}
        >
          <div>
            <h3 className="font-display text-[0.78125rem] font-semibold">Simulated keypad</h3>
            <div className="mt-2 grid grid-cols-3 gap-1.5">
              {KEYS.map((key) => (
                <button
                  key={key}
                  type="button"
                  className="btn mono !rounded-xl"
                  style={{ minHeight: 44, fontSize: '0.875rem' }}
                  disabled={busy || keyBusy != null}
                  onClick={() => queue(`key:${key}`, () => onKey(key))}
                  aria-label={`Send keypad key ${key}`}
                >
                  {keyBusy === key ? '…' : key}
                </button>
              ))}
            </div>
            <p className="mt-2 text-[0.6875rem] leading-snug text-muted">
              Posts to /api/simulate/key when a backend is connected; in demo mode it updates local demo data.
            </p>
          </div>
          <div className="min-w-0">
            <h3 className="font-display text-[0.78125rem] font-semibold">Gas offset</h3>
            <div className="mt-3 flex items-center gap-3">
              <input
                type="range"
                min={-300}
                max={700}
                step={10}
                value={offset}
                onChange={(event) => changeOffset(Number(event.target.value))}
                className="w-full"
                style={{ accentColor: 'var(--mint-deep)', minHeight: 44 }}
                aria-label="Gas offset in ADC counts"
                aria-valuetext={`${offset} ADC counts`}
              />
              <span className="mono w-14 shrink-0 text-right text-[0.8125rem] font-semibold">
                {offset > 0 ? `+${offset}` : offset}
              </span>
            </div>
            <div className="mt-2 flex flex-wrap items-center gap-2 text-[0.6875rem] leading-snug text-muted">
              <span>Range −300 to 700 counts. Posts after a short pause.</span>
              <button
                type="button"
                className="btn btn-sm"
                disabled={busy || offset === 0}
                onClick={() => changeOffset(0)}
              >
                Reset to 0
              </button>
            </div>
            <p className="mt-2.5 text-[0.6875rem] leading-snug text-muted">
              This only shifts simulated readings. It does not calibrate the sensor or change the elevated threshold.
            </p>
          </div>
        </div>
      ) : (
        <p className="px-4 py-4 text-[0.71875rem] leading-relaxed text-muted">
          Simulation controls are hidden because the backend reports a live source. Keypad presses and gas offsets
          would need to come from the device.
        </p>
      )}
    </Panel>
  )
}
