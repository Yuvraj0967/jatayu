"""Decides when audio is worth reporting. No microphone or model code here, so it is testable.

Faint sounds are the point: audio is high-passed, measured against the room's own
noise level and boosted before classification. A weak score must repeat before
it counts, which is what keeps the sensitive thresholds usable.
"""

from __future__ import annotations

from collections import deque
from dataclasses import dataclass, field

import numpy as np
from scipy import signal

SAMPLE_RATE = 16000
MAX_GAIN = 40.0
TARGET_PEAK = 0.5

# YAMNet class names -> what we report.
SOUND_KINDS = {
    "Screaming": "scream",
    "Shout": "scream",
    "Yell": "scream",
    "Children shouting": "scream",
    "Crying, sobbing": "distress",
    "Whimper": "distress",
    "Wail, moan": "distress",
    "Groan": "distress",
}
ALERT_TEXT = {
    "scream": "Possible scream heard",
    "distress": "Possible distress sound heard",
    "help": "Possible call for help heard",
}
HELP_PHRASES = ("help me", "somebody help", "please help", "save me", "help")
VOICE_CLASSES = ("Speech", "Shout", "Yell", "Screaming", "Children shouting", "Crying, sobbing", "Whimper", "Wail, moan", "Groan", "Narration, monologue", "Conversation")


_HIGH_PASS = signal.butter(4, 120.0, btype="highpass", fs=SAMPLE_RATE, output="sos")


def condition(samples: np.ndarray) -> np.ndarray:
    """Removes rumble and lifts quiet audio to a level the models expect."""

    filtered = signal.sosfilt(_HIGH_PASS, samples.astype(float))
    peak = float(np.max(np.abs(filtered))) if filtered.size else 0.0
    if peak < 1e-5:
        return filtered.astype(np.float32)
    return (filtered * min(TARGET_PEAK / peak, MAX_GAIN)).astype(np.float32)


def rms(samples: np.ndarray) -> float:
    return float(np.sqrt(np.mean(np.square(samples.astype(float))))) if samples.size else 0.0


@dataclass
class Alert:
    kind: str
    text: str
    score: float


@dataclass
class AudioDetector:
    strong_score: float = 0.35  # one window is enough
    weak_score: float = 0.10  # must repeat within the recent windows
    weak_hits_needed: int = 2
    recent_windows: int = 4
    gate_ratio: float = 1.25  # louder than this x the room's noise level
    min_level: float = 2e-4  # below this the microphone is effectively silent
    word_confidence: float = 0.55
    voice_score: float = 0.15
    voice_memory_s: float = 3.0
    _last_voice: float = -1e9
    cooldown_s: float = 5.0
    _levels: deque = field(default_factory=lambda: deque(maxlen=60))
    _recent: dict = field(default_factory=dict)
    _last_alert: dict = field(default_factory=dict)

    def above_noise(self, samples: np.ndarray) -> bool:
        """True when this window stands out from the room. Learns the room as it goes."""

        level = rms(signal.sosfilt(_HIGH_PASS, samples.astype(float)))
        floor = float(np.median(self._levels)) if self._levels else level
        self._levels.append(level)
        return level >= self.min_level and level >= floor * self.gate_ratio

    def _emit(self, kind: str, score: float, now: float, detail: str = "") -> Alert | None:
        if now - self._last_alert.get(kind, -1e9) < self.cooldown_s:
            return None
        self._last_alert[kind] = now
        return Alert(kind, f"{ALERT_TEXT[kind]}{f': {detail}' if detail else ''}", round(float(score), 3))

    def on_sound_scores(self, scores: dict[str, float], now: float) -> Alert | None:
        """scores: YAMNet class name -> score for one window."""

        if max(float(scores.get(name, 0.0)) for name in VOICE_CLASSES) >= self.voice_score:
            self._last_voice = now
        best: dict[str, tuple[float, str]] = {}
        for name, kind in SOUND_KINDS.items():
            value = float(scores.get(name, 0.0))
            if value > best.get(kind, (0.0, ""))[0]:
                best[kind] = (value, name)
        for kind in ("scream", "distress"):
            value, name = best.get(kind, (0.0, ""))
            history = self._recent.setdefault(kind, deque(maxlen=self.recent_windows))
            history.append(value)
            weak_hits = sum(item >= self.weak_score for item in history)
            if value >= self.strong_score or (value >= self.weak_score and weak_hits >= self.weak_hits_needed):
                history.clear()
                return self._emit(kind, value, now, name.lower())
        return None

    def on_words(self, words: list[dict], now: float) -> Alert | None:
        """words: speech-recogniser output, [{"word": ..., "conf": ...}, ...].

        Needs a recent voice from the sound classifier, so boosted noise cannot pass as a word.
        """

        if now - self._last_voice > self.voice_memory_s:
            return None
        confident = [w for w in words if w.get("word") != "[unk]" and float(w.get("conf", 0.0)) >= self.word_confidence]
        phrase = " ".join(w["word"] for w in confident)
        for candidate in HELP_PHRASES:
            if candidate in phrase:
                score = min(float(w["conf"]) for w in confident if w["word"] in candidate.split())
                return self._emit("help", score, now, f'"{candidate}"')
        return None
