"""Record raw CSI to a file for offline analysis (engineering report, milestones 2-4).

Writes newline-delimited JSON: one metadata header, then one record per packet
(seq, timestamp, rssi, channel, amplitudes). Every trial should be labelled
with its geometry so results can be reproduced and compared.

    python capture_raw.py --label empty_room --duration 300 --distance-m 3 --channel 6
    python capture_raw.py --label walking --duration 120 --notes "walk past at 1 m" --simulate

Files go to recordings/ (git-ignored). Capture is bounded by --duration and
--max-mb so a forgotten run cannot fill the Pi's SD card.
"""

from __future__ import annotations

import argparse
import json
import re
import time
from pathlib import Path

from processing import CSIFrame
from serial_io import SerialCSIReader, SimulatedCSIProducer


class RawRecorder:
    def __init__(self, path: Path, metadata: dict, max_bytes: int) -> None:
        self.path, self.max_bytes = path, max_bytes
        path.parent.mkdir(parents=True, exist_ok=True)
        self.file = path.open("w", encoding="utf-8")
        self.bytes = 0
        self.frames = 0
        self.full = False
        self._write({"type": "meta", "format": "jatayu-raw-v1", "started_at": time.time(), **metadata})

    def _write(self, obj: dict) -> None:
        line = json.dumps(obj, separators=(",", ":")) + "\n"
        self.file.write(line)
        self.bytes += len(line)

    def add(self, frame: CSIFrame) -> None:
        if self.full:
            return
        if self.bytes >= self.max_bytes:
            self.full = True
            return
        self._write({"type": "csi", "seq": frame.seq, "t": round(frame.timestamp_s, 6), "rssi": frame.rssi,
                     "ch": frame.channel, "noise": frame.noise_floor, "fwi": frame.first_word_invalid,
                     "amp": [round(float(a), 1) for a in frame.amplitudes]})
        self.frames += 1

    def close(self, extra: dict | None = None) -> None:
        self._write({"type": "end", "ended_at": time.time(), "frames": self.frames, "truncated": self.full, **(extra or {})})
        self.file.close()


def parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(description="Record labelled raw CSI trials")
    p.add_argument("--label", required=True, help="trial label, e.g. empty_room, walking, stationary_person")
    p.add_argument("--duration", type=float, default=120.0, help="seconds to record")
    p.add_argument("--port", default="auto", help="ESP32 serial port (default: auto)")
    p.add_argument("--baud", type=int, default=921600)
    p.add_argument("--distance-m", type=float, help="transmitter-receiver distance")
    p.add_argument("--channel", type=int, help="Wi-Fi channel in use")
    p.add_argument("--notes", default="", help="free-text: orientation, layout, who moved where")
    p.add_argument("--max-mb", type=float, default=50.0, help="stop writing after this size")
    p.add_argument("--out-dir", default=str(Path(__file__).resolve().parent / "recordings"))
    p.add_argument("--simulate", action="store_true", help="record the built-in simulator (marked simulated)")
    return p.parse_args()


def main() -> None:
    args = parse_args()
    if not 1.0 <= args.duration <= 3600.0 or not 0.1 <= args.max_mb <= 500.0:
        raise SystemExit("Limits: --duration 1 to 3600 seconds, --max-mb 0.1 to 500.")
    safe = re.sub(r"[^A-Za-z0-9_-]+", "_", args.label)[:40]
    path = Path(args.out_dir) / f"{time.strftime('%Y%m%d-%H%M%S')}_{safe}{'_SIMULATED' if args.simulate else ''}.jsonl"
    meta = {"label": args.label, "distance_m": args.distance_m, "channel": args.channel, "notes": args.notes,
            "simulated": args.simulate, "duration_s": args.duration}
    recorder = RawRecorder(path, meta, int(args.max_mb * 1024 * 1024))
    print(f"Recording {args.duration:.0f} s to {path}")
    reader = None
    try:
        if args.simulate:
            sim = SimulatedCSIProducer()
            for frame in sim.prime(args.duration):
                recorder.add(frame)
        else:
            reader = SerialCSIReader(args.port, args.baud, on_frame=recorder.add)
            reader.start()
            end = time.monotonic() + args.duration
            while time.monotonic() < end:
                time.sleep(1.0)
                print(f"\r  frames={recorder.frames}  state={reader.state}  ", end="", flush=True)
    except KeyboardInterrupt:
        print("\nStopped early.")
    finally:
        extra = {}
        if reader is not None:
            reader.stop()
            extra = {"sequence": reader.parser.seq.status(), "parse_errors": reader.parser.dropped}
        recorder.close(extra)
    print(f"\nSaved {recorder.frames} frames ({recorder.bytes / 1e6:.1f} MB){' [truncated]' if recorder.full else ''}")


if __name__ == "__main__":
    main()
