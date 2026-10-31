import { useEffect, useMemo, useRef, useState } from 'react'
import { fmtTime } from '../lib/format'

export interface ChartPoint {
  t: number
  v: number
}

export interface ChartRef {
  value: number
  label: string
  tone?: 'critical' | 'muted'
}

interface LineChartProps {
  points: ChartPoint[]
  min: number
  max: number
  format: (value: number) => string
  refs?: ChartRef[]
  ariaLabel: string
  height?: number
  emptyText?: string
}

const LEFT = 40
const RIGHT = 12
const TOP = 10
const BOTTOM = 20
const AXIS_FONT = "Poppins, 'Avenir Next', 'Century Gothic', 'Segoe UI', sans-serif"

export function LineChart({
  points,
  min,
  max,
  format,
  refs = [],
  ariaLabel,
  height = 154,
  emptyText = 'No chart data yet.',
}: LineChartProps) {
  const wrapRef = useRef<HTMLDivElement | null>(null)
  const [width, setWidth] = useState(560)
  const [active, setActive] = useState<number | null>(null)

  useEffect(() => {
    const element = wrapRef.current
    if (!element) return
    const observer = new ResizeObserver((entries) => {
      const next = entries[0]?.contentRect.width ?? 560
      setWidth(Math.max(260, Math.round(next)))
    })
    observer.observe(element)
    return () => observer.disconnect()
  }, [])

  const geometry = useMemo(() => {
    const innerWidth = Math.max(40, width - LEFT - RIGHT)
    const innerHeight = Math.max(40, height - TOP - BOTTOM)
    const span = max - min || 1
    const x = (index: number) => {
      if (points.length <= 1) return LEFT + innerWidth / 2
      return LEFT + (index / (points.length - 1)) * innerWidth
    }
    const y = (value: number) => TOP + (1 - (value - min) / span) * innerHeight
    const path = points.map((point, index) => `${index === 0 ? 'M' : 'L'}${x(index).toFixed(1)},${y(point.v).toFixed(1)}`).join(' ')
    const baseY = y(min)
    const areaPath = `${path} L${x(points.length - 1).toFixed(1)},${baseY.toFixed(1)} L${x(0).toFixed(1)},${baseY.toFixed(1)} Z`
    return { innerWidth, innerHeight, x, y, path, areaPath, baseY }
  }, [points, min, max, width, height])

  const ticks = useMemo(() => {
    const values = [0, 0.25, 0.5, 0.75, 1].map((fraction) => min + (max - min) * fraction)
    return values
  }, [min, max])

  if (!points.length) {
    return (
      <div
        ref={wrapRef}
        className="flex items-center justify-center rounded-xl px-4 text-center text-[0.71875rem] text-muted"
        style={{ height, background: 'var(--panel2)' }}
      >
        {emptyText}
      </div>
    )
  }

  const activePoint = active != null ? points[Math.min(active, points.length - 1)] : null
  const activeX = active != null ? geometry.x(Math.min(active, points.length - 1)) : 0
  const activeY = activePoint ? geometry.y(activePoint.v) : 0
  const tooltipLeft = Math.min(Math.max(activeX, 70), width - 70)

  return (
    <div ref={wrapRef} className="relative w-full select-none">
      <svg
        width={width}
        height={height}
        role="img"
        aria-label={`${ariaLabel}. Use the left and right arrow keys to inspect values.`}
        tabIndex={0}
        className="block max-w-full"
        onPointerMove={(event) => {
          const rect = event.currentTarget.getBoundingClientRect()
          const relative = event.clientX - rect.left
          const ratio = (relative - LEFT) / Math.max(1, width - LEFT - RIGHT)
          const index = Math.round(ratio * (points.length - 1))
          setActive(Math.max(0, Math.min(points.length - 1, index)))
        }}
        onPointerLeave={() => setActive(null)}
        onFocus={() => setActive(points.length - 1)}
        onBlur={() => setActive(null)}
        onKeyDown={(event) => {
          if (event.key === 'ArrowLeft') {
            event.preventDefault()
            setActive((current) => Math.max(0, (current ?? points.length - 1) - 1))
          } else if (event.key === 'ArrowRight') {
            event.preventDefault()
            setActive((current) => Math.min(points.length - 1, (current ?? points.length - 1) + 1))
          } else if (event.key === 'Home') {
            event.preventDefault()
            setActive(0)
          } else if (event.key === 'End') {
            event.preventDefault()
            setActive(points.length - 1)
          } else if (event.key === 'Escape') {
            setActive(null)
          }
        }}
      >
        <defs>
          <linearGradient id="jatayu-mint-fill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="var(--mint)" stopOpacity={0.32} />
            <stop offset="100%" stopColor="var(--mint)" stopOpacity={0.02} />
          </linearGradient>
        </defs>

        {ticks.map((tick) => (
          <g key={tick}>
            <line
              x1={LEFT}
              x2={width - RIGHT}
              y1={geometry.y(tick)}
              y2={geometry.y(tick)}
              stroke="var(--hair)"
              strokeWidth={1}
              strokeOpacity={tick === min || tick === max ? 1 : 0.65}
            />
            <text
              x={LEFT - 6}
              y={geometry.y(tick) + 3}
              textAnchor="end"
              fontSize={9.5}
              fill="var(--muted)"
              fontFamily={AXIS_FONT}
            >
              {format(tick)}
            </text>
          </g>
        ))}

        {refs.map((reference, refIndex) => {
          const referenceY = geometry.y(reference.value)
          const labelY = referenceY + (refIndex % 2 === 0 ? 11 : -3)
          return (
            <g key={`${reference.label}-${reference.value}`}>
              <line
                x1={LEFT}
                x2={width - RIGHT}
                y1={referenceY}
                y2={referenceY}
                stroke={reference.tone === 'critical' ? 'var(--critical)' : 'var(--muted)'}
                strokeWidth={1}
                strokeDasharray="4 3"
              />
              <text
                x={width - RIGHT - 2}
                y={labelY}
                textAnchor="end"
                fontSize={9.5}
                fill={reference.tone === 'critical' ? 'var(--critical)' : 'var(--muted)'}
                fontFamily={AXIS_FONT}
              >
                {reference.label}
              </text>
            </g>
          )
        })}

        <path d={geometry.areaPath} fill="url(#jatayu-mint-fill)" />
        <path d={geometry.path} fill="none" stroke="var(--select)" strokeWidth={2.25} strokeLinejoin="round" strokeLinecap="round" />

        {activePoint ? (
          <g>
            <line
              x1={activeX}
              x2={activeX}
              y1={TOP}
              y2={height - BOTTOM}
              stroke="var(--muted)"
              strokeWidth={1}
              strokeOpacity={0.6}
            />
            <circle cx={activeX} cy={activeY} r={3.2} fill="var(--select)" stroke="var(--panel)" strokeWidth={1.5} />
          </g>
        ) : null}

        <line x1={LEFT} x2={LEFT} y1={TOP} y2={height - BOTTOM} stroke="var(--hair)" strokeWidth={1} />
        <line
          x1={LEFT}
          x2={width - RIGHT}
          y1={height - BOTTOM}
          y2={height - BOTTOM}
          stroke="var(--hair)"
          strokeWidth={1}
        />
        <text
          x={LEFT}
          y={height - 5}
          fontSize={9.5}
          fill="var(--muted)"
          fontFamily={AXIS_FONT}
        >
          {fmtTime(points[0].t)}
        </text>
        <text
          x={width - RIGHT}
          y={height - 5}
          textAnchor="end"
          fontSize={9.5}
          fill="var(--muted)"
          fontFamily={AXIS_FONT}
        >
          {fmtTime(points[points.length - 1].t)}
        </text>
      </svg>

      {activePoint ? (
        <div
          className="pointer-events-none absolute z-10 px-2.5 py-1.5 text-[0.6875rem] font-medium leading-tight"
          style={{
            left: tooltipLeft,
            top: Math.max(0, activeY - 46),
            transform: 'translateX(-50%)',
            background: 'var(--ink)',
            color: 'var(--panel)',
            borderRadius: 10,
            boxShadow: 'var(--shadow)',
            whiteSpace: 'nowrap',
          }}
        >
          <div className="mono font-semibold">{format(activePoint.v)}</div>
          <div className="mt-0.5 opacity-70">{fmtTime(activePoint.t)}</div>
        </div>
      ) : null}
    </div>
  )
}

export function ChartTable({
  points,
  format,
  maxRows = 60,
}: {
  points: ChartPoint[]
  format: (value: number) => string
  maxRows?: number
}) {
  const rows = points.slice(-maxRows).reverse()
  if (!rows.length) return <p className="px-4 py-4 text-[0.71875rem] text-muted">No chart data yet.</p>
  return (
    <div className="max-h-[190px] overflow-y-auto rounded-xl border" style={{ borderColor: 'var(--hair)' }}>
      <table className="data-table">
        <thead>
          <tr>
            <th>Time</th>
            <th className="text-right">Value</th>
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={`${row.t}-${row.v}`}>
              <td className="mono">{fmtTime(row.t)}</td>
              <td className="mono text-right">{format(row.v)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
