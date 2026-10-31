export type Tone = 'good' | 'warning' | 'serious' | 'critical' | 'neutral'

export type RfStateName =
  | 'NO_DATA'
  | 'COLLECTING'
  | 'INSUFFICIENT_DATA'
  | 'LOW_QUALITY'
  | 'NO_CLEAR_PERIODIC_PATTERN'
  | 'PERIODIC_PATTERN_OBSERVED'
  | 'REVIEW_RECOMMENDED'

export type GasStatus = 'NO_DATA' | 'WARMING_UP' | 'BASELINING' | 'NORMAL' | 'ELEVATED' | 'STALE'

export type CommandState =
  | 'created'
  | 'sent'
  | 'received'
  | 'executed'
  | 'acknowledged'
  | 'failed'
  | 'timed_out'

export const RF_SHORT: Record<string, string> = {
  NO_DATA: 'No data',
  COLLECTING: 'Collecting',
  INSUFFICIENT_DATA: 'Insufficient data',
  LOW_QUALITY: 'Low quality',
  NO_CLEAR_PERIODIC_PATTERN: 'No clear pattern',
  PERIODIC_PATTERN_OBSERVED: 'Periodic pattern',
  REVIEW_RECOMMENDED: 'Review recommended',
}

export const RF_SENTENCE: Record<string, string> = {
  NO_DATA: 'No CSI packets are available yet.',
  COLLECTING: 'Collecting packets. A pattern judgement needs more data.',
  INSUFFICIENT_DATA: 'There is not enough clean data to judge the signal.',
  LOW_QUALITY: 'The signal is too weak or inconsistent to judge.',
  NO_CLEAR_PERIODIC_PATTERN: 'No clear periodic RF pattern is present in the recent window.',
  PERIODIC_PATTERN_OBSERVED: 'A periodic RF pattern is being observed. Further investigation is recommended.',
  REVIEW_RECOMMENDED: 'A regular RF pattern held long enough to warrant a human review.',
}

export const RF_TONE: Record<string, Tone> = {
  NO_DATA: 'neutral',
  COLLECTING: 'neutral',
  INSUFFICIENT_DATA: 'neutral',
  LOW_QUALITY: 'warning',
  NO_CLEAR_PERIODIC_PATTERN: 'good',
  PERIODIC_PATTERN_OBSERVED: 'warning',
  REVIEW_RECOMMENDED: 'serious',
}

export const GAS_TONE: Record<string, Tone> = {
  NO_DATA: 'neutral',
  WARMING_UP: 'warning',
  BASELINING: 'neutral',
  NORMAL: 'good',
  ELEVATED: 'serious',
  STALE: 'neutral',
}

export const COMMAND_TONE: Record<string, Tone> = {
  created: 'neutral',
  sent: 'neutral',
  received: 'neutral',
  executed: 'good',
  acknowledged: 'good',
  failed: 'critical',
  timed_out: 'serious',
}

export const INCIDENT_TONE: Record<string, Tone> = {
  open: 'warning',
  acknowledged: 'neutral',
  closed: 'good',
}

export const TONE_VAR: Record<Tone, string> = {
  good: 'var(--good)',
  warning: 'var(--warning)',
  serious: 'var(--serious)',
  critical: 'var(--critical)',
  neutral: 'var(--muted)',
}

export const COMMAND_LABEL: Record<string, string> = {
  timed_out: 'timed out',
}

export function rfSentence(state: string, serverText?: string | null): string {
  if (serverText && serverText.trim()) return serverText.trim()
  return RF_SENTENCE[state] ?? 'RF state is not available.'
}

export function gasLabel(status: string): string {
  const labels: Record<string, string> = {
    NO_DATA: 'No data',
    WARMING_UP: 'Warming up',
    BASELINING: 'Baselining',
    NORMAL: 'Normal',
    ELEVATED: 'Elevated',
    STALE: 'Stale',
  }
  return labels[status] ?? status
}

export function commandLabel(state: string): string {
  return COMMAND_LABEL[state] ?? state
}

export function confidenceTone(confidence: string): Tone {
  if (confidence === 'High') return 'good'
  if (confidence === 'Moderate') return 'neutral'
  if (confidence === 'Low') return 'warning'
  return 'neutral'
}

export function dataQualityTone(quality: string): Tone {
  if (quality === 'good') return 'good'
  if (quality === 'fair') return 'warning'
  if (quality === 'low') return 'warning'
  return 'neutral'
}
