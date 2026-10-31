import { ApiError } from './client'
import type {
  Acknowledgement,
  Command,
  EventItem,
  Incident,
  IncidentDetail,
  InspectionResult,
  NodePatch,
  NodeRecord,
  Observation,
  Reading,
  RfHistoryPoint,
  Status,
} from './types'

const KEY_ACTIONS: Record<string, string> = {
  '1': 'START_MONITORING',
  '2': 'STOP_MONITORING',
  '3': 'SHOW_SENSOR_STATUS',
  '4': 'REQUEST_INSPECTION',
  '5': 'SHOW_RF_STATUS',
  '6': 'SHOW_SYSTEM_STATUS',
  '7': 'SHOW_INCIDENT_SUMMARY',
  '8': 'ACKNOWLEDGE',
  '9': 'DIAGNOSTICS',
  '0': 'CANCEL',
  '*': 'ALERT_REQUEST',
  '#': 'CONFIRM',
}

const LCD_PAGES: Record<string, string> = {
  '1': 'MONITORING',
  '2': 'IDLE',
  '3': 'SENSOR STATUS',
  '4': 'INSPECTION REQUEST',
  '5': 'RF STATUS',
  '6': 'SYSTEM STATUS',
  '7': 'INCIDENT SUMMARY',
  '8': 'ACKNOWLEDGE',
  '9': 'DIAGNOSTICS',
  '0': 'CANCELLED',
  '*': 'ALERT',
  '#': 'CONFIRM',
}

const clamp = (value: number, low: number, high: number) => Math.max(low, Math.min(high, value))
const noise = (scale: number) => (Math.random() - 0.5) * 2 * scale

interface RfPhase {
  state: 'COLLECTING' | 'NO_CLEAR_PERIODIC_PATTERN' | 'PERIODIC_PATTERN_OBSERVED' | 'REVIEW_RECOMMENDED'
  quality: 'low' | 'fair' | 'good'
  confidence: 'Insufficient data' | 'Low' | 'Moderate'
  score: number
  patternSeconds: number
}

function rfPhase(elapsed: number): RfPhase {
  const phase = ((elapsed % 60) + 60) % 60
  if (phase < 8) {
    return { state: 'COLLECTING', quality: 'low', confidence: 'Insufficient data', score: 0.08 + phase * 0.008, patternSeconds: 0 }
  }
  if (phase < 26) {
    return {
      state: 'NO_CLEAR_PERIODIC_PATTERN',
      quality: 'fair',
      confidence: 'Low',
      score: 0.28 + 0.1 * Math.sin(phase / 3),
      patternSeconds: 0,
    }
  }
  if (phase < 34) {
    return {
      state: 'NO_CLEAR_PERIODIC_PATTERN',
      quality: 'good',
      confidence: 'Moderate',
      score: 0.4 + 0.06 * Math.sin(phase / 2.5),
      patternSeconds: 0,
    }
  }
  if (phase < 52) {
    return {
      state: 'PERIODIC_PATTERN_OBSERVED',
      quality: 'good',
      confidence: 'Moderate',
      score: 0.68 + 0.05 * Math.sin(phase / 2),
      patternSeconds: phase - 34,
    }
  }
  if (phase < 58) {
    return {
      state: 'REVIEW_RECOMMENDED',
      quality: 'good',
      confidence: 'Moderate',
      score: 0.78 + 0.04 * Math.sin(phase / 2),
      patternSeconds: phase - 34,
    }
  }
  return {
    state: 'NO_CLEAR_PERIODIC_PATTERN',
    quality: 'fair',
    confidence: 'Low',
    score: 0.46,
    patternSeconds: 0,
  }
}

export interface DemoSnapshot {
  status: Status
  incidents: Incident[]
  events: EventItem[]
  commands: Command[]
  nodes: NodeRecord[]
  rfHistory: RfHistoryPoint[]
  envHistory: Reading[]
}

export class DemoEngine {
  private startedAt = Date.now() / 1000
  private timer: number | null = null
  private timers: number[] = []
  private listeners = new Set<() => void>()

