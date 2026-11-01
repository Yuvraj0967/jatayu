/* JATAYU simple console — rendering and polling.
   Reads the unmodified backend through four GET endpoints and draws the result.
   It never POSTs: monitoring, calibration and device commands stay in the existing console. */

(function () {
  const $ = id => document.getElementById(id);
  const put = (id, value) => { const el = $(id); if (el) el.textContent = value; };
  const words = value => typeof value === 'string' ? value.toLowerCase().replaceAll('_', ' ').replace(/^./, c => c.toUpperCase()) : 'Unknown';
  const clock = seconds => typeof seconds === 'number' && Number.isFinite(seconds)
    ? new Date(seconds * 1000).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false })
    : '—';

  let base = 'http://127.0.0.1:8000';
  try {
    const saved = new URLSearchParams(location.search).get('backend') || localStorage.getItem('jatayu-backend');
    if (saved) base = backendURL(saved);
  } catch (error) { /* A bad saved origin must not stop the page from loading. */ }

  let status = {}, telemetry = {}, events = [], incidents = [];
  let lastSuccess = 0, lastListsAt = 0, paused = false, failed = false;
  let generation = 0, incidentToken = 0, nextListsAt = 0, timer = null, request = null, lastError = '';
  let telemetryAvailable = false, listsAvailable = { events: false, incidents: false };

  const rfDescriptions = {
    NO_DATA: 'No recent CSI frames. Check the receiver and its link to the backend.',
    COLLECTING: 'The backend is collecting a signal window before making an assessment.',
    INSUFFICIENT_DATA: 'There is not enough valid signal data for an assessment yet.',
    LOW_QUALITY: 'Signal quality is too low for a reliable pattern assessment.',
    NO_CLEAR_PERIODIC_PATTERN: 'The backend has not found a clear periodic pattern in this window.',
    PERIODIC_PATTERN_OBSERVED: 'The backend reports a repeating RF pattern. Review the signal and its quality.',
    REVIEW_RECOMMENDED: 'The pattern has persisted. Further human review is recommended.'
  };
  const shortStates = {
    REVIEW_RECOMMENDED: 'Further review recommended',
    PERIODIC_PATTERN_OBSERVED: 'Periodic RF pattern observed',
    NO_CLEAR_PERIODIC_PATTERN: 'No clear periodic pattern',
    LOW_QUALITY: 'Low signal quality',
    NO_DATA: 'No recent signal',
    COLLECTING: 'Collecting signal',
    INSUFFICIENT_DATA: 'Insufficient signal data'
  };

  function renderConnection() {
    const state = connectionState({ lastSuccess, paused, failed });
    const names = { connecting: 'Connecting', connected: 'Backend connected', paused: 'Updates paused', disconnected: 'Backend disconnected', stale: 'Updates stale' };
    put('connection-label', names[state]);
    $('nav-dot').className = 'connection-dot ' + state;
    $('dashboard-grid').classList.toggle('stale', state !== 'connected');

    const warning = $('connection-warning');
    warning.hidden = state === 'connected' || state === 'connecting';
    warning.textContent = state === 'paused'
      ? 'Updates paused on this page. The readings below are the last received snapshot; your backend keeps running untouched.'
      : state === 'stale'
        ? 'No recent snapshot. The readings below may be out of date — check the backend and the ESP32 link.'
        : 'Cannot reach ' + base + '. ' + (lastSuccess ? 'Showing the last received snapshot, which is not current.' : 'No readings are available yet.')
          + ' Check that the backend is running, then use Connection to change its address.';
    if (lastError && state === 'disconnected') warning.title = lastError;

    const seconds = lastSuccess ? Math.floor((Date.now() - lastSuccess) / 1000) : null;
    put('updated', seconds === null ? 'Waiting for backend' : seconds < 2 && state === 'connected' ? 'Updated just now' : 'Last update ' + seconds + 's ago');
    put('host-state', state === 'connected' ? 'Reachable' : words(state));
    $('host-state').className = 'device-state ' + (state === 'connected' ? 'green' : state === 'paused' ? 'amber' : '');
    $('pause-button').setAttribute('aria-pressed', String(paused));
    put('pause-label', paused ? 'Resume updates' : 'Pause updates');
    put('pause-icon', paused ? '▶' : '❚❚');
  }

  function renderStatus() {
    const rf = status.rf || {}, env = status.environment || {}, feature = rf.features || {};
    const source = provenance(status);
    put('source-badge', source.label);
    $('source-badge').className = 'badge ' + source.tone;
    $('source-strip').className = 'source-strip ' + source.tone;
    put('source-description', source.description);

    put('rf-state', shortStates[rf.state] || rf.text || (rf.state ? words(rf.state) : 'No observation yet'));
    put('rf-explanation', rf.text || rfDescriptions[rf.state] || 'Connect to your backend to receive the current RF assessment.');
    put('rf-quality-caption', rf.data_quality ? 'SIGNAL QUALITY: ' + rf.data_quality.toUpperCase() : 'WAITING FOR INPUT');
    put('sustained', numberText(rf.pattern_seconds, 0) + ' s sustained');
    put('quality', rf.data_quality ? words(rf.data_quality) : '—');
    put('confidence', rf.confidence || '—');
    put('packet-rate', numberText(feature.packet_rate_hz, 1));
    put('packet-loss', numberText(typeof feature.packet_loss_ratio === 'number' ? feature.packet_loss_ratio * 100 : null, 2));
    put('pattern-rate', numberText(feature.dominant_rate_per_min, 1) + ' cycles/min');
    put('rssi', numberText(feature.rssi, 1) + ' dBm');
    put('periodicity', numberText(rf.periodicity_score, 3));
    put('frame-age', typeof status.csi_link?.last_frame_age_s === 'number' ? numberText(status.csi_link.last_frame_age_s, 1) + ' s' : 'Not reported');

    put('gas-value', numberText(env.raw_adc));
    put('gas-model', env.model || 'MQ SENSOR');
    put('gas-baseline', numberText(env.baseline_adc));
    put('gas-threshold', numberText(env.threshold_adc));
    put('environment-state', (env.status || 'NO_DATA').replaceAll('_', ' '));
    $('environment-state').className = 'badge ' + (['ELEVATED', 'STALE'].includes(env.status) ? 'red' : env.status === 'NORMAL' ? 'muted' : 'amber');
    const gasNotice = env.status === 'STALE' ? 'Reading stale (' + numberText(env.age_s, 1) + 's old). Do not treat this as current.'
      : env.status === 'WARMING_UP' ? 'Sensor warming up · ' + numberText(env.warmup_remaining_s) + 's remaining.'
        : env.status === 'BASELINING' ? 'The backend is collecting a baseline.'
          : env.status === 'ELEVATED' ? 'Above the experimental threshold. Review required.'
            : 'Uncalibrated reading. Not a gas-safety assessment.';
    put('gas-note', gasNotice + ' Raw ADC counts, never ppm.');
    $('gas-note').classList.toggle('warning-text', ['ELEVATED', 'STALE'].includes(env.status));

    const deviceState = (name, target, simulated) => {
      const value = status.devices?.[name];
      const active = value === 'online';
      put(target, active && simulated ? 'Simulated' : value ? words(value) : 'Unknown');
      $(target).className = 'device-state ' + (active ? simulated ? 'amber' : 'green' : value === 'offline' ? 'red' : '');
    };
    deviceState('esp32', 'esp-state', status.source === 'simulated' || status.csi_link?.kind === 'simulation');
    deviceState('arduino', 'arduino-state', status.source === 'simulated' || status.arduino_link?.simulated);
    put('tick-time', numberText(status.performance?.tick_ms, 2) + ' ms');
    put('monitoring-state', typeof status.monitoring === 'boolean' ? status.monitoring ? 'On' : 'Off' : 'Unknown');
    put('device-note', status.source === 'simulated'
      ? 'This backend is running with --simulate. The ESP32 and Arduino rows are simulated, and this page changes no device settings.'
      : 'This page reads the existing API. It does not change device settings or start monitoring.');

    [['open', 'open-count'], ['acknowledged', 'ack-count'], ['closed', 'closed-count']].forEach(pair => {
      put(pair[1], status.incident_counts ? numberText(status.incident_counts[pair[0]] ?? 0) : '—');
    });
    renderConnection();
  }

  function renderWaveform() {
    const wantRaw = $('trace-select').value === 'raw';
    put('trace-label', wantRaw ? 'Raw CSI amplitude · auto scale' : 'Processed CSI amplitude · auto scale');
    let points = tracePoints(wantRaw ? { valid: telemetry.valid, waveform: telemetry.raw_waveform } : telemetry);
    const traceAge = Number.isFinite(status.server_time) && Number.isFinite(telemetry.server_time) ? status.server_time - telemetry.server_time : null;

    let empty = '';
    if (status.source === 'demo') empty = 'Demo RF override: the demo waveform is not mixed with live samples.';
    else if (!telemetryAvailable) empty = 'Waveform endpoint unavailable on this backend.';
    else if (points.length < 2) empty = 'The backend has not returned waveform samples yet.';
    else if (traceAge !== null && traceAge > 6) empty = 'No fresh waveform samples in the last ' + Math.round(traceAge) + 's.';
    else if (status.rf?.state === 'NO_DATA') empty = 'No recent CSI frames, so no fresh trace.';
    if (empty) points = [];

    $('chart-empty').hidden = points.length > 1;
    put('chart-empty', empty);
    const traceSource = provenance({ source: telemetry.source });
    put('trace-state', points.length ? traceSource.label + ' · ' + points.length + ' SAMPLES' : 'NO CURRENT TRACE');

    if (points.length < 2) {
      $('wave-line').setAttribute('points', '');
      $('wave-area').setAttribute('d', '');
      ['y-high', 'y-mid', 'y-low'].forEach(id => put(id, '—'));
      put('x-start', '— s'); put('x-end', '— s');
      put('chart-description', empty || 'Waiting for waveform samples.');
      return;
    }

    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    points.forEach(point => {
      minX = Math.min(minX, point[0]); maxX = Math.max(maxX, point[0]);
      minY = Math.min(minY, point[1]); maxY = Math.max(maxY, point[1]);
    });
    const padding = Math.max((maxY - minY) * 0.1, 0.01);
    minY -= padding; maxY += padding;
    const mapped = points.map(point => [
      42 + (point[0] - minX) / (maxX - minX || 1) * 667,
      163 - (point[1] - minY) / (maxY - minY) * 148
    ]);
    const rendered = mapped.map(point => point.map(v => v.toFixed(2)).join(',')).join(' ');
    $('wave-line').setAttribute('points', rendered);
    $('wave-area').setAttribute('d', 'M' + mapped[0][0].toFixed(2) + ',163 L' + rendered + ' L' + mapped.at(-1)[0].toFixed(2) + ',163 Z');
    put('y-high', numberText(maxY, 1)); put('y-mid', numberText((minY + maxY) / 2, 1)); put('y-low', numberText(minY, 1));
    put('x-start', numberText(minX, 1) + ' s'); put('x-end', numberText(maxX, 1) + ' s');
    put('chart-description', traceSource.label + '. ' + points.length + ' backend samples from ' + numberText(minX, 1)
      + ' to ' + numberText(maxX, 1) + ' seconds, amplitude ' + numberText(minY, 2) + ' to ' + numberText(maxY, 2) + '. Vertically auto-scaled.');
  }

  function element(tag, text, className) {
    const el = document.createElement(tag);
    if (text !== undefined) el.textContent = text;
    if (className) el.className = className;
    return el;
  }

  const eventGroups = {
    rf: type => /^RF_/.test(type),
    device: type => /ESP32|ARDUINO|DEVICE|CONNECTED|DISCONNECTED/.test(type),
    incident: type => /INCIDENT|ACKNOWLEDG/.test(type)
  };

  function renderEvents() {
    const body = $('events-body');
    body.replaceChildren();
    const filter = $('event-filter').value;
    const shown = events.filter(event => filter === 'all' || eventGroups[filter]?.(event.event_type || '')).slice().reverse().slice(0, 6);

    if (!shown.length) {
      const row = element('tr');
      const cell = element('td', !listsAvailable.events
        ? 'Event history unavailable. Retrying automatically.'
        : filter === 'all' ? 'No events recorded by the backend yet.' : 'No matching events in the latest records.', 'empty-cell');
      cell.colSpan = 3;
      row.append(cell);
      body.append(row);
    }

    shown.forEach(event => {
      const row = element('tr');
      row.append(element('td', clock(event.created_at)));
      const title = element('td', words(event.event_type), 'event-label');
      const payload = event.payload || {};
      const detail = payload.to ? words(payload.from || 'Initial state') + ' → ' + words(payload.to)
        : payload.summary || payload.text || payload.note || event.actor || '';
      title.append(element('small', String(detail)));
      row.append(title);
      const source = provenance({ source: payload.source });
      const sourceCell = element('td');
      sourceCell.append(element('span', source.label === 'SOURCE UNKNOWN' ? 'UNSPECIFIED' : source.label, 'badge ' + source.tone));
      row.append(sourceCell);
      body.append(row);
    });

    // Only claim a refresh time when a list fetch actually succeeded.
    put('events-note', listsAvailable.events
      ? 'Latest backend events · refreshed ' + clock(lastListsAt / 1000)
      : 'Event request failed · no activity is invented here');
  }

  function renderIncidents() {
    const list = $('incident-list');
    list.replaceChildren();
    const queue = incidents.filter(incident => incident.status !== 'closed').slice(0, 3);
    if (!queue.length) {
      list.append(element('p', listsAvailable.incidents
        ? 'No open incidents in the latest records.'
        : 'Incident records unavailable. Retrying automatically.'));
    }
    queue.forEach(incident => {
      const button = element('button', undefined, 'incident-button');
      button.type = 'button';
      button.append(
        element('small', (incident.incident_code || 'Incident ' + incident.id) + ' · ' + words(incident.status)),
        element('span', incident.summary || 'View recorded observation'));
      button.addEventListener('click', () => openIncident(incident));
      list.append(button);
    });
  }

  async function openIncident(incident) {
    const token = ++incidentToken;
    const origin = base;
    put('incident-detail-title', incident.incident_code || 'Incident ' + incident.id);
    put('incident-detail-summary', incident.summary || 'Recorded backend observation.');
    $('incident-detail-content').replaceChildren(element('p', 'Loading recorded details…'));
    $('incident-dialog').showModal();
    try {
      const record = await readResource(origin, '/api/incidents/' + encodeURIComponent(incident.id));
      if (token !== incidentToken || !$('incident-dialog').open) return;   // a newer open won
      const content = $('incident-detail-content');
      content.replaceChildren();
      content.append(element('div', words(record.status) + ' · ' + provenance(record).label + ' · created ' + clock(record.created_at)));
      (record.observations || []).forEach(observation => {
        const block = element('div', words(observation.observation_type) + ' · ' + clock(observation.created_at));
        block.append(element('pre', JSON.stringify(observation.detail, null, 2)));
        content.append(block);
      });
      if (!record.observations?.length) content.append(element('p', 'No attached observations.'));
    } catch (error) {
      if (token !== incidentToken || !$('incident-dialog').open) return;
      $('incident-detail-content').replaceChildren(element('p', 'Could not load this incident: ' + error.message));
    }
  }

  async function poll() {
    if (paused) return;
    const token = generation;
    const origin = base;
    request = new AbortController();

    const paths = ['/api/status', '/telemetry'];
    const refreshLists = Date.now() >= nextListsAt;
    if (refreshLists) paths.push('/api/events?limit=40', '/api/incidents?limit=100');

    const responses = await Promise.allSettled(paths.map(path => readResource(origin, path, request.signal)));
    if (token !== generation || paused) return;   // superseded by a pause or backend change

    const [stateResult, traceResult, eventResult, incidentResult] = responses;
    if (stateResult.status === 'fulfilled' && stateResult.value?.type === 'jatayu') {
      status = stateResult.value;
      lastSuccess = Date.now();
      failed = false;
      lastError = '';
    } else {
      failed = true;
      lastError = stateResult.reason?.message || 'This address did not return a JATAYU status object.';
    }

    telemetryAvailable = traceResult.status === 'fulfilled' && traceResult.value?.type === 'telemetry';
    if (telemetryAvailable) telemetry = traceResult.value;

    if (refreshLists) {
      listsAvailable.events = eventResult.status === 'fulfilled' && Array.isArray(eventResult.value);
      listsAvailable.incidents = incidentResult.status === 'fulfilled' && Array.isArray(incidentResult.value);
      if (listsAvailable.events) events = eventResult.value;
      if (listsAvailable.incidents) incidents = incidentResult.value;
      if (listsAvailable.events || listsAvailable.incidents) lastListsAt = Date.now();
      nextListsAt = Date.now() + 5000;
    }

    renderStatus();
    renderWaveform();
    if (refreshLists) { renderEvents(); renderIncidents(); }
    timer = setTimeout(poll, 1000);
  }

  function restart() {
    generation++;
    request?.abort();
    clearTimeout(timer);
    status = {}; telemetry = {}; events = []; incidents = [];
    lastSuccess = 0; lastListsAt = 0; failed = false; paused = false; nextListsAt = 0;
    telemetryAvailable = false;
    listsAvailable = { events: false, incidents: false };
    put('endpoint-label', base.replace(/^https?:\/\//, ''));
    renderStatus(); renderWaveform(); renderEvents(); renderIncidents();
    poll();
  }

  document.querySelectorAll('[data-open-connection]').forEach(button =>
    button.addEventListener('click', () => {
      $('backend-address').value = base;
      $('connection-error').hidden = true;
      $('connection-dialog').showModal();
    }));
  document.querySelectorAll('[data-close-dialog]').forEach(button =>
    button.addEventListener('click', () => $('connection-dialog').close()));
  $('close-incident').addEventListener('click', () => { incidentToken++; $('incident-dialog').close(); });

  $('connection-form').addEventListener('submit', event => {
    event.preventDefault();
    try {
      const next = backendURL($('backend-address').value);
      if (location.protocol === 'https:' && next.startsWith('http:')) {
        throw new Error('This preview is HTTPS but the backend is plain HTTP; the browser would block it. Open the page locally over HTTP to connect.');
      }
      base = next;
      try { localStorage.setItem('jatayu-backend', base); } catch (error) { /* an in-session connection is still useful */ }
      if (location.protocol !== 'file:') {
        const url = new URL(location.href);
        url.searchParams.set('backend', base);
        history.replaceState(null, '', url);
      }
      $('connection-dialog').close();
      incidentToken++;
      $('incident-dialog').close();
      restart();
    } catch (error) {
      put('connection-error', error.message);
      $('connection-error').hidden = false;
    }
  });

  $('pause-button').addEventListener('click', () => {
    paused = !paused;
    generation++;
    request?.abort();
    clearTimeout(timer);
    renderConnection();
    if (!paused) { nextListsAt = 0; poll(); }
  });

  $('trace-select').addEventListener('change', renderWaveform);
  $('event-filter').addEventListener('change', renderEvents);

  const known = ['main', 'signal', 'devices', 'activity'];
  function highlight() {
    const target = location.hash.slice(1) || 'main';
    if (!known.includes(target)) return;
    document.querySelectorAll('.nav-links a').forEach(link => link.classList.toggle('selected', link.hash === '#' + target));
  }
  window.addEventListener('hashchange', highlight);

  setInterval(renderConnection, 1000);
  window.addEventListener('pagehide', () => { generation++; request?.abort(); clearTimeout(timer); });

  restart();
  highlight();
})();
