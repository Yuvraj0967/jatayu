import { useMemo, useState } from 'react'
import type { EnvironmentState, Reading } from '../api/types'
import { fmtAgeFromSeconds, fmtNumber, sentence } from '../lib/format'
import { GAS_TONE, gasLabel } from '../lib/rf'
import { ChartTable, LineChart, type ChartPoint } from './LineChart'
import { Panel } from './Panel'
import { StatusLabel } from './StatusLabel'

interface EnvironmentPanelProps {
  environment: EnvironmentState | null
  history: Reading[]
  simple: boolean
  busy: boolean
  onRebaseline: () => void
}

export function EnvironmentPanel({ environment, history, simple, busy, onRebaseline }: EnvironmentPanelProps) {
  const [table, setTable] = useState(false)

  const points = useMemo<ChartPoint[]>(
    () => history.map((point) => ({ t: point.recorded_at, v: point.raw_value })),
    [history],
  )

  const status = environment?.status ?? 'NO_DATA'
  const tone = GAS_TONE[status] ?? 'neutral'
  const baseline = environment?.baseline_adc ?? null
  const threshold = environment?.threshold_adc ?? null
  const ageS = environment?.age_s
  const warming = status === 'WARMING_UP' && environment?.warmup_remaining_s != null

  return (
    <Panel
      title="Environmental sensor"
      tour="gas"
      id="gas-panel"
      help="The Arduino reports raw ADC counts from an uncalibrated analog gas sensor, on a scale of 0 to 1023. Counts are not ppm and no gas is named. The baseline is measured in clean air; readings above the elevated threshold are a prompt to look, not a measurement of danger."
      right={
        <>
          <span className="mono text-[0.6875rem] text-muted">
            {ageS == null ? 'no reading age' : `last reading ${fmtAgeFromSeconds(ageS)}`}
          </span>
          <button type="button" className="btn btn-sm" onClick={onRebaseline} disabled={busy} title="Measure a new clean-air baseline">
            Re-baseline
          </button>
        </>
      }
    >
      <div className="px-4 pb-3.5 pt-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusLabel tone={tone}>{gasLabel(status)}</StatusLabel>
          {environment?.calibration ? (
            <span className="text-[0.6875rem] font-medium text-muted">
              {sentence(environment.calibration)}
            </span>
          ) : null}
        </div>
        {warming ? (
          <p
            className="mt-2 rounded-xl px-2.5 py-1.5 text-[0.71875rem] leading-snug text-muted"
            style={{ background: 'var(--panel2)' }}
          >
            Warming up, about {Math.max(0, Math.ceil(environment?.warmup_remaining_s ?? 0))} s left before readings are
            usable.
          </p>
        ) : null}
      </div>

      <dl className="mx-4 grid grid-cols-3 gap-x-5 border-y py-3.5" style={{ borderColor: 'var(--hair)' }}>
        <div>
          <dt className="label">Raw reading</dt>
          <dd className="mono mt-1 text-[1.25rem] font-semibold leading-none">
            {environment?.raw_adc != null ? fmtNumber(environment.raw_adc) : '—'}
          </dd>
          <dd className="mt-1 text-[0.6875rem] text-muted">ADC · 0–1023</dd>
        </div>
        <div>
          <dt className="label">Baseline</dt>
          <dd className="mono mt-1 text-[0.9375rem] font-semibold leading-tight">
            {baseline != null ? `${fmtNumber(baseline)} counts` : '—'}
          </dd>
          <dd className="mt-1 text-[0.6875rem] text-muted">clean-air reference</dd>
        </div>
        <div>
          <dt className="label">Elevated above</dt>
          <dd className="mono mt-1 text-[0.9375rem] font-semibold leading-tight">
            {threshold != null ? `${fmtNumber(threshold)} counts` : '—'}
          </dd>
          <dd className="mt-1 text-[0.6875rem] text-muted">review threshold</dd>
        </div>
      </dl>

      <div className="flex flex-wrap items-center justify-between gap-2 px-4 pb-2 pt-3">
        <span className="text-[0.6875rem] text-muted">
          {environment?.model ? `Sensor: ${environment.model}` : 'Sensor model not reported'}
        </span>
        {!simple ? (
          <div className="seg" role="group" aria-label="Gas history display">
            {([
              { key: false, label: 'Chart' },
              { key: true, label: 'Table' },
            ] as const).map((option) => (
              <button
                key={option.label}
                type="button"
                className="px-2.5 py-1 text-[0.6875rem]"
                aria-pressed={table === option.key}
                onClick={() => setTable(option.key)}
                title="Switch between chart and table"
              >
                {option.label}
              </button>
            ))}
          </div>
        ) : null}
      </div>

      {!simple ? (
        <div className="px-3 pb-3">
          {table ? (
            <ChartTable points={points} format={(value) => `${fmtNumber(value)} counts`} />
          ) : (
            <LineChart
              points={points}
              min={0}
              max={1023}
              height={136}
              format={(value) => value.toFixed(0)}
              refs={[
                ...(baseline != null ? [{ value: baseline, label: 'baseline', tone: 'muted' as const }] : []),
                ...(threshold != null ? [{ value: threshold, label: 'elevated threshold', tone: 'critical' as const }] : []),
              ]}
              ariaLabel="Raw gas sensor ADC counts with baseline and elevated threshold"
              emptyText="No gas readings yet. The chart fills as the sensor reports."
            />
          )}
        </div>
      ) : (
        <p className="px-4 py-3 text-[0.71875rem] text-muted">Charts are hidden in Simple view.</p>
      )}

      {environment?.disclaimer ? (
        <p
          className="mx-4 mb-3.5 rounded-xl px-2.5 py-1.5 text-[0.6875rem] leading-snug text-muted"
          style={{ background: 'var(--panel2)' }}
        >
          {environment.disclaimer}
        </p>
      ) : null}
    </Panel>
  )
}