  private monitoring = true
  private lastKey: Status['last_key'] = null
  private lcdPage = 'STATUS'
  private gasOffset = 0
  private baseline = 312
  private threshold = 420
  private tickMs = 41
  private nextIncidentId = 3
  private nextEventId = 8
  private nextObservationId = 3

  private rfHistory: RfHistoryPoint[] = []
  private envHistory: Reading[] = []
  private incidents: Incident[] = []
  private observations = new Map<number, Observation[]>()
  private acknowledgements = new Map<number, Acknowledgement[]>()
  private events: EventItem[] = []
  private commands: Command[] = []
  private nodes: NodeRecord[] = []
  private lastRfState = ''

  constructor() {
    const now = Date.now() / 1000
    const t0 = this.startedAt

    this.incidents = [
      {
        id: 1,
        incident_code: 'INC-0001',
        status: 'open',
        summary: 'Periodic RF pattern observed; operator review requested',
        source: 'system',
        created_at: now - 480,
        updated_at: now - 60,
      },
      {
        id: 2,
        incident_code: 'INC-0002',
        status: 'acknowledged',
        summary: 'Gas reading elevated above baseline (raw ADC counts)',
        source: 'system',
        created_at: now - 2000,
        updated_at: now - 900,
      },
    ]

    this.observations.set(1, [
      {
        id: 1,
        observation_type: 'RF_OBSERVATION',
        detail:
          'Periodicity score 0.71 held for 20 s. Signal quality good, confidence moderate. Further investigation recommended; this is not proof of a person.',
        created_at: now - 470,
      },
    ])
    this.observations.set(2, [
      {
        id: 2,
        observation_type: 'GAS_READING',
        detail: 'Raw ADC 438 above baseline 312. Uncalibrated sensor counts, not ppm.',
        created_at: now - 1990,
      },
    ])
    this.acknowledgements.set(1, [])
    this.acknowledgements.set(2, [
      {
        operator_action: 'ACKNOWLEDGED',
        notes: 'Checked the raw ADC trend; no action taken.',
        channel: 'console',
        acknowledged_at: now - 900,
      },
    ])

    this.events = [
      { id: 7, incident_id: null, event_type: 'MONITORING_STARTED', actor: 'operator', payload: {}, created_at: now - 30 },
      { id: 6, incident_id: 1, event_type: 'RF_PATTERN_OBSERVED', actor: 'system', payload: { periodicity_score: 0.71, window_s: 20 }, created_at: now - 80 },
      { id: 5, incident_id: null, event_type: 'COMMAND_ACKNOWLEDGED', actor: 'operator', payload: { command_id: 'cmd-demo-0002' }, created_at: now - 300 },
      { id: 4, incident_id: 2, event_type: 'INCIDENT_ACKNOWLEDGED', actor: 'operator', payload: { operator_action: 'ACKNOWLEDGED' }, created_at: now - 900 },
      { id: 3, incident_id: 2, event_type: 'INCIDENT_CREATED', actor: 'system', payload: { summary: 'Gas reading elevated above baseline' }, created_at: now - 2000 },
      { id: 2, incident_id: 1, event_type: 'INCIDENT_CREATED', actor: 'system', payload: { summary: 'Periodic RF pattern observed' }, created_at: now - 480 },
      { id: 1, incident_id: null, event_type: 'COMMAND_SENT', actor: 'backend', payload: { command_id: 'cmd-demo-0002', name: 'LCD_SHOW' }, created_at: now - 400 },
    ]

    this.commands = [
      {
        id: 'cmd-demo-0002',
        name: 'LCD_SHOW',
        target: 'arduino',
        args: { line1: 'JATAYU READY', line2: 'MONITORING' },
        state: 'acknowledged',
        created_at: now - 420,
        sent_at: now - 415,
        received_at: now - 405,
        executed_at: now - 360,
        acknowledged_at: now - 300,
        failure: null,
      },
      {
        id: 'cmd-demo-0001',
        name: 'PING',
        target: 'arduino',
        args: {},
        state: 'acknowledged',
        created_at: now - 700,
        sent_at: now - 695,
        received_at: now - 690,
        executed_at: now - 680,
        acknowledged_at: now - 650,
        failure: null,
      },
    ]

    this.nodes = [
      {
        node_id: 'esp32-rx-01',
        role: 'esp32_rx',
        x_m: 0,
        y_m: 0,
        z_m: 1.2,
        orientation_deg: 90,
        antenna: 'PCB inverted-F',
        notes: 'Tripod at the entry, antenna facing the corridor',
        firmware: 'rescue-sense-csi 0.3',
        channel: 6,
        source: 'simulated',
        first_seen_at: now - 3600,
        last_seen_at: now - 1,
      },
    ]

    for (let i = 89; i >= 0; i -= 1) {
      const at = now - i
      const elapsed = at - t0
      const phase = rfPhase(elapsed)
      this.rfHistory.push({
        recorded_at: at,
        pattern_state: phase.state,
        signal_quality: phase.quality,
        confidence: phase.confidence,
        periodicity_score: clamp(phase.score + noise(0.015), 0, 1),
        source: 'simulated',
      })
      this.envHistory.push({
        recorded_at: at,
        raw_value: clamp(310 + 5 * Math.sin(elapsed / 5) + noise(3), 0, 1023),
        unit: 'adc_counts',
        quality_status: elapsed < 28 ? 'WARMING_UP' : 'NORMAL',
        source: 'simulated',
      })
    }
  }

