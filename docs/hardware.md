# Hardware record

Update this file whenever the physical setup changes. Verify before buying anything.

| Item | Status |
| --- | --- |
| Raspberry Pi | **Pi 4 Model B** (8 GB per the inventory check). The earlier docs said Pi 5; nothing in the software depends on it. |
| Pi storage | 16 GB microSD. Fine for setup; upgrade to a reputable 32/64 GB before long captures. Never store raw CSI indefinitely. |
| ESP32-S3 dev board | Two USB sockets: CH343 UART bridge (`1a86:55d3`) and native USB (`303a:1001`). The current firmware prints on native USB, so connect that socket to the Pi. Record the exact module marking, flash/PSRAM and antenna type. |
| Arduino UNO | Reads the MQ-135 and keypad; firmware in `arduino/jatayu_uno`. No LCD on this board. |
| MQ-135 | VCC 5V, GND, AO to A0, DO unused. Raw ADC counts only, never ppm. Heater draws about 150 mA from the UNO's 5 V: watch `vcgencmd get_throttled` on the Pi. |
| 4x4 keypad | Ribbon wires 1-8 to D2-D9, connected in reverse: D2-D5 reach columns right to left, D6-D9 rows bottom to top. The firmware table matches this, so keep the wiring order. Inferred from key-press history; confirm all 16 keys. |
| 3 x 2 kOhm resistors | Not needed with USB serial. |
| Power supply | Check the label for the Pi (5 V, 3 A class). |

Wiring rules: USB data connections between boards and the Pi; never put 5 V on Pi or ESP32 GPIO; never
power an MQ heater from a GPIO pin; verify LCD backpack pull-up voltage.

## Pi 4B budget

The backend does one ~35 ms (desktop-class CPU) analysis per second; expect a few times that on a Pi 4B.
Check `performance.tick_ms` in `/api/status` and the CSI cycle on the board. If it falls behind, analyse every 2 s.
The database stores only derived rows (pruned after 7 days), about 9 MB/day for gas readings.
Build the dashboard on another machine and serve the static files from the Pi.
