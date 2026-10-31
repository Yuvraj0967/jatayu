# JATAYU demo script

Say what is **live**, what is **experimental** and what is **simulated** at every step.

1. Power on; show the dashboard header (ESP32 and Arduino status, packet rate near 100 pkt/s, packet-loss ratio).
2. Press keypad **1** (or `POST /api/monitoring/start`): monitoring starts; show the event in the timeline.
3. Show the live CSI waveform/spectrum and the RF state with its separate quality and confidence labels.
4. Show the MQ raw ADC card: warm-up, baseline, threshold, and the "experimental, not a gas concentration" label.
5. Run a controlled movement experiment; show the state change and that quality gates reject bad windows.
6. When the RF pattern is observed for 20 s the state becomes `REVIEW_RECOMMENDED`; show the incident created.
7. Press **4** (inspection request): show created -> sent -> received -> executed for the LCD command.
8. Press **8** (acknowledge), add an operator note, then close the incident.
9. Show the audit timeline and stop monitoring.

Without hardware: `python app.py --simulate` (every source is badged simulated; `POST /api/simulate/key` and `/api/simulate/gas` script the keypad and gas).

Do not say "survivor detected", "breathing detected" or quote accuracy/range figures that have not been measured with a defined protocol.
