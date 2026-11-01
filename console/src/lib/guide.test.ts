import { describe, expect, it } from 'vitest'
import { summarisePayload } from './format'
import { nextAction, type NextActionInput } from './guide'

const base: NextActionInput = {
  apiReachable: true,
  mode: 'live',
  lastUpdateAgeS: 1,
  source: 'live',
  monitoring: true,
  esp32Online: true,
  arduinoOnline: true,
  openIncidents: 0,
  gasStatus: 'NORMAL',
  gasWarmupRemainingS: null,
  rfState: 'NO_CLEAR_PERIODIC_PATTERN',
  apiBase: 'http://localhost:8000',
}

const run = (patch: Partial<NextActionInput>) => nextAction({ ...base, ...patch })

describe('nextAction', () => {
  it('waits for the backend when the API is unreachable', () => {
    const result = run({ apiReachable: false, mode: 'demo' })
    expect(result.key).toBe('backend')
    expect(result.action?.kind).toBe('retry')
  })

  it('treats demo mode as unreachable even if a stale flag says otherwise', () => {
    expect(run({ mode: 'demo' }).key).toBe('backend')
  })

  it('shows connecting while the probe is in flight', () => {
    expect(run({ mode: 'connecting', apiReachable: false }).key).toBe('backend')
    expect(run({ mode: 'connecting' }).key).toBe('connecting')
  })

  it('reports stale data after six seconds', () => {
    const result = run({ lastUpdateAgeS: 7 })
    expect(result.key).toBe('stale')
    expect(result.detail).toContain('7 s')
  })

  it('does not call 6 s stale', () => {
    expect(run({ lastUpdateAgeS: 6 }).key).not.toBe('stale')
  })

  it('warns when the live ESP32 is offline', () => {
    const result = run({ source: 'live', esp32Online: false })
    expect(result.key).toBe('esp32-offline')
    expect(result.action?.kind).toBe('signal-lab')
  })

  it('does not apply the ESP32 rule to a simulated source', () => {
    expect(run({ source: 'simulated', esp32Online: false }).key).not.toBe('esp32-offline')
  })

  it('asks to start monitoring when it is off', () => {
    const result = run({ monitoring: false })
    expect(result.key).toBe('monitoring-off')
    expect(result.action?.kind).toBe('start')
  })

  it('surfaces open incidents before RF and gas chatter', () => {
    const result = run({ openIncidents: 2, gasStatus: 'WARMING_UP', rfState: 'REVIEW_RECOMMENDED' })
    expect(result.key).toBe('incidents-open')
    expect(result.title).toContain('2 incidents')
  })

  it('uses the singular for one incident', () => {
    expect(run({ openIncidents: 1 }).title).toContain('1 incident')
  })

  it('shows the gas warm-up countdown', () => {
    const result = run({ gasStatus: 'WARMING_UP', gasWarmupRemainingS: 12.4 })
    expect(result.key).toBe('gas-warmup-13')
    expect(result.detail).toContain('13 s')
  })

  it('raises a review prompt for a periodic pattern', () => {
    const result = run({ rfState: 'REVIEW_RECOMMENDED' })
    expect(result.key).toBe('rf-pattern')
    expect(result.detail).toContain('not proof of a person')
  })

  it('raises a review prompt for an observed pattern', () => {
    expect(run({ rfState: 'PERIODIC_PATTERN_OBSERVED' }).key).toBe('rf-pattern')
  })

  it('asks for better conditions on low quality', () => {
    expect(run({ rfState: 'LOW_QUALITY' }).key).toBe('rf-low-quality')
  })

  it('falls through to all quiet', () => {
    expect(run({}).key).toBe('all-quiet')
  })

  it('puts monitoring before incidents as specified', () => {
    expect(run({ monitoring: false, openIncidents: 1 }).key).toBe('monitoring-off')
  })

  it('keeps the backend rule first even when everything else is quiet', () => {
    expect(run({ apiReachable: false, monitoring: false }).key).toBe('backend')
  })
})

describe('summarisePayload', () => {
  it('turns structured observation details into text', () => {
    const text = summarisePayload({ actor: 'keypad', notes: null })
    expect(typeof text).toBe('string')
    expect(text).toContain('keypad')
  })
})
