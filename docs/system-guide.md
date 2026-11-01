# JATAYU system guide

The maintained record of how the whole system is set up, what is real and what is simulated.
Update it whenever the setup or a result changes. Last updated 2026-10-31.

## Current setup

| Part | State |
| --- | --- |
| ESP32-S3 | JATAYU firmware 3.1 on hotspot `Amogh` (2.4 GHz). Prints on its **native USB** socket, which must go to the Pi (`303a:1001` in `lsusb`) |
| Raspberry Pi 4B | `jatayu-pi`, `192.168.137.10`, backend in `~/JATAYU`, started at boot by `jatayu.service` |
| Laptop | Runs the hotspot; its firewall allows ping from hotspot devices. Must not join another hotspot that uses `192.168.137.x` |
| Arduino UNO | MQ-135 on A0 and keypad on D2-D9. Connect to the Pi by USB. Firmware in `arduino/jatayu_uno`, not yet tested on the board |
| Second Pi | Not used by any code |

## Dashboard

| Address | Data source | Started by |
| --- | --- | --- |
| `http://192.168.137.10:8000` | React operator console (source in `console/`, build with `npm run build`, copy `console/dist` to the Pi). **Real** data, or **simulated** after pressing `7` | `jatayu.service` |
| `http://192.168.137.10:8000/csi` | Original signal view and calibration. Same data and same key | `jatayu.service` |

## Simulation

**Press `7` on the dashboard to switch to simulated data; press `7` again to return to real data.** There is
no simulation label on screen, by project decision. **Everything shown after pressing `7` is generated.** It is
not a measurement and is not evidence the system detects anything.

- Generator: `SimulatedCSIProducer` in `backend/serial_io.py` and `SimulatedArduino` in `backend/jatayu/arduino_io.py`. Default: 15 cycles/min at 2.5 m.
- **Script:** the rate shown goes from 14 to 19 over 8 s, back to 14 over 8 s, wavers around 14 for 8 s, then holds at 14. This is a script, not an analysis result.
- Hardware-free mode: `.venv/bin/python app.py --simulate`, with scenario controls at `/#controls`.
- Records stay separate: `/telemetry` reports `"source": "simulation"`, `/api/status` reports `"source": "demo"`, the console badge shows Connected instead of Live hardware, and readings made after pressing `7` are never stored as observations. The ESP32 keeps being read in the background.
- The header says `Connected` in simulation and `Live` only for a real stream.
- **Tell anyone watching a demo when this view is simulated**, and do not quote its numbers as measured results.

## Results so far

Simulated (`tests/evaluate_pipeline.py`), original code -> noise-estimate fix -> longest still stretch:
detection 97.3% -> 99.8% -> 100.0%, false alarms 1.0% throughout, median rate error 0.00 cycles/min.
These describe the code against its own simulator, not real-world accuracy.

Movement blocking was later removed altogether. Stress test caveat: when the simulator was repeatedly disturbed, false patterns appeared in an empty scene, so a reading during movement is not reliable.

Before that, replaying one 90 s recording from the crowded room, seconds reading "Movement": 36 of 60 with the noise
fix alone, 27 of 60 with the longest still stretch as well. Movement that is still happening is still reported.

RescueSense_VisionX has the same signal processing and firmware CSI settings, and no recorded real-world
calibration, so it offers no better movement handling to copy.

Real hardware, in a room of about 150 people:

| Measure | Result |
| --- | --- |
| Packet rate | About 30-50 pkt/s and uneven (target 100, backend minimum 20) |
| Packet loss over USB | About 0.1% |
| Dashboard state | "No clear pattern" on the crowded-room recording. Movement no longer blocks analysis: every packet is used, level shifts are removed and bursts clipped |
| Periodic pattern detection | **Not measured** |
| Empty-room baseline | **Not recorded**; built-in default thresholds in use |

## First real recordings

One trial, own room with other people nearby. **No breathing rhythm was found in either recording, so this does not show detection.**

| Recording | Length | Packets/s | Rhythm | Confidence | Estimates (cycles/min) |
| --- | --- | --- | --- | --- | --- |
| Person in the link | 184 s | 45 | 0.02 | 0 | 7.0-29.9, median 18.2 |
| Person out of the link | 110 s (SSH dropped) | 48 | 0.00 | 0 | 6.6-23.0, median 12.3 |