  subscribe(listener: () => void): () => void {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  private notify(): void {
    for (const listener of this.listeners) listener()
  }

  start(): void {
    if (this.timer != null) return
    this.timer = window.setInterval(() => this.tick(), 1000)
    this.tick()
  }

  stop(): void {
    if (this.timer != null) window.clearInterval(this.timer)
    this.timer = null
    for (const timer of this.timers) window.clearTimeout(timer)
    this.timers = []
  }

  private elapsed(): number {
    return Date.now() / 1000 - this.startedAt
  }

  private tick(): void {
    const now = Date.now() / 1000
    const elapsed = this.elapsed()
    const phase = rfPhase(elapsed)

    if (phase.state !== this.lastRfState) {
      this.lastRfState = phase.state
      if (this.monitoring && phase.state === 'PERIODIC_PATTERN_OBSERVED') {
        this.addEvent(null, 'RF_PATTERN_OBSERVED', 'system', {
          periodicity_score: Number(phase.score.toFixed(2)),
          window_s: 20,
        }, now)
      }
      if (this.monitoring && phase.state === 'REVIEW_RECOMMENDED') {
        this.addEvent(null, 'RF_REVIEW_RECOMMENDED', 'system', { periodicity_score: Number(phase.score.toFixed(2)) }, now)
      }
    }

    const score = clamp(phase.score + noise(0.02), 0, 1)
    const packetRate = 96 + 4 * Math.sin(elapsed / 4) + noise(1.5)
    const packetLoss = clamp(0.02 + 0.01 * Math.sin(elapsed / 7) + noise(0.004), 0, 0.2)
    const rssi = -58 + 2.5 * Math.sin(elapsed / 6) + noise(0.8)

    this.rfHistory.push({
      recorded_at: now,
      pattern_state: phase.state,
      signal_quality: phase.quality,
      confidence: phase.confidence,
      periodicity_score: score,
      source: 'simulated',
    })
    if (this.rfHistory.length > 240) this.rfHistory.shift()

    const raw = clamp(310 + this.gasOffset + 6 * Math.sin(elapsed / 5) + noise(3), 0, 1023)
    let gasStatus: Status['environment']['status'] = 'NORMAL'
    let warmupRemaining: number | null = null
    if (elapsed < 28) {
      gasStatus = 'WARMING_UP'
      warmupRemaining = Math.max(0, 28 - elapsed)
    } else if (elapsed < 34) {
      gasStatus = 'BASELINING'
    } else if (raw >= this.threshold) {
      gasStatus = 'ELEVATED'
    }

    this.envHistory.push({
      recorded_at: now,
      raw_value: Math.round(raw),
      unit: 'adc_counts',
      quality_status: gasStatus,
      source: 'simulated',
    })
    if (this.envHistory.length > 300) this.envHistory.shift()

    this.nodes[0].last_seen_at = now
    this.tickMs = 36 + Math.round(Math.random() * 10)
    this.notify()
  }

  private addEvent(
    incidentId: number | null,
    type: string,
    actor: string,
    payload: unknown,
    at = Date.now() / 1000,
  ): EventItem {
    const event: EventItem = {
      id: this.nextEventId++,
      incident_id: incidentId,
      event_type: type,
      actor,
      payload,
      created_at: at,
    }
    this.events.unshift(event)
    if (this.events.length > 120) this.events.pop()
    return event
  }

  private currentGas(): { status: Status['environment']['status']; raw: number; warmup: number | null } {
    const elapsed = this.elapsed()
    const raw = clamp(310 + this.gasOffset + 6 * Math.sin(elapsed / 5) + noise(3), 0, 1023)
    if (elapsed < 28) return { status: 'WARMING_UP', raw, warmup: Math.max(0, 28 - elapsed) }
    if (elapsed < 34) return { status: 'BASELINING', raw, warmup: null }
    return { status: raw >= this.threshold ? 'ELEVATED' : 'NORMAL', raw, warmup: null }
  }

  status(): Status {
    const now = Date.now() / 1000
    const phase = rfPhase(this.elapsed())
    const gas = this.currentGas()
    const open = this.incidents.filter((i) => i.status === 'open').length
    const acknowledged = this.incidents.filter((i) => i.status === 'acknowledged').length
    const closed = this.incidents.filter((i) => i.status === 'closed').length
    const packetRate = 96 + 4 * Math.sin(this.elapsed() / 4)

    return {
      type: 'jatayu',
      source: 'simulated',
      monitoring: this.monitoring,
      devices: { esp32: 'online', arduino: 'online' },
      rf: {
        state: phase.state,
        text:
          phase.state === 'REVIEW_RECOMMENDED'
            ? 'A regular RF pattern held long enough to warrant a human review. This is an observation, not proof of a person.'
            : phase.state === 'PERIODIC_PATTERN_OBSERVED'
              ? 'A periodic RF pattern is being observed. Further investigation is recommended.'
              : phase.state === 'NO_CLEAR_PERIODIC_PATTERN'
                ? 'No clear periodic RF pattern is present in the recent window.'
                : 'Collecting packets; a pattern judgement needs more data.',
        data_quality: phase.quality,
        confidence: phase.confidence,
        periodicity_score: Number(phase.score.toFixed(2)),
        pattern_seconds: Math.round(phase.patternSeconds),
        features: {
          rhythm: 0.62,
          focus: 0.54,
          strength: 0.71,
          dominant_rate_per_min: 14 + 1.5 * Math.sin(this.elapsed() / 9),
          motion_index: 0.18,
          packet_rate_hz: packetRate,
          packet_loss_ratio: 0.02,
          rssi: -58,
        },
      },
      environment: {
        status: gas.status,
        data_quality: gas.status === 'WARMING_UP' ? 'low' : 'fair',
        raw_adc: Math.round(gas.raw),
        unit: 'adc_counts',
        baseline_adc: this.baseline,
        threshold_adc: this.threshold,
        model: 'MQ-series analog sensor',
        calibration: 'NOT_CALIBRATED',
        warmup_remaining_s: gas.warmup,
        age_s: 0,
        disclaimer: 'Raw ADC counts from an uncalibrated sensor. Not ppm and no gas is named.',
      },
      last_key: this.lastKey,
      lcd_page: this.lcdPage,
      incident_counts: { open, acknowledged, closed },
      performance: { tick_ms: this.tickMs },
      server_time: now,
      arduino_link: {
        state: 'open',
        port: 'COM7',
        error: null,
        messages_rejected: 0,
        last_rejected: null,
        kind: 'simulated',
      },
      csi_link: {
        state: 'open',
        port: 'simulated',
        error: null,
        packet_rate_hz: packetRate,
        sequence: { received: 18420, lost: 61, loss_ratio: 0.003 },
      },
    }
  }

  snapshot(): DemoSnapshot {
    return {
      status: this.status(),
      incidents: [...this.incidents],
      events: [...this.events],
      commands: [...this.commands],
      nodes: [...this.nodes],
      rfHistory: [...this.rfHistory],
      envHistory: [...this.envHistory],
    }
  }

  getDetail(id: number): IncidentDetail | null {
    const incident = this.incidents.find((i) => i.id === id)
    if (!incident) return null
    return {
      ...incident,
      observations: [...(this.observations.get(id) ?? [])],
      events: this.events.filter((e) => e.incident_id === id).slice(0, 50),
      acknowledgements: [...(this.acknowledgements.get(id) ?? [])],
    }
  }

  async startMonitoring(): Promise<void> {
    if (!this.monitoring) {
      this.monitoring = true
      this.lcdPage = 'MONITORING'
      this.addEvent(null, 'MONITORING_STARTED', 'operator', {})
      this.tick()
    }
  }

  async stopMonitoring(): Promise<void> {
    if (this.monitoring) {
      this.monitoring = false
      this.lcdPage = 'IDLE'
      this.addEvent(null, 'MONITORING_STOPPED', 'operator', {})
      this.tick()
    }
  }

  async requestInspection(notes?: string): Promise<InspectionResult> {
    const now = Date.now() / 1000
    const incident: Incident = {
      id: this.nextIncidentId++,
      incident_code: `INC-${String(this.nextIncidentId - 1).padStart(4, '0')}`,
      status: 'open',
      summary: 'Physical inspection requested by operator',
      source: 'operator',
      created_at: now,
      updated_at: now,
    }
    this.incidents.unshift(incident)
    this.observations.set(incident.id, [
      {
        id: this.nextObservationId++,
        observation_type: 'INSPECTION_REQUEST',
        detail: notes?.trim() ? notes.trim() : 'Operator requested a physical inspection from the console.',
        created_at: now,
      },
    ])
    this.acknowledgements.set(incident.id, [])
    this.addEvent(incident.id, 'INCIDENT_CREATED', 'operator', { summary: incident.summary }, now)
    this.addEvent(incident.id, 'INSPECTION_REQUESTED', 'operator', { notes: notes ?? null }, now)

    const command: Command = {
      id: `cmd-demo-${String(this.commands.length + 3).padStart(4, '0')}`,
      name: 'LCD_SHOW',
      target: 'arduino',
      args: { line1: 'INSPECTION', line2: incident.incident_code },
      state: 'created',
      created_at: now,
      sent_at: null,
      received_at: null,
      executed_at: null,
      acknowledged_at: null,
      failure: null,
    }
    this.commands.unshift(command)
    this.addEvent(incident.id, 'COMMAND_CREATED', 'backend', { command_id: command.id, name: command.name }, now)

    const advance = (state: Command['state'], delay: number) => {
      this.timers.push(
        window.setTimeout(() => {
          command.state = state
          const stamp = Date.now() / 1000
          if (state === 'sent') command.sent_at = stamp
          if (state === 'received') command.received_at = stamp
          if (state === 'executed') command.executed_at = stamp
          if (state === 'acknowledged') command.acknowledged_at = stamp
          this.addEvent(incident.id, `COMMAND_${state.toUpperCase()}`, state === 'acknowledged' ? 'operator' : 'arduino', { command_id: command.id }, stamp)
          this.notify()
        }, delay),
      )
    }
    advance('sent', 600)
    advance('received', 1400)
    advance('executed', 2600)
    advance('acknowledged', 4000)

    this.tick()
    return { incident_id: incident.id, command }
  }

  async createIncident(summary: string): Promise<Incident> {
    const text = summary.trim()
    if (text.length < 3) throw new ApiError('Summary must be at least 3 characters.', 422)
    if (text.length > 200) throw new ApiError('Summary must be 200 characters or fewer.', 422)
    const now = Date.now() / 1000
    const incident: Incident = {
      id: this.nextIncidentId++,
      incident_code: `INC-${String(this.nextIncidentId - 1).padStart(4, '0')}`,
      status: 'open',
      summary: text,
      source: 'operator',
      created_at: now,
      updated_at: now,
    }
    this.incidents.unshift(incident)
    this.observations.set(incident.id, [])
    this.acknowledgements.set(incident.id, [])
    this.addEvent(incident.id, 'INCIDENT_CREATED', 'operator', { summary: text }, now)
    this.tick()
    return incident
  }

  async addNote(id: number, text: string): Promise<void> {
    const incident = this.incidents.find((i) => i.id === id)
    if (!incident) throw new ApiError('Incident not found.', 404)
    const body = text.trim()
    if (!body) throw new ApiError('Note must not be empty.', 422)
    const now = Date.now() / 1000
    const list = this.observations.get(id) ?? []
    list.push({
      id: this.nextObservationId++,
      observation_type: 'OPERATOR_NOTE',
      detail: body,
      created_at: now,
    })
    this.observations.set(id, list)
    incident.updated_at = now
    this.addEvent(id, 'NOTE_ADDED', 'operator', { text: body }, now)
    this.tick()
  }

  async acknowledge(id: number, notes?: string): Promise<void> {
    const incident = this.incidents.find((i) => i.id === id)
    if (!incident) throw new ApiError('Incident not found.', 404)
    if (incident.status !== 'open') throw new ApiError('Incident is not open.', 409)
    const now = Date.now() / 1000
    incident.status = 'acknowledged'
    incident.updated_at = now
    const acks = this.acknowledgements.get(id) ?? []
    acks.push({
      operator_action: 'ACKNOWLEDGED',
      notes: notes?.trim() ? notes.trim() : null,
      channel: 'console',
      acknowledged_at: now,
    })
    this.acknowledgements.set(id, acks)
    this.addEvent(id, 'INCIDENT_ACKNOWLEDGED', 'operator', { operator_action: 'ACKNOWLEDGED' }, now)
    this.tick()
  }

  async closeIncident(id: number, notes?: string): Promise<void> {
    const incident = this.incidents.find((i) => i.id === id)
    if (!incident) throw new ApiError('Incident not found.', 404)
    if (incident.status !== 'acknowledged') {
      throw new ApiError('Incident must be acknowledged before it can be closed.', 409)
    }
    const now = Date.now() / 1000
    incident.status = 'closed'
    incident.updated_at = now
    const acks = this.acknowledgements.get(id) ?? []
    acks.push({
      operator_action: 'CLOSED',
      notes: notes?.trim() ? notes.trim() : null,
      channel: 'console',
      acknowledged_at: now,
    })
    this.acknowledgements.set(id, acks)
    this.addEvent(id, 'INCIDENT_CLOSED', 'operator', { notes: notes ?? null }, now)
    this.tick()
  }

  async rebaseline(): Promise<void> {
    const gas = this.currentGas()
    this.baseline = Math.round(gas.raw)
    this.addEvent(null, 'GAS_REBASELINE_REQUESTED', 'operator', { baseline_adc: this.baseline })
    this.tick()
  }

  async updateNode(id: string, patch: NodePatch): Promise<void> {
    const node = this.nodes.find((n) => n.node_id === id)
    if (!node) throw new ApiError('Node not found.', 404)
    Object.assign(node, patch)
    node.last_seen_at = Date.now() / 1000
    this.addEvent(null, 'NODE_UPDATED', 'operator', { node_id: id })
    this.tick()
  }

  async simulateKey(key: string): Promise<void> {
    const action = KEY_ACTIONS[key] ?? 'UNMAPPED'
    this.lastKey = { key, action, at: Date.now() / 1000 }
    this.lcdPage = LCD_PAGES[key] ?? 'STATUS'
    this.addEvent(null, 'KEY_PRESSED', 'arduino', { key, action })
    if (key === '1') this.monitoring = true
    if (key === '2') this.monitoring = false
    this.tick()
  }

  async simulateGas(offset: number): Promise<void> {
    this.gasOffset = clamp(Math.round(offset), -300, 700)
    this.tick()
  }
}
