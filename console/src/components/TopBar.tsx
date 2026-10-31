import { useEffect, useState } from 'react'
import type { FeedIndicator } from '../api/useJatayu'
import { secondsSince } from '../lib/format'
import { fmtClock } from '../lib/format'
import { IconGear, IconMoon, IconPlay, IconStop, IconSun } from './Icons'

interface TopBarProps {
  feedState: FeedIndicator
  source: 'live' | 'simulated' | null
  updatedAt: number | null
  monitoring: boolean
  busy: boolean
  dark: boolean
  onToggleMonitoring: () => void
  onToggleTheme: () => void
  onOpenSettings: () => void
}

const FEED_LABEL: Record<FeedIndicator, string> = {
  connecting: 'connecting',
  live: 'live feed',
  polling: 'polling',
  lost: 'feed lost, polling',
  demo: 'local demo',
}

function feedColor(state: FeedIndicator): string {
  if (state === 'live') return 'var(--good)'
  if (state === 'lost') return 'var(--critical)'
  if (state === 'demo') return 'var(--warning)'
  if (state === 'polling') return 'var(--warning)'
  return 'var(--muted)'
}

export function TopBar({
  feedState,
  source,
  updatedAt,
  monitoring,
  busy,
  dark,
  onToggleMonitoring,
  onToggleTheme,
  onOpenSettings,
}: TopBarProps) {
  const [now, setNow] = useState(() => Date.now())

  useEffect(() => {
    const timer = window.setInterval(() => setNow(Date.now()), 1000)
    return () => window.clearInterval(timer)
  }, [])

  const age = updatedAt == null ? null : secondsSince(updatedAt, now)
  const ageText =
    age == null ? 'no update yet' : age < 1.5 ? 'updated just now' : `updated ${Math.round(age)} s ago`

  const demo = feedState === 'demo'

  return (
    <header
      className="sticky top-0 z-40 w-full border-b backdrop-blur"
      style={{
        background: 'color-mix(in srgb, var(--band) 94%, transparent)',
        borderColor: 'var(--hair)',
        color: 'var(--band-ink)',
      }}
    >
      <div className="mx-auto flex min-h-[62px] max-w-page flex-wrap items-center gap-x-4 gap-y-2 px-3 py-2.5 sm:px-6">
        <div className="flex flex-wrap items-baseline gap-x-3 gap-y-0.5">
          <span className="font-display text-[0.9375rem] font-bold leading-none tracking-[0.14em]">JATAYU</span>
          <span className="text-[0.71875rem] leading-none text-muted">Site monitoring console · experimental prototype</span>
        </div>

        <div className="ml-auto flex flex-wrap items-center justify-end gap-x-3 gap-y-2">
          {!demo ? (
            <span className="inline-flex items-center gap-1.5 text-[0.71875rem] font-medium text-muted">
              <span
                className="inline-block h-[7px] w-[7px] rounded-full"
                style={{ background: feedColor(feedState) }}
                aria-hidden="true"
              />
              {FEED_LABEL[feedState]}
            </span>
          ) : null}

          <span className="hidden items-center gap-2 sm:inline-flex" aria-label={`Local time ${fmtClock(new Date(now))}`}>
            <span className="mono text-[0.75rem] font-semibold tabular-nums">{fmtClock(new Date(now))}</span>
            <span className="text-[0.6875rem] text-muted">{ageText}</span>
          </span>

          {demo ? (
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[0.6875rem] font-semibold leading-tight"
              style={{
                color: 'var(--warning)',
                background: 'color-mix(in srgb, var(--warning) 14%, var(--panel))',
              }}
              title="The API is unreachable. Values on this page are generated locally."
            >
              <span
                className="inline-block h-[6px] w-[6px] rounded-full"
                style={{ background: 'var(--warning)' }}
                aria-hidden="true"
              />
              Demo data
            </span>
          ) : (
            <span
              className="inline-flex items-center gap-1.5 rounded-full px-2.5 py-[3px] text-[0.6875rem] font-semibold leading-tight"
              style={{
                color: source === 'simulated' ? 'var(--muted)' : 'var(--mint-deep)',
                background: source === 'simulated' ? 'var(--panel2)' : 'var(--mint-soft)',
              }}
              title="Where the live values come from"
            >
              <span
                className="inline-block h-[6px] w-[6px] rounded-full"
                style={{ background: source === 'simulated' ? 'var(--muted)' : 'var(--good)' }}
                aria-hidden="true"
              />
              {source === 'simulated' ? 'Simulated' : source === 'live' ? 'Live' : 'Connecting'}
            </span>
          )}

          <div className="flex items-center gap-1">
            <button
              type="button"
              className="btn btn-quiet h-9 w-9 !px-0"
              onClick={onOpenSettings}
              aria-label="Open settings"
              title="Settings: API address"
            >
              <IconGear size={16} />
            </button>
            <button
              type="button"
              className="btn btn-quiet h-9 w-9 !px-0"
              onClick={onToggleTheme}
              aria-label={dark ? 'Switch to light theme' : 'Switch to dark theme'}
              title={dark ? 'Switch to light theme' : 'Switch to dark theme'}
            >
              {dark ? <IconSun size={16} /> : <IconMoon size={16} />}
            </button>
          </div>

          <button
            type="button"
            className="btn btn-primary h-10 px-4"
            data-tour="monitoring-button"
            onClick={onToggleMonitoring}
            disabled={busy}
            aria-label={monitoring ? 'Stop monitoring' : 'Start monitoring'}
          >
            {monitoring ? <IconStop size={12} /> : <IconPlay size={12} />}
            {monitoring ? 'Stop monitoring' : 'Start monitoring'}
          </button>
        </div>
      </div>
    </header>
  )
}
