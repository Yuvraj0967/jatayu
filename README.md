# JATAYU

JATAYU is a stationary, local-first prototype for organising **Wi-Fi CSI** and
**environmental** observations in hazardous or inaccessible spaces, with an
auditable human review workflow. An ESP32-S3 captures CSI, an Arduino Mega reads a
gas sensor/keypad/LCD, and a Raspberry Pi 4B runs the DSP, database, API and dashboard.

It is an **experimental decision-support demonstrator**. It does not identify survivors,
detect breathing in a medically meaningful way, certify gas safety, or give exact position
or depth. A periodic RF pattern is an observation for review, not proof of a person.

Built on the RescueSense CSI pipeline; the DSP and acquisition firmware were extended, not rewritten.

| Part | Role |
| --- | --- |
| `firmware/` | ESP32-S3 CSI node (protocol v1: sequence numbers, health counters, RAW stream) |
| `backend/` | CSI DSP + JATAYU layer (Arduino link, SQLite, fusion, incidents, REST/WebSocket) |
| `dashboard/` | Operator console (single page, no build step) |
| `tools/` | PowerShell setup/build/flash/run scripts (Windows) |
| `docs/` | [architecture](docs/architecture.md), [ESP32 node](docs/esp32-node.md), [hardware](docs/hardware.md), [firmware setup](docs/firmware-setup.md), [calibration](docs/calibration.md), [demo](docs/demo-script.md), [failure modes](docs/failure-modes.md) |

## Quick start (no hardware)

```bash
cd backend
pip install -r requirements.txt
python app.py --simulate        # everything is badged "simulated"
python -m pytest tests          # needs: pip install pytest httpx
```

Open `http://127.0.0.1:8000` for the JATAYU console (RF observation, environment, incidents, timeline, commands, nodes). The original CSI view and calibration page is at `/csi`. Windows helper: `.\tools\start-demo.ps1 -Simulate`.

## Live hardware

1. Flash the ESP32-S3: see [docs/firmware-setup.md](docs/firmware-setup.md) (`.\tools\build-flash.ps1`; add `-Console usb` if the board only has the native USB port).
2. Run `python app.py` (auto-detects the ESP32; add `--arduino-port /dev/ttyACM0` for the Mega, or `--arduino-port none`).
3. On the Pi, `python app.py --host 0.0.0.0` and browse to `http://<pi-ip>:8000`.
4. Record a 30 s empty-room baseline from the dashboard ([calibration](docs/calibration.md)).

Record labelled raw trials for experiments with `python capture_raw.py --label empty_room --duration 300`.

## Status

| Area | State |
| --- | --- |
| CSI DSP, calibration, dashboard | Working (inherited), wording updated to observations |
| ESP32 firmware v3.1 | Written, syntax-checked against stubs, **not yet built or flashed** |
| Backend JATAYU layer + REST/WS API | Implemented and tested (44 tests, simulation) |
| Arduino Mega firmware | Not written |
| Multi-node ingestion, localisation, 3D view | Not started (research goals) |

## Integrity of the claim

Say **"periodic RF pattern observed"**, **"signal quality: good"** and **"further investigation recommended"**.
Do not say "survivor detected" or "breathing detected". MQ readings are raw ADC counts, never ppm.
Quote accuracy, range or sensitivity only after measuring it with a defined protocol and enough trials.
