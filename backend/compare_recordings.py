"""Compare labelled CSI recordings, e.g. a crowded room against an empty one.

    python compare_recordings.py recordings/*crowded_room*.jsonl -- recordings/*empty_room*.jsonl

Groups are separated by "--". The verdict only says whether the groups differ in
the signal; it says nothing about how many people were present or who they were.
"""

from __future__ import annotations

import sys
from pathlib import Path

import numpy as np

from analyze_recording import load, replay, summarise

MIN_TRIALS = 2


def measure(path: str | Path) -> dict:
    meta, frames = load(path)
    if len(frames) < 50:
        raise ValueError(f"{path}: only {len(frames)} packets")
    return {"file": Path(path).name, "label": meta.get("label"), **summarise(frames, replay(frames), None)}


def verdict(first: list[float], second: list[float]) -> str:
    if min(len(first), len(second)) < MIN_TRIALS:
        return f"Not enough trials: record at least {MIN_TRIALS} in each group."
    if min(first) > max(second) or min(second) > max(first):
        ratio = max(np.mean(first), np.mean(second)) / max(min(np.mean(first), np.mean(second)), 1e-6)
        return f"Groups do not overlap, ratio {ratio:.1f}x. A difference in these trials, not a general result."
    return "Groups overlap: these trials do not show a clear difference."


def main() -> None:
    args = sys.argv[1:]
    if "--" not in args or args.index("--") in {0, len(args) - 1}:
        raise SystemExit("Usage: compare_recordings.py <first group files> -- <second group files>")
    split = args.index("--")
    groups = [measure(path) for path in args[:split]], [measure(path) for path in args[split + 1:]]
    print(f"{'recording':<46}{'pkts/s':>8}{'activity':>10}{'p90':>8}{'rhythm':>8}")
    for group in groups:
        for row in group:
            print(f"{row['file'][:45]:<46}{row['packets_per_s']:>8}{row.get('activity_median', 0):>10}"
                  f"{row.get('activity_p90', 0):>8}{row.get('rhythm_median', 0):>8}")
        print()
    print(verdict(*[[row.get("activity_median", 0.0) for row in group] for group in groups]))


if __name__ == "__main__":
    main()
