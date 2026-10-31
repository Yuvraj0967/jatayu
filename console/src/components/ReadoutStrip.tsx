import type { Mode, Status } from '../api/types'
import { fmtNumber, secondsSince } from '../lib/format'
import { RF_SHORT, gasLabel } from '../lib/rf'
import { cn } from '../lib/cn'

interface ReadoutStripProps {
  status: Status | null
  mode: Mode
  lastStatusAt: number | null
  now: number
}

interface Cell {
  label: string
  value: string
  sub: string
  tone?: string
  stale?: boolean
}

function buildCells(status: Status | null, mode: Mode, ageS: number | null): Cell[] {
  const stale = Boolean(status) && ageS != null && ageS > 6
  const devices = status?.devices
  const rf = status?.rf
  const env = status?.environment
  const counts = status?.incident_counts
  const csiRate = status?.csi_link?.packet_rate_hz ?? rf?.features.packet_rate_hz
  const port = status?.csi_link?.port

  const onOff = (flag: boolean | undefined) => (flag == null ? '—' : flag ? 'On' : 'Off')
  const online = (state: string | undefined) => (state == null ? '—' : state === 'online' ? 'Online' : 'Offline')

  return [
    {
      label: 'Monitoring',
      value: onOff(status?.monitoring),
      sub:
        mode === 'demo'
          ? 'Demo values, not from a site'
          : status?.monitoring
            ? 'Notable patterns will open incidents'
            : 'Incidents will not open while off',
      tone: status?.monitoring ? 'var(--good)' : 'var(--muted)',
      stale,
    },
    {
      label: 'ESP32 CSI node',
      value: online(devices?.esp32),
      sub:
        csiRate != null
          ? `${fmtNumber(csiRate, 1)} packets/s${port ? ` · ${port}` : ''}`
          : 'No CSI packets reported',
      tone: devices?.esp32 === 'online' ? 'var(--good)' : devices ? 'var(--critical)' : undefined,
      stale,
    },
    {
      label: 'Arduino Mega',
      value: online(devices?.arduino),
      sub: status?.arduino_link?.port
        ? `${status.arduino_link.port}${status.arduino_link.error ? ' · link error' : ''}`
        : 'No serial link reported',
      tone: devices?.arduino === 'online' ? 'var(--good)' : devices ? 'var(--critical)' : undefined,
      stale,
    },
    {
      label: 'RF state',
      value: rf ? RF_SHORT[rf.state] ?? rf.state : '—',
      sub: rf ? `quality ${rf.data_quality} · confidence ${rf.confidence}` : 'No status yet',
      stale,
    },
    {
      label: 'Environment',
      value: env ? gasLabel(env.status) : '—',
      sub:
        env?.raw_adc != null
          ? `${fmtNumber(env.raw_adc)} ADC counts · uncalibrated`
          : env
            ? 'No reading yet'
            : 'No status yet',
      tone: env?.status === 'ELEVATED' ? 'var(--serious)' : undefined,
      stale,
    },
    {
      label: 'Active incidents',
      value: counts ? `${counts.open}` : '—',
      sub: counts
        ? `${counts.open} open · ${counts.acknowledged} acknowledged`
        : 'No incident data',
      tone: counts?.open ? 'var(--warning)' : undefined,
      stale,
    },
  ]
}

export function ReadoutStrip({ status, mode, lastStatusAt, now }: ReadoutStripProps) {
  const ageS = lastStatusAt == null ? null : secondsSince(lastStatusAt, now)
  const cells = buildCells(status, mode, ageS)
  const stale = Boolean(status) && ageS != null && ageS > 6

  return (
    <div data-tour="readout" className="min-w-0">
      {stale ? (
        <p
          className="mb-2.5 inline-flex items-center gap-2 rounded-full px-3 py-1 text-[0.71875rem] font-semibold"
          style={{
            color: 'var(--serious)',
            background: 'color-mix(in srgb, var(--serious) 12%, var(--panel))',
          }}
        >
          Stale values · last update {ageS != null && Number.isFinite(ageS) ? Math.round(ageS) : '?'} s ago
        </p>
      ) : null}
      <div className="grid grid-cols-2 gap-2.5 md:grid-cols-3 xl:grid-cols-6">
        {cells.map((cell) => (
          <div key={cell.label} className={cn('stat', cell.stale && 'opacity-75')}>
            <div className="label flex items-center gap-1.5 truncate">
              {cell.tone ? (
                <span
                  className="inline-block h-[6px] w-[6px] shrink-0 rounded-full"
                  style={{ background: cell.tone }}
                  aria-hidden="true"
                />
              ) : null}
              <span className="truncate">{cell.label}</span>
            </div>
            <div
              className="mono mt-1 truncate text-[1.125rem] font-semibold leading-tight"
              style={{ color: cell.tone ?? 'var(--ink)' }}
              title={cell.value}
            >
              {cell.value}
            </div>
            <div className="mt-0.5 truncate text-[0.6875rem] leading-snug text-muted" title={cell.sub}>
              {cell.sub}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}
