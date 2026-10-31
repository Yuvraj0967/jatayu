import type { Status } from '../api/types'
import type { Mode } from '../api/types'
import { cn } from '../lib/cn'
import { IconCheck } from './Icons'

interface ChecklistItem {
  label: string
  ready: boolean
  hint: string
}

interface SetupChecklistProps {
  mode: Mode
  status: Status | null
}

function itemsFor(mode: Mode, status: Status | null): ChecklistItem[] {
  const live = mode === 'live'
  const devices = status?.devices
  const quality = status?.rf.data_quality
  const envStatus = status?.environment.status

  const esp32Ready = live && devices?.esp32 === 'online'
  const qualityReady = live && (quality === 'good' || quality === 'fair')
  const arduinoReady = live && devices?.arduino === 'online'
  const gasReady = live && (envStatus === 'NORMAL' || envStatus === 'ELEVATED')
  const monitoringReady = Boolean(status?.monitoring) && (live || mode === 'demo')

  return [
    {
      label: 'Backend reachable',
      ready: live,
      hint: mode === 'demo' ? 'Start the backend, then retry.' : 'Start it and keep it running.',
    },
    {
      label: 'ESP32 streaming CSI',
      ready: esp32Ready,
      hint: live ? 'No packets. Check the cable and hotspot.' : 'Needs the backend and a node.',
    },
    {
      label: 'Signal quality good or fair',
      ready: qualityReady,
      hint: live ? 'Low quality. Check antenna placement.' : 'Needs live packets to judge.',
    },
    {
      label: 'Arduino connected',
      ready: arduinoReady,
      hint: live ? 'No serial link. Check cable and COM port.' : 'Needs the backend and serial link.',
    },
    {
      label: 'Gas sensor ready',
      ready: gasReady,
      hint: !live
        ? 'Needs the backend to read the sensor.'
        : envStatus === 'WARMING_UP'
          ? 'Warming up. Readings are not usable yet.'
          : envStatus === 'BASELINING'
            ? 'Measuring a baseline. Hold still.'
            : 'No usable reading yet.',
    },
    {
      label: 'Monitoring on',
      ready: monitoringReady,
      hint: 'Start it in the top bar.',
    },
  ]
}

export function SetupChecklist({ mode, status }: SetupChecklistProps) {
  const items = itemsFor(mode, status)
  const ready = items.filter((item) => item.ready).length
  const percent = Math.round((ready / items.length) * 100)

  return (
    <section className="panel flex flex-col px-4 py-3.5" data-tour="checklist" aria-label="Setup checklist">
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        <h2 className="font-display text-[0.84375rem] font-semibold text-ink">Setup checklist</h2>
        <div
          className="h-1 w-20 overflow-hidden rounded-full"
          style={{ background: 'var(--panel2)' }}
          role="progressbar"
          aria-valuemin={0}
          aria-valuemax={items.length}
          aria-valuenow={ready}
          aria-label={`${ready} of ${items.length} setup checks ready`}
        >
          <div
            className="h-full rounded-full transition-[width] duration-150"
            style={{ width: `${percent}%`, background: ready === items.length ? 'var(--mint)' : 'var(--mint-deep)' }}
          />
        </div>
        <span className="mono ml-auto text-[0.6875rem] font-semibold text-muted">
          {ready} of {items.length} ready
        </span>
      </div>
      <ul className="mt-2.5 grid grid-cols-1 gap-x-5 gap-y-1.5 sm:grid-cols-2">
        {items.map((item) => (
          <li key={item.label} className="flex items-start gap-2">
            <span
              className={cn(
                'mt-[2px] flex h-[16px] w-[16px] shrink-0 items-center justify-center rounded-full',
                item.ready ? '' : 'border',
              )}
              style={{
                borderColor: item.ready ? 'transparent' : 'var(--hair)',
                background: item.ready ? 'var(--mint-soft)' : 'transparent',
                color: item.ready ? 'var(--mint-deep)' : 'transparent',
              }}
              aria-hidden="true"
            >
              {item.ready ? <IconCheck size={9} /> : null}
            </span>
            <span className={cn('min-w-0 text-[0.71875rem] leading-snug', item.ready ? 'text-ink' : 'text-muted')}>
              <span className={item.ready ? 'font-medium' : undefined}>{item.label}</span>
              <span className="sr-only">{item.ready ? ': ready' : ': not ready'}</span>
              {!item.ready ? <span className="text-muted"> — {item.hint}</span> : null}
            </span>
          </li>
        ))}
      </ul>
    </section>
  )
}