The estimates are too scattered to report as rates. No hand count was recorded.

## Keypad sections

Keys open the matching section and highlight it for 3 seconds:

| Key | Console (`/`) | Signal view (`/csi`) |
| --- | --- | --- |
| `3` sensor | Gas panel | Gas sensor |
| `5` RF | RF observation | Reading and scores |
| `6` system | Readout tiles | Device messages |
| `7` incidents | Incidents | Event log |
| `9` diagnostics | Event timeline | Subcarrier activity |

## Keypad reports

Press `0` then a digit within 3 seconds to report lives saved: `02` shows a "2 lives saved" popup on every open page
and adds to the running total, which survives restarts. `00` undoes the last report. Each report is a stored
`LIVES_SAVED_REPORTED` event. **The number is what the operator entered; the system does not measure it.**

## Main screen

The main screens show readings continuously. The confidence figure and the "no clear pattern" wording were removed
from them by project decision; `/api/status` and `/telemetry` still report both. **A rate on screen is the strongest
candidate in the window, not proof of breathing, and it appears even when no rhythm exists.**

The 3D figure on `/csi` is a **fixed illustration, always shown**, by project decision. It does not move with real
data and does not mean a person was detected; only its breathing animation runs during a pattern.

## Hard limits

- Serial rows: at most 2000 characters and 128 subcarriers, amplitude 0-10000, RSSI -127 to 0 dBm, channel 1-14. Other rows are counted as dropped.
- Outputs: rate within **11-30 cycles/min**; analysis searches only this band, so a true rate outside it cannot be reported correctly. Confidence and scores stay within 0-1.
- Tools: recordings 1-3600 s and 0.1-500 MB; analysis under 500 ms in the time-budget test.


## Recording real breathing

Stop the backend, record, restart it (only one program can use the serial port):

```bash
sudo systemctl stop jatayu
cd ~/JATAYU/backend && .venv/bin/python capture_raw.py --label breathing --duration 180 --distance-m 2
sudo systemctl start jatayu
.venv/bin/python analyze_recording.py recordings/<file>.jsonl --breaths <hand count>
```

Compare against an `--label empty` recording of the same length, without `--breaths`. A result counts only
if the error is within 2 cycles/min and the empty recording does not show the same rhythm.

## Comparing an empty and a crowded room

Keep the same hardware, spacing and settings in both rooms. Film real data (header shows `Live`, never press `7`) and
record 3 minutes in each room with `capture_raw.py`. Compare `activity_median` and `activity_p90` from
`analyze_recording.py`. Do this on at least 3 pairs of recordings before claiming a difference, and report the rooms as
tested, because one room's result does not generalise. Record a new baseline for each new room or layout.

## Measuring properly

A baseline measures one room when it is empty and cannot be copied from elsewhere.

1. Use a quiet room or empty classroom, with nobody else within about 5 m and no fan or AC blowing on the setup.
2. Lock the transmitter to one 2.4 GHz channel. Place the ESP32 1-3 m from it, and do not move either afterwards.
3. Check Signal health: at least 70 pkt/s, steady.
4. With everyone out of the area, record the 30 s empty-room baseline from the Calibration card.
5. Stay out for 2 minutes and record the state. Then have one person sit still in the area for 2 minutes, and record the state and rate against a manual breath count.
6. Repeat 5 several times and enter the results here. Re-record the baseline if the room or layout changes.

## Improving the packet rate

In order of value:

1. **Second ESP32 running `csi_send`** as a dedicated transmitter: removes the laptop and router from the signal path (see firmware-setup.md).
2. **Dedicated 2.4 GHz router on a fixed channel**: reflash the ESP32 with its details and connect the Pi to it.
3. **Laptop internet over phone USB tethering or Ethernet**: free, and lets the laptop's Wi-Fi serve only the hotspot.

Connecting the ESP32 to the laptop by USB does not raise the rate, because USB is not the limit.

## Known limits

The ESP32 retries Wi-Fi with no pause while its network is missing. The firmware does not report its
temperature. See [failure-modes.md](failure-modes.md) for symptoms and fixes.
