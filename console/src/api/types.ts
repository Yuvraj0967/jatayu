export type Mode = 'connecting' | 'live' | 'demo'

export type RfStateName =
  | 'NO_DATA'
  | 'COLLECTING'
  | 'INSUFFICIENT_DATA'
  | 'LOW_QUALITY'
  | 'NO_CLEAR_PERIODIC_PATTERN'
  | 'PERIODIC_PATTERN_OBSERVED'
  | 'REVIEW_RECOMMENDED'

export type DataQuality = 'none' | 'low' | 'fair' | 'good'

export type Confidence = 'Insufficient data' | 'Low' | 'Moderate' | 'High'

export interface RfFeatures {
  rhythm: number
  focus: number
  strength: number
  dominant_rate_per_min: number
  motion_index: number
  packet_rate_hz: number
  packet_loss_ratio: number
  rssi: number
}

export interface RfState {
  state: RfStateName
  text?: string
  data_quality: DataQuality
  confidence: Confidence | string
  periodicity_score: number
  pattern_seconds: number
  features: RfFeatures
}

export type EnvironmentStatus = 'NO_DATA' | 'WARMING_UP' | 'BASELINING' | 'NORMAL' | 'ELEVATED' | 'STALE'

export interface EnvironmentState {
  status: EnvironmentStatus
  data_quality?: string
  raw_adc: number | null
  unit: 'adc_counts'
  baseline_adc: number | null
  threshold_adc: number | null
  model: string
  calibration: string
  warmup_remaining_s: number | null
  age_s: number | null
  disclaimer?: string
}

export interface ArduinoLink {
  state: string
  port: string | null
  error: string | null
  messages_rejected: number
  last_rejected: string | null
  kind: string
}

export interface CsiLink {
  state: string
  port: string | null
  error: string | null
  packet_rate_hz: number
  sequence: { received: number; lost: number; loss_ratio: number }
}

export interface LastKey {
  key: string
  action: string
  at: number
}

export interface Status {
  type: 'jatayu'
  source: 'simulated' | 'live'
  monitoring: boolean
  devices: { esp32: 'online' | 'offline'; arduino: 'online' | 'offline' }
  rf: RfState
  environment: EnvironmentState
  last_key: LastKey | null
  lcd_page: string
  incident_counts: { open: number; acknowledged: number; closed: number }
  performance: { tick_ms: number }
  server_time: number
  arduino_link?: ArduinoLink | null
  csi_link?: CsiLink | null
}

export interface RfHistoryPoint {
  recorded_at: number
  pattern_state: string
  signal_quality: string
  confidence: string
  periodicity_score: number
  features?: Partial<RfFeatures>
  source?: string
}

export interface Reading {
  recorded_at: number
  raw_value: number
  unit: string
  quality_status: string
  source?: string
}

export type IncidentStatus = 'open' | 'acknowledged' | 'closed'

export interface Incident {
  id: number
  incident_code: string
  status: IncidentStatus
  summary: string
  source: string
  created_at: number
  updated_at: number
}

export interface Observation {
  id: number
  observation_type: string
  detail: string
  created_at: number
}

export interface Acknowledgement {
  operator_action: string
  notes: string | null
  channel: string
  acknowledged_at: number
}

export interface EventItem {
  id: number
  incident_id: number | null
  event_type: string
  actor: string
  payload: unknown
  created_at: number
}

export interface IncidentDetail extends Incident {
  observations: Observation[]
  events: EventItem[]
  acknowledgements: Acknowledgement[]
}

export type CommandState =
  | 'created'
  | 'sent'
  | 'received'
  | 'executed'
  | 'acknowledged'
  | 'failed'
  | 'timed_out'

export interface Command {
  id: string
  name: string
  target: string
  args: Record<string, unknown> | null
  state: CommandState
  created_at: number
  sent_at: number | null
  received_at: number | null
  executed_at: number | null
  acknowledged_at: number | null
  failure: string | null
}

export interface NodeRecord {
  node_id: string
  role: string
  x_m: number
  y_m: number
  z_m: number
  orientation_deg: number
  antenna: string
  notes: string
  firmware: string
  channel: number
  source: string
  first_seen_at: number
  last_seen_at: number
}

export interface InspectionResult {
  incident_id: number
  command: Command
}

export interface NodePatch {
  x_m: number
  y_m: number
  z_m: number
  orientation_deg: number
  antenna: string
  notes?: string
  role?: string
}
