import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

/*
  Checks the rules that `app.js` renders with. `model.js` is loaded as the
  shipped production file — a classic script, evaluated here rather than
  duplicated — so a passing test describes the page operators actually see.

    python backend/app.py --simulate --db ":memory:"     # or a real Pi
    JATAYU_BASE=http://127.0.0.1:8000 node --test dashboard/simple
*/
const source = await readFile(new URL('./model.js', import.meta.url), 'utf8');
const model = new Function(source + '\nreturn { numberText, provenance, tracePoints, connectionState, backendURL, readResource };')();

const BASE = process.env.JATAYU_BASE || 'http://127.0.0.1:8000';

// The contract tests need a running backend; without one they skip, they do not fail.
let backendReachable = false;
try {
  const response = await fetch(BASE + '/api/status', { signal: AbortSignal.timeout(2000) });
  backendReachable = response.ok;
} catch {
  backendReachable = false;
}

test('unavailable numbers stay unavailable while a legitimate zero stays zero', () => {
  assert.equal(model.numberText(null), '—');
  assert.equal(model.numberText(undefined), '—');
  assert.equal(model.numberText(''), '—');
  assert.equal(model.numberText(NaN), '—');
  assert.equal(model.numberText(0), '0');
  assert.equal(model.numberText(14.94, 1), '14.9');
  assert.equal(model.numberText(14.96, 1), '15.0');
});

test('simulated and demo sources can never be labeled live', () => {
  assert.equal(model.provenance({ source: 'simulated' }).label, 'SIMULATED');
  assert.equal(model.provenance({ source: 'demo' }).label, 'DEMO OVERRIDE');
  assert.equal(model.provenance({ source: 'live', arduino_link: { simulated: true } }).label, 'MIXED SOURCES');
  assert.equal(model.provenance({ source: 'live', csi_link: { kind: 'simulation' } }).label, 'MIXED SOURCES');
  assert.equal(model.provenance({ source: 'live' }).label, 'LIVE INPUT');
  assert.equal(model.provenance({}).label, 'SOURCE UNKNOWN');
});

test('the trace uses only finite backend coordinate pairs', () => {
  assert.deepEqual(model.tracePoints({ waveform: [[-30, 0], [-29, 2], [-28, null], ['-27', 3], [1, Infinity]] }), [[-30, 0], [-29, 2]]);
  assert.deepEqual(model.tracePoints({ valid: false, waveform: [[0, 1]] }), []);
  assert.deepEqual(model.tracePoints({}), []);
});

test('connection distinguishes missing, stale, failed and paused polling', () => {
  assert.equal(model.connectionState({ now: 10000, lastSuccess: 0 }), 'connecting');
  assert.equal(model.connectionState({ now: 10000, lastSuccess: 9900 }), 'connected');
  assert.equal(model.connectionState({ now: 10000, lastSuccess: 1000 }), 'stale');
  assert.equal(model.connectionState({ now: 10000, lastSuccess: 9900, failed: true }), 'disconnected');
  assert.equal(model.connectionState({ now: 10000, lastSuccess: 9900, paused: true }), 'paused');
});

test('backend URL accepts an origin and rejects everything else', () => {
  assert.equal(model.backendURL(' http://192.168.1.22:8000/ '), 'http://192.168.1.22:8000');
  assert.throws(() => model.backendURL('javascript:alert(1)'));
  assert.throws(() => model.backendURL('http://user:pass@localhost:8000'));
  assert.throws(() => model.backendURL('http://localhost:8000/api/status'));
});

/* Contract against the unmodified backend: the page reads four endpoints and
   nothing else, so their shapes are the page's dependencies. */
test('the four documented GET endpoints answer in the shapes the page expects', { skip: !backendReachable && `no backend at ${BASE}` }, async () => {
  const status = await model.readResource(BASE, '/api/status');
  assert.equal(status.type, 'jatayu');
  assert.equal(typeof status.rf.state, 'string');
  assert.ok(['live', 'simulated', 'demo'].includes(status.source));
  assert.equal(typeof status.environment.raw_adc, 'number');

  const telemetry = await model.readResource(BASE, '/telemetry');
  assert.equal(telemetry.type, 'telemetry');
  assert.ok(model.tracePoints(telemetry).length > 2, 'expected backend waveform samples');

  const events = await model.readResource(BASE, '/api/events?limit=6');
  assert.ok(Array.isArray(events) && events.length > 0);
  assert.equal(typeof events[0].event_type, 'string');

  const incidents = await model.readResource(BASE, '/api/incidents?limit=6');
  assert.ok(Array.isArray(incidents));

  await assert.rejects(model.readResource(BASE, '/definitely-not-a-route'), /404/);
});

test('a backend snapshot renders without invented values', { skip: !backendReachable && `no backend at ${BASE}` }, async () => {
  const status = await model.readResource(BASE, '/api/status');
  const loss = status.rf.features?.packet_loss_ratio;
  const rendered = {
    source: model.provenance(status).label,
    gas: model.numberText(status.environment.raw_adc),
    packetRate: model.numberText(status.rf.features?.packet_rate_hz, 1),
    loss: model.numberText(loss == null ? null : loss * 100, 2)
  };
  assert.ok(['LIVE INPUT', 'SIMULATED', 'DEMO OVERRIDE', 'MIXED SOURCES'].includes(rendered.source));
  assert.match(rendered.gas, /^\d+$/u, 'the backend reports an integer ADC count');
  if (loss == null) assert.equal(rendered.loss, '—', 'null packet loss must not be drawn as 0.00%');
});
