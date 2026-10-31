import { useMemo, useState } from 'react'
import type { RfHistoryPoint, RfState } from '../api/types'
import { fmtNumber, fmtRatio, fmtScore } from '../lib/format'
import {
  RF_SHORT,
  RF_TONE,
  confidenceTone,
  dataQualityTone,
  rfSentence,
} from '../lib/rf'
import { ChartTable, LineChart, type ChartPoint } from './LineChart'
import { Panel } from './Panel'
import { StatusLabel } from './StatusLabel'

interface RFPanelProps {
  rf: RfState | null
  history: RfHistoryPoint[]
  simple: boolean
  stale: boolean
  ageLabel: string
}

const REVIEW_AT_S = 20

export function RFPanel({ rf, history, simple, stale, ageLabel }: RFPanelProps) {
  const [tab, setTab] = useState<'chart' | 'table'>('chart')

  const points = useMemo<ChartPoint[]>(
    () => history.map((point) => ({ t: point.recorded_at, v: point.periodicity_score })),
    [history],
  )

  const state = rf?.state ?? 'NO_DATA'
  const tone = RF_TONE[state] ?? 'neutral'
  const held = rf?.pattern_seconds ?? 0
  const features = rf?.features

  return (
    <Panel
      title="RF observation"
      tour="rf"
      id="rf-panel"
      help="The ESP32 measures how Wi-Fi signals change around the site. A repeating pattern is an observation for a human to review, not proof that anyone is there. Confidence describes how clean and consistent the evidence is, not the chance of a person being present."
      className={stale ? 'opacity-80' : undefined}
      right={
        rf ? (
          <span className="mono text-[0.6875rem] text-muted" title="Age of the status update">
            {ageLabel}
          </span>
        ) : null
      }
    >
      <div className="px-4 pb-3.5 pt-3.5">
        <div className="flex flex-wrap items-center gap-2">
          <StatusLabel tone={tone}>{RF_SHORT[state] ?? state}</StatusLabel>
          {rf ? (
            <>
              <span className="label ml-1">Quality</span>
              <StatusLabel tone={dataQualityTone(rf.data_quality)}>{rf.data_quality}</StatusLabel>
              <span className="label ml-1">Confidence</span>
              <StatusLabel tone={confidenceTone(rf.confidence)}>{String(rf.confidence)}</StatusLabel>
            </>
          ) : null}
        </div>
        <p className="mt-2 max-w-[74ch] text-[0.78125rem] leading-relaxed">
          {rf ? rfSentence(rf.state, rf.text) : 'No RF status has arrived yet.'}
        </p>
      </div>

      <dl className="mx-4 grid grid-cols-3 gap-x-5 gap-y-4 border-y py-3.5" style={{ borderColor: 'var(--hair)' }}>
        <div>
          <dt className="label">Periodicity score</dt>
          <dd className="mono mt-1 text-[1.125rem] font-semibold leading-none">
            {rf ? fmtScore(rf.periodicity_score) : '—'}
            <span className="ml-1 text-[0.6875rem] font-normal text-muted">/ 1</span>
          </dd>
        </div>
        <div>
          <dt className="label">Pattern held</dt>
          <dd className="mono mt-1 text-[1.125rem] font-semibold leading-none">
            {rf ? `${Math.round(held)} s` : '—'}
          </dd>
          <dd className="mt-1 text-[0.6875rem] leading-snug text-muted">review at {REVIEW_AT_S} s</dd>
          <div className="mt-1.5 h-1 w-full overflow-hidden rounded-full" style={{ background: 'var(--panel2)' }} aria-hidden="true">
            <div
              className="h-full rounded-full transition-[width] duration-150"
              style={{
                width: `${Math.min(100, (held / REVIEW_AT_S) * 100)}%`,
                background: held >= REVIEW_AT_S ? 'var(--serious)' : 'var(--mint)',
              }}
            />
          </div>
        </div>
        <div>
          <dt className="label">Candidate rate</dt>
          <dd className="mono mt-1 text-[1.125rem] font-semibold leading-none">
            {features ? fmtNumber(features.dominant_rate_per_min, 1) : '—'}
            <span className="ml-1 text-[0.6875rem] font-normal text-muted">cycles/min</span>
          </dd>
          <dd className="mt-1 text-[0.6875rem] leading-snug text-muted">candidate, not a breathing rate</dd>
        </div>

        <div>
          <dt className="label">Packet rate</dt>
          <dd className="mono mt-1 text-[0.9375rem] font-semibold leading-tight">
            {features ? `${fmtNumber(features.packet_rate_hz, 1)} / s` : '—'}
          </dd>
        </div>
        <div>
          <dt className="label">Packet loss</dt>
          <dd className="mono mt-1 text-[0.9375rem] font-semibold leading-tight">
            {features ? fmtRatio(features.packet_loss_ratio) : '—'}
          </dd>
        </div>
        <div>
          <dt className="label">RSSI</dt>
          <dd className="mono mt-1 text-[0.9375rem] font-semibold leading-tight">
            {features ? `${fmtNumber(features.rssi, 1)} dBm` : '—'}
          </dd>
        </div>
      </dl>

      {!simple ? (
        <>
          <div className="flex items-center justify-between gap-2 px-4 pb-2 pt-3">
            <span className="label">Score · 0–1</span>
            <div className="seg" role="group" aria-label="RF history display">
              {(['chart', 'table'] as const).map((option) => (
                <button
                  key={option}
                  type="button"
                  className="px-2.5 py-1 text-[0.6875rem]"
                  aria-pressed={tab === option}
                  onClick={() => setTab(option)}
                >
                  {option === 'chart' ? 'Chart' : 'Table'}
                </button>
              ))}
            </div>
          </div>
          <div className="px-3 pb-3">
            {tab === 'chart' ? (
              <LineChart
                points={points}
                min={0}
                max={1}
                height={136}
                format={(value) => value.toFixed(1)}
                ariaLabel="Periodicity score over the recent window"
                emptyText="No RF history yet. The chart fills as packets arrive."
              />
            ) : (
              <ChartTable points={points} format={(value) => value.toFixed(2)} />
            )}
          </div>
        </>
      ) : (
        <p className="px-4 py-3 text-[0.71875rem] text-muted">Charts are hidden in Simple view.</p>
      )}
    </Panel>
  )
}
