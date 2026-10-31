const pad2 = (value: number) => String(value).padStart(2, '0')

export function fmtClock(date: Date): string {
  return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
}

function asDate(value: number | string | null | undefined): Date | null {
  if (value == null) return null
  if (typeof value === 'number') return new Date(value * 1000)
  const parsed = new Date(value)
  return Number.isNaN(parsed.getTime()) ? null : parsed
}

export function fmtTime(value: number | string | null | undefined): string {
  const date = asDate(value)
  if (!date) return '—'
  const now = new Date()
  const sameDay = date.toDateString() === now.toDateString()
  if (sameDay) return `${pad2(date.getHours())}:${pad2(date.getMinutes())}:${pad2(date.getSeconds())}`
  return `${pad2(date.getDate())}/${pad2(date.getMonth() + 1)} ${pad2(date.getHours())}:${pad2(date.getMinutes())}`
}

export function fmtAge(value: number | string | null | undefined, nowMs = Date.now()): string {
  const date = asDate(value)
  if (!date) return 'no update yet'
  const seconds = Math.max(0, Math.round((nowMs - date.getTime()) / 1000))
  if (seconds < 2) return 'just now'
  if (seconds < 60) return `${seconds} s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  const hours = Math.round(minutes / 60)
  if (hours < 48) return `${hours} h ago`
  return `${Math.round(hours / 24)} d ago`
}

export function fmtAgeFromSeconds(seconds: number): string {
  if (seconds < 2) return 'just now'
  if (seconds < 60) return `${Math.round(seconds)} s ago`
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) return `${minutes} min ago`
  return `${Math.round(minutes / 60)} h ago`
}

export function secondsSince(ms: number | null, nowMs = Date.now()): number {
  if (ms == null) return Infinity
  return Math.max(0, (nowMs - ms) / 1000)
}

export function fmtNumber(value: number | null | undefined, digits = 0): string {
  if (value == null || Number.isNaN(value)) return '—'
  return value.toLocaleString('en-GB', {
    minimumFractionDigits: digits,
    maximumFractionDigits: digits,
  })
}

export function fmtRatio(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—'
  return `${(value * 100).toFixed(value >= 0.1 ? 0 : 1)}%`
}

export function fmtScore(value: number | null | undefined): string {
  if (value == null || Number.isNaN(value)) return '—'
  return value.toFixed(2)
}

export function clamp(value: number, low: number, high: number): number {
  return Math.max(low, Math.min(high, value))
}

export function plural(count: number, one: string, many = `${one}s`): string {
  return count === 1 ? one : many
}

const ACRONYMS: Array<[RegExp, string]> = [
  [/\brf\b/g, 'RF'],
  [/\besp32\b/g, 'ESP32'],
  [/\blcd\b/g, 'LCD'],
  [/\bcsi\b/g, 'CSI'],
  [/\badc\b/g, 'ADC'],
  [/\bco2\b/g, 'CO₂'],
  [/\brx\b/g, 'RX'],
  [/\btx\b/g, 'TX'],
]

export function sentence(value: string): string {
  const text = String(value).toLowerCase().replaceAll('_', ' ').replace(/\s+/g, ' ').trim()
  const cased = ACRONYMS.reduce((current, [pattern, replacement]) => current.replace(pattern, replacement), text)
  return cased.charAt(0).toUpperCase() + cased.slice(1)
}

export function summarisePayload(payload: unknown, max = 140): string {
  if (payload == null) return ''
  if (typeof payload === 'string') return payload.slice(0, max)
  try {
    const text = JSON.stringify(payload)
    return text.length > max ? `${text.slice(0, max - 1)}…` : text
  } catch {
    return ''
  }
}
