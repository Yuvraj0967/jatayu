# JATAYU system guide

The maintained record of how the whole system is set up, what is real and what is simulated.
Update it whenever the setup or a result changes. Last updated 2026-10-31.

## Current setup

| Part | State |
| --- | --- |
| ESP32-S3 | JATAYU firmware 3.1 on hotspot `Amogh` (2.4 GHz). Prints on its **native USB** socket, which must go to the Pi (`303a:1001` in `lsusb`) |
| Raspberry Pi 4B | `jatayu-pi`, `192.168.137.10`, backend in `~/JATAYU`, started at boot by `jatayu.service` |
| Laptop | Runs the hotspot; its firewall allows ping from hotspot devices. Must not join another hotspot that uses `192.168.137.x` |
| Arduino Mega | Firmware not written; backend runs with `--arduino-port none` |
| Second Pi | Not used by any code |

## Two dashboards

| Address | Data source | Started by |
| --- | --- | --- |
| `http://192.168.137.10:8000` | **Real** CSI from the ESP32 | `jatayu.service` |
| `http://192.168.137.10:8001` | **Simulated**: no sensor is read | `.venv/bin/python app.py --simulate --host 0.0.0.0 --port 8001` in `~/JATAYU/backend` |

## Simulation

The dashboard on port 8001 looks the same as the real one and does not carry a simulation label, by
project decision. **Everything it shows is generated, including the rhythm, distance, gas readings and
keypad events.** It is not a measurement and is not evidence the system detects anything.

- Generator: `SimulatedCSIProducer` in `backend/serial_io.py` and `SimulatedArduino` in `backend/jatayu/arduino_io.py`. Default: 15 cycles/min at 2.5 m.
- Scenario controls: add `#controls` to the address, e.g. `http://192.168.137.10:8001/#controls`.
- Records stay marked: `/health` and `/telemetry` report `"source": "simulation"`, stored rows use `simulated`, and data goes to the separate `jatayu.simulated.db` and `calibration.simulated.json`.
- The header says `Connected` in simulation and `Live` only for a real stream.
- **Tell anyone watching a demo that this view is simulated**, and do not quote its numbers as measured results.

## Results so far

Simulated (`tests/evaluate_pipeline.py`), before and after the noise-estimate fix: detection 97.3% -> 99.8%,
false alarms 1.0% -> 1.0%, median rate error 0.00 cycles/min. These describe the code against its own
simulator, not real-world accuracy.

Real hardware, in a room of about 150 people:

| Measure | Result |
| --- | --- |
| Packet rate | About 30-50 pkt/s and uneven (target 100, backend minimum 20) |
| Packet loss over USB | About 0.1% |
| Dashboard state | Mostly "Movement detected", likely correct with that many people moving |
| Periodic pattern detection | **Not measured** |
| Empty-room baseline | **Not recorded**; built-in default thresholds in use |

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
