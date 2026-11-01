import type { Tone } from './rf'

export interface NextActionInput {
  /** True only when the console is talking to a reachable backend. */
  apiReachable: boolean
  mode: 'connecting' | 'live' | 'demo'
  /** Age in seconds of the last status update. */
  lastUpdateAgeS: number
  source: 'live' | 'simulated' | 'demo' | null
  monitoring: boolean
  esp32Online: boolean
  arduinoOnline: boolean
  openIncidents: number
  gasStatus: string
  gasWarmupRemainingS: number | null
  rfState: string
  apiBase: string
}

export type NextActionKind = 'retry' | 'signal-lab' | 'start' | 'incidents'

export interface NextActionResult {
  key: string
  tone: Tone
  title: string
  detail: string
  action: { kind: NextActionKind; label: string } | null
}

/**
 * The single "what should I do next" rule chain. First match wins.
 * The order is part of the contract in the brief; do not reorder casually.
 */
export function nextAction(input: NextActionInput): NextActionResult {
  const {
    apiReachable,
    mode,
    lastUpdateAgeS,
    source,
    monitoring,
    esp32Online,
    openIncidents,
    gasStatus,
    gasWarmupRemainingS,
    rfState,
    apiBase,
  } = input

  if (!apiReachable || mode === 'demo') {
    return {
      key: 'backend',
      tone: 'serious',
      title: 'Waiting for the backend',
      detail: `Start the backend (python app.py in backend/) or set the API address in Settings. The console is showing demo data until ${apiBase} answers.`,
      action: { kind: 'retry', label: 'Try again' },
    }
  }

  if (mode === 'connecting') {
    return {
      key: 'connecting',
      tone: 'neutral',
      title: 'Connecting to the backend',
      detail: `Checking ${apiBase}. This usually takes a second.`,
      action: { kind: 'retry', label: 'Try again' },
    }
  }

  if (lastUpdateAgeS > 6) {
    return {
      key: 'stale',
      tone: 'serious',
      title: 'Data is stale',
      detail: `The last status update was ${Math.floor(lastUpdateAgeS)} s ago. Values below may be out of date; the console keeps polling.`,
      action: { kind: 'retry', label: 'Retry now' },
    }
  }

  if (source === 'live' && !esp32Online) {
    return {
      key: 'esp32-offline',
      tone: 'serious',
      title: 'The ESP32 is not sending data',
      detail: 'Check the USB data cable, that the 2.4 GHz hotspot is on, the COM port is correct, and no serial monitor is open.',
      action: { kind: 'signal-lab', label: 'Open Signal lab' },
    }
  }

  if (!monitoring) {
    return {
      key: 'monitoring-off',
      tone: 'warning',
      title: 'Start monitoring',
      detail: 'Monitoring is off. Notable observations will not open incidents until it is running.',
      action: { kind: 'start', label: 'Start monitoring' },
    }
  }

  if (openIncidents > 0) {
    return {
      key: 'incidents-open',
      tone: 'warning',
      title: `${openIncidents} ${openIncidents === 1 ? 'incident' : 'incidents'} to review`,
      detail: 'Open the incident, read the evidence, then acknowledge it. Closing requires an acknowledgement first.',
      action: { kind: 'incidents', label: 'Open the incident' },
    }
  }

  if (gasStatus === 'WARMING_UP') {
    const left = gasWarmupRemainingS == null ? null : Math.max(0, Math.ceil(gasWarmupRemainingS))
    return {
      key: `gas-warmup-${left ?? 'x'}`,
      tone: 'warning',
      title: 'The gas sensor is warming up',
      detail: left == null ? 'Readings are not usable until warm-up finishes.' : `About ${left} s left before readings are usable.`,
      action: null,
    }
  }

  if (rfState === 'REVIEW_RECOMMENDED' || rfState === 'PERIODIC_PATTERN_OBSERVED') {
    return {
      key: 'rf-pattern',
      tone: 'serious',
      title: 'A regular RF pattern is being observed',
      detail: 'This is an observation for further investigation, not proof of a person. Review the evidence before acting.',
      action: null,
    }
  }

  if (rfState === 'LOW_QUALITY') {
    return {
      key: 'rf-low-quality',
      tone: 'warning',
      title: 'The signal is too weak to judge',
      detail: 'Signal quality is low. Check antenna placement, distance and the 2.4 GHz link, then let it collect more data.',
      action: { kind: 'signal-lab', label: 'Open Signal lab' },
    }
  }

  return {
    key: 'all-quiet',
    tone: 'good',
    title: 'All quiet',
    detail: 'No open incidents and no notable RF patterns. The console updates automatically.',
    action: null,
  }
}
