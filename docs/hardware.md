# Hardware record

Update this file whenever the physical setup changes. Verify before buying anything.

| Item | Status |
| --- | --- |
| Raspberry Pi | **Pi 4 Model B** (8 GB per the inventory check). The earlier docs said Pi 5; nothing in the software depends on it. |
| Pi storage | 16 GB microSD. Fine for setup; upgrade to a reputable 32/64 GB before long captures. Never store raw CSI indefinitely. |
| ESP32-S3 dev board | Two USB sockets: CH343 UART bridge (`1a86:55d3`) and native USB (`303a:1001`). The current firmware prints on native USB, so connect that socket to the Pi. Record the exact module marking, flash/PSRAM and antenna type. |
| Arduino Mega 2560 R3 | Peripheral controller (keypad, LCD, MQ sensor). Firmware not written yet. |
| MQ-series sensor | **Model unconfirmed.** Read the printed part number before any interpretation. Raw ADC counts only, never ppm. |
| 16x2 LCD | **Interface unconfirmed** (I2C backpack vs 16-pin parallel). Check before wiring. |
| 4x4 keypad | Proposed mapping R1-R4 -> D22-D25, C1-C4 -> D26-D29; confirm ribbon order with a key test. |
| 3 x 2 kOhm resistors | Not needed with USB serial. |
| Power supply | Check the label for the Pi (5 V, 3 A class). |

Wiring rules: USB data connections between boards and the Pi; never put 5 V on Pi or ESP32 GPIO; never
power an MQ heater from a GPIO pin; verify LCD backpack pull-up voltage.

## Pi 4B budget

The backend does one ~35 ms (desktop-class CPU) analysis per second; expect a few times that on a Pi 4B.
Check `performance.tick_ms` in `/api/status` and the CSI cycle on the board. If it falls behind, analyse every 2 s.
The database stores only derived rows (pruned after 7 days), about 9 MB/day for gas readings.
Build the dashboard on another machine and serve the static files from the Pi.
