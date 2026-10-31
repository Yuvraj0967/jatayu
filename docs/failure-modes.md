# Failure modes and fast fixes

| Symptom | Likely cause | Fast fix | Preserve for demo |
| --- | --- | --- | --- |
| No `CSI1,` lines | CSI not enabled, wrong Wi-Fi SSID/password, AP unavailable, serial monitor owns port | Verify the router is 2.4 GHz; fix credentials in `firmware\sdkconfig.wifi` and re-flash; the dashboard shows the board's own `#WIFI` reason (e.g. "network not found", "wrong password?"); close the monitor, then let the backend own the port | Use `-Simulate` only as a clearly labelled fallback |
| CSI rate below 80 Hz | Hotspot/router rate-limits ICMP, busy Wi-Fi, serial congestion | Use a fixed 2.4 GHz router; disable auto-channel; raise UART to 921600; switch to official second-board `csi_send` | Explain router vs dedicated-TX modes |
| No Wi-Fi association | Phone is 5 GHz-only, WPA mode mismatch, band steering | Enable 2.4 GHz compatibility SSID/WPA2; use a travel router | Bring the travel router / TX board |
| Garbled or dropped CSV | Baud mismatch, another program uses COM port, too much logging | Match 921600; close monitor; leave `#` logs filtered; inspect backend frame counter | Fix the serial stream before continuing the live demo |
| Constant false breathing | Fan, curtain, moving people, HVAC, periodic equipment | Remove motion; record a new empty baseline; change channel; shorten field of view via placement | Say `MOTION — VERIFY`, not survivor confirmed |
| BPM outside 6–30 | Gross body motion or spectral leakage | Ask subject to stay still; wait for window to refill; verify bandpass settings; lower confidence threshold only after baseline | Use slow breathing volunteer |
| BPM unstable/low confidence | Weak multipath modulation, person too far, bad antenna orientation | Move RX/TX for stronger multipath; use an external antenna; reduce range; add a second link | Show calibrated uncertainty / demo stream |
| Proximity wrong | RSSI/SNR is environment-dependent, wall/geometry changed | Re-run all six calibration labels after any geometry/channel change | Always call it “estimated proximity” |
| Firmware build error | Wrong IDF major version or unresolved component | Use clean ESP-IDF v5.5.6 shell; run `idf.py fullclean`, then `idf.py build`; ensure network for component manager | Build before arrival |
| Person too far / behind dense metal | Link budget/penetration is insufficient | Shorten link, change placement, use more capable antenna or second link; do not increase claims | State physical limits honestly |
| Channel hops mid-demo | Router auto-channel/band steering | Lock 2.4 GHz channel; assign fixed channel to direct ESP-NOW pair | Use direct TX fallback |

## Triage order at the venue

1. Check the receiver serial port and confirm 80–120 `CSI1,` rows per second.
2. Confirm the ESP32 joined the fixed 2.4 GHz router; recheck SSID/password in menuconfig if it did not.
3. Lock the router's 2.4 GHz channel and retest.
4. Re-run the empty-room baseline.
5. If sample rate remains poor, flash/switch to the official two-ESP32 sender path.
6. If RF is still poor, use simulated telemetry only with an explicit fallback label alongside any recorded live evidence; do not fabricate a live detection.
| Sequence gaps / high packet-loss ratio | Firmware queue overflow, serial bandwidth, noisy USB cable, wrong baud | Check `#STAT` `qhw`/`dropped`; use a short data cable; keep 921600 baud; on the Pi prefer the native USB port | Window is graded LOW_QUALITY above 30% loss; never interpolate missing packets |
| Only ROM boot lines on serial, then silence, while the board is still on Wi-Fi | Cable is in the USB socket the firmware does not print on | Move the cable at the ESP32 end to the other socket | Check `lsusb`: `303a:1001` is native USB, `1a86:55d3` is the UART bridge |
| About 5 pkt/s with `dropped=0` | Gateway ignores the pings (e.g. Windows firewall on a laptop hotspot), so CSI comes mostly from beacons | Allow ICMP echo on the gateway; see firmware-setup.md | Ping the gateway from the Pi to confirm |
| `#JATAYU` banner shows `reset=panic`/`watchdog`/`brownout` | Crash, stuck task, weak USB supply | Use a quality cable and a powered port; capture the serial log | Report the reset; do not trust the window straddling it |
