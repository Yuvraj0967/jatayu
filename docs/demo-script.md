# JATAYU demo script

About 4 minutes. Open `http://192.168.137.10:8000` on the laptop. Check beforehand that the hotspot is on, the header says
`Live hardware` and packets are arriving.

| Time | Do | Say |
| --- | --- | --- |
| 0:00 | Show the ESP32, the Pi and the laptop | "JATAYU reads tiny changes in ordinary Wi-Fi signals and turns them into observations a person can review. No camera and no wearable." |
| 0:30 | Open `/csi`; show packet rate, RSSI and the waveform | "The figure is an illustration of the setup, not a detection. This is live. The ESP32 captures channel-state data from about 50 packets a second and sends it to the Raspberry Pi over USB. All processing is local." |
| 1:15 | Point at the rate, then wave near the ESP32 | "The Pi updates this reading every second, within a 11 to 30 cycles per minute range. Watch the signal respond to movement. We have not yet proven in testing that this number tracks real breathing." |
| 2:00 | Press `7` | "To show how the workflow behaves when a steady rhythm is present, I'm switching to simulated data. From here until I switch back, nothing on screen is measured." |
| 2:20 | On `/csi` the rate goes 14 to 19 and back and the 3D figure animates; then open the console at `/` and start monitoring | "This is the operator's view. A sustained pattern becomes an observation for a person to review, not an automatic conclusion." |
| 3:00 | Press `7` again | "Back on real data." |
| 3:10 | Show the report's results section | "Our data path works on real hardware with about 0.1% packet loss. In our first real trial, in a busy room, we did not find a clear breathing rhythm. Next: quieter trials with a hand count, and testing the Arduino gas sensor and keypad on the real board." |

**Rules for the demo**

- Say out loud when you press `7` and when you switch back. The screen has no simulation label.
- Do not say "survivor detected" or "breathing detected", and do not quote simulator figures as real accuracy.
- If asked about the Arduino: the firmware is written and compiled, and is being tested on the board. Pressing 0 and a digit reports lives saved, entered by the operator.

**If something fails:** with no packets, check the USB cable is in the ESP32's native USB socket and the hotspot is on, then restart with `sudo systemctl restart jatayu`.
