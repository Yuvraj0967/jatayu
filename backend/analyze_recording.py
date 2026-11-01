"""Score a capture_raw.py recording against a breath count taken by hand.

    python analyze_recording.py recordings/<file>.jsonl --breaths 42
    python analyze_recording.py recordings/<file>.jsonl          # no reference, e.g. empty room

Replays the packets through the same pipeline the dashboard uses, then reports
what the signal contained. Nothing is written back to the recording.
"""

from __future__ import annotations

import argparse
import json
import tempfile
from collections import Counter
from pathlib import Path

import numpy as np

from processing import CSIFrame, CSIProcessor, ProcessorConfig

TOLERANCE_BPM = 2.0


def load(path: str | Path) -> tuple[dict, list[CSIFrame]]:
    meta: dict = {}
    frames: list[CSIFrame] = []
    with open(path, encoding="utf-8") as handle:
        for line in handle:
            record = json.loads(line)
            if record["type"] == "meta":
                meta = record
            elif record["type"] == "csi":
                frames.append(CSIFrame(record["t"], record["rssi"], np.asarray(record["amp"], dtype=float)))
    return meta, frames


def replay(frames: list[CSIFrame]) -> list[dict]:
    """One pipeline result per second of recording, once a window can exist."""

    calibration = Path(tempfile.mkdtemp()) / "unused.json"
    processor = CSIProcessor(ProcessorConfig(), calibration_path=str(calibration))
    results: list[dict] = []
    next_tick = frames[0].timestamp_s + 1.0
    for frame in frames:
        processor.add_frame(frame)
        if frame.timestamp_s >= next_tick:
            results.append(processor.telemetry(frame.timestamp_s))
            next_tick += 1.0
    return results


def summarise(frames: list[CSIFrame], results: list[dict], breaths: float | None) -> dict:
    duration = frames[-1].timestamp_s - frames[0].timestamp_s
    gaps = np.diff([frame.timestamp_s for frame in frames])
    rssi = [frame.rssi for frame in frames]
    valid = [result for result in results if result.get("valid")]
    rates = np.asarray([r["bpm_instant"] for r in valid if r.get("bpm_instant") is not None], dtype=float)
    summary: dict = {
        "duration_s": round(duration, 1),
        "packets_per_s": round(len(frames) / max(duration, 1e-6), 1),
        "longest_gap_s": round(float(gaps.max()), 2) if gaps.size else 0.0,
        "rssi_median": float(np.median(rssi)),
        "states": dict(Counter(result["state"] for result in results)),
        "windows": len(valid),
    }
    if valid:
        for name in ("rhythm", "focus", "strength"):
            summary[f"{name}_median"] = round(float(np.median([r["scores"][name] for r in valid])), 2)
        summary["confidence_median"] = round(float(np.median([r["confidence"] for r in valid])), 2)
        # Faster signal changes (0.8-4 Hz) relative to noise: compares a still room with a busy one.
        activity = [r["motion_index"] for r in valid]
        summary["activity_median"] = round(float(np.median(activity)), 2)
        summary["activity_p90"] = round(float(np.percentile(activity, 90)), 2)
    if rates.size:
        summary["estimated_rate_median"] = round(float(np.median(rates)), 1)
        summary["estimated_rate_range"] = [round(float(np.percentile(rates, q)), 1) for q in (10, 90)]
    if breaths is not None:
        reference = breaths * 60.0 / duration
        summary["counted_rate"] = round(reference, 1)
        if rates.size:
            summary["error_bpm"] = round(abs(float(np.median(rates)) - reference), 1)
            summary["windows_within_2bpm_pct"] = round(float(np.mean(np.abs(rates - reference) <= TOLERANCE_BPM)) * 100, 1)
    return summary


def main() -> None:
    parser = argparse.ArgumentParser(description="Score a raw CSI recording")
    parser.add_argument("recording")
    parser.add_argument("--breaths", type=float, help="breaths counted by hand during the whole recording")
    args = parser.parse_args()
    if args.breaths is not None and not 0.0 <= args.breaths <= 2000.0:
        raise SystemExit("--breaths must be between 0 and 2000.")
    meta, frames = load(args.recording)
    if len(frames) < 50:
        raise SystemExit(f"Only {len(frames)} packets in this recording: nothing to analyse.")
    summary = summarise(frames, replay(frames), args.breaths)
    print(f"label: {meta.get('label')}  simulated: {meta.get('simulated')}")
    for key, value in summary.items():
        print(f"{key}: {value}")


if __name__ == "__main__":
    main()
