# ESP32-S3 CSI node

The ESP32-S3 is a **CSI acquisition node**. It captures Wi-Fi CSI, adds metadata
and counters, and streams raw records to the Raspberry Pi over USB serial. It
does no sensing decisions: filtering, periodicity, quality grading, storage and
incidents all live on the Pi, so every intermediate signal can be plotted and
compared against recorded data.

Design rules (from the ESP32 engineering report):

- Keep the Wi-Fi callback short: copy into a bounded queue, never block, never format or print there.
- A dropped record is a measurement gap, not something to hide: it must be countable.
- RAW output always exists. A feature mode is only added after the Pi reference
  pipeline is validated against raw captures (`MODE,FEATURE` is rejected today).
- Never mix debug text into the data stream: status lines start with `#`.

## Wire protocol v1 (921600 baud, one line per record)

```text
CSI1,<seq>,<timestamp_us>,<rssi_dbm>,<noise_floor_dbm>,<channel>,<flags>,<amp_0>,<amp_1>,...
```

| Field | Meaning |
| --- | --- |
| `seq` | Increments for every CSI callback accepted **before** queueing, so a queue overflow or lost serial line appears as a gap on the Pi. A drop back to a small value means the board rebooted (not loss). |
| `timestamp_us` | Board monotonic microseconds at callback time. Not wall-clock; the Pi maps it to host time. |
| `rssi_dbm`, `noise_floor_dbm`, `channel` | From the packet's `rx_ctrl`. |
| `flags` | bit0 = `first_word_invalid` (ESP32-S3 hardware limitation; the first two subcarriers are emitted as `0.0`). |
| `amp_*` | Gain-compensated magnitude `sqrt(I^2+Q^2)`, one decimal place. 64 values on HT20; 128 if an HT40 packet slips through (the Pi discards stray-width rows). |

Status lines (never contain CSI data):

```text
#JATAYU,proto=1,node=jatayu_rx_01,role=csi_receiver,chip=esp32s3,fw=3.1,idf=...,reset=poweron,mode=router,...,output=RAW,format=CSI1
#STAT,pps=...,dropped=...,rx=...,tx=...,qhw=...,seq=...,uptime_s=...,heap=...,min_heap=...,stream=1,node=...   (every 2 s, even with no packets)
#WIFI,connected|disconnected|got_ip,...      #GAIN,...      #PING,...
```

Host commands (one per line): `STATUS`, `PING` (-> `#PONG`), `RESET_GAIN`,
`STREAM,0|1` (pause/resume capture), `MODE,RAW` (`MODE,FEATURE` -> `#ERR,mode_not_supported`).
Unknown lines are ignored.

## What the Pi measures from this stream

`GET /api/status` (`csi_link`) reports, per node: packet rate, sequence `received`,
`lost`, `gaps`, `duplicates`, `reboots`, `loss_ratio`. A window is graded
`LOW_QUALITY` when packet rate is below 20 Hz or loss exceeds 30 %, and `fair`
above 10 % loss. Nothing is interpolated.

## Throughput

At 100 records/s each line is roughly 64 values x ~5 bytes + a 40-byte prefix, about 36 KB/s,
against ~92 KB/s available at 921600 baud. Check `#STAT` `dropped` and the Pi's
`loss_ratio` after any change to rate or payload. If they climb, move to a binary
frame (length, version, seq, checksum) before raising the rate.

## Not yet done (honest status)

- Built with ESP-IDF v5.5.6 and running on the board. The current build prints on the native USB socket (`-Console usb`), so the UART socket goes silent after the ROM boot lines.
- No on-device feature mode, and no multi-node ingestion yet (nodes can be registered with deployment metadata via `/api/nodes`).
- Breathing-rate claims need the labelled experiments in the engineering report (milestones 3-4) with an independent reference.
- Report suggests ESP-IDF 5.3.6; this project is pinned to v5.5.x (see `firmware-setup.md`). Record `idf.py --version` in your test log.
