# RescueSense backend

The laptop-side CSI pipeline and WebSocket server. It reads the compact ESP32-S3
stream, runs the breathing-detection DSP, serves the dashboard, and relays
alert commands back to the board.

```text
CSI,<timestamp_us>,<rssi>,<amp_sc0>,<amp_sc1>,...
```

It also accepts the stock ESP-IDF `CSI_DATA,...,"[imag,real,...]"` output from
the `csi_recv` examples.

## Run it

One-time environment setup (only downloads anything if a suitable Python with
the packages is not already present):

```powershell
..\tools\setup.ps1          # add -WithML for the optional RandomForest
```

Then:

```powershell
python app.py               # auto-detect the ESP32 port, serve the dashboard
python app.py --serial-port COM9
python app.py --simulate    # hardware-free, clearly badged "not real data"
python app.py --auto-alert  # buzzer follows detections
python app.py --list-ports  # show candidate serial ports and exit
python app.py --model presence_model.joblib   # optional trained model
```

The dashboard is served at `http://127.0.0.1:8000`. Health is at `/health`,
latest telemetry at `/telemetry`, and serial ports at `/ports`.

Dependencies are intentionally small: `starlette`, `uvicorn`, `pyserial`,
`numpy`, `scipy` (`requirements.txt`). `scikit-learn` is only needed for the
optional presence model (`requirements-ml.txt`).

## WebSocket + alert contract

Connect to `ws://127.0.0.1:8000/ws`; the dashboard does this automatically. One
telemetry object arrives per second with `state`, `bpm`, `confidence`,
`scores` (`rhythm`/`focus`/`strength`), `distance_m`, `link` (signal health),
`spectrum`, `waveform`, `heatmap`, and `history`.

Commands are JSON messages:

```js
socket.send(JSON.stringify({ type: "alert", active: true }));        // buzzer on
socket.send(JSON.stringify({ type: "calibration", action: "start", kind: "empty", duration_seconds: 30 }));
socket.send(JSON.stringify({ type: "calibration", action: "start", kind: "distance", distance_m: 2, duration_seconds: 30 }));
```

The backend writes exactly `ALERT,1\n` / `ALERT,0\n` to the ESP32, and re-sends
the current state every 5 s as a heartbeat. The equivalent REST call:

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/alert -ContentType application/json -Body '{"active":true}'
```

## Calibration

Do it from the dashboard's Calibration card, or via REST. Record the empty-room
baseline first (this sets the room-specific thresholds), then optional 1–5 m
anchors to enable proximity:

```powershell
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/calibration/start -ContentType application/json -Body '{"kind":"empty","duration_seconds":30}'
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/calibration/start -ContentType application/json -Body '{"kind":"distance","distance_m":1,"duration_seconds":30}'
Invoke-RestMethod http://127.0.0.1:8000/calibration/status
Invoke-RestMethod -Method Post -Uri http://127.0.0.1:8000/calibration/clear
```

Calibration is saved to `calibration.json` (and `calibration.simulated.json`
for simulation, so the two never mix). Re-run after any change to the router
channel, room, board position, or wall.

## Optional RandomForest presence model

The built-in scoring is the reliable first-demo path. If time allows, collect
labelled windows and train a room-specific model:

```powershell
python collect.py --label absent  --duration 120 --output recordings\absent.csv
python collect.py --label present --duration 120 --output recordings\present.csv
..\tools\setup.ps1 -WithML
python train_presence_model.py "recordings\*.csv" --output presence_model.joblib
python app.py --model presence_model.joblib
```

The model uses `strength_db`, `periodicity`, `concentration`, `motion_index`;
it blends with, and never bypasses, the empty-room safety thresholds.

## Tests

```powershell
python tests\test_pipeline.py          # fast regression suite (no pytest needed)
python tests\evaluate_pipeline.py      # accuracy sweep against the simulator
```

## JATAYU layer (`jatayu/`)

Adds the Arduino Mega link, SQLite storage, rule-based fusion, incidents and an
auditable command lifecycle on top of the CSI pipeline. Raw CSI is never stored.

```bash
python app.py --simulate                         # ESP32 + Arduino both simulated, labelled "simulated"
python app.py --serial-port /dev/ttyACM0 --arduino-port /dev/ttyACM1
python app.py --arduino-port none                # CSI only
python -m pytest tests
```

**Arduino protocol** (115200 baud, one JSON object per line). Mega -> Pi:
`hello`, `sensor_reading {sensor, raw_adc 0-1023, model?, calibration?}`,
`key_event {key}`, `cmd_ack {command_id, status: received|executed|failed}`.
Pi -> Mega: `display {line1, line2}` (16x2, ASCII), and `command {command_id, name, args}`
where `name` is one of `LCD_SHOW, BUZZER, REBOOT_PERIPHERALS, PING`. Malformed lines
are counted and dropped. The Pi owns the key-to-action map.

**API:** `GET /api/status`, `/api/sensors/latest`, `/api/sensors/history`, `/api/rf/status`,
`/api/rf/history`, `/api/incidents[/{id}]`, `/api/events`, `/api/commands`;
`POST /api/monitoring/start|stop`, `/api/inspection/request`,
`/api/incidents/{id}/acknowledge|close` (close requires prior acknowledgement),
`/api/sensors/rebaseline`; simulation only: `POST /api/simulate/key`, `/api/simulate/gas`.
Live updates on `ws://host:8000/ws/live` (state snapshot each second plus every event).

**Semantics.** RF states: DISCONNECTED, COLLECTING, INSUFFICIENT_DATA, LOW_SIGNAL_QUALITY,
NO_CLEAR_PERIODIC_PATTERN, PERIODIC_PATTERN_OBSERVED, REVIEW_RECOMMENDED (pattern held
>= 20 s), reported with a separate data-quality grade and qualitative confidence. Gas
is raw ADC counts against a self-measured baseline after warm-up (never ppm). Incidents
are created only while monitoring is on, group observations within 120 s, and commands
move created -> sent -> received -> executed -> acknowledged (or failed / timed_out).
SQLite file: `jatayu.db` (`jatayu.simulated.db` with `--simulate`); sensor and RF rows
older than 7 days are pruned hourly.
