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


PITCH_MIN_HZ, PITCH_MAX_HZ = 100.0, 1800.0
LOUD_DB, MEDIUM_DB = -22.0, -38.0  # rough, for a laptop microphone at normal input volume

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


def voice_pitch(samples: np.ndarray) -> tuple[float, float]:
    """(pitch in Hz, clarity 0-1) from autocorrelation. Clarity is high for a pitched voice, low for noise."""

    centred = samples.astype(float) - float(np.mean(samples))
    power = float(np.dot(centred, centred))
    if power <= 1e-12:
        return 0.0, 0.0
    spectrum = np.fft.rfft(centred, 2 * centred.size)
    correlation = np.fft.irfft(spectrum * np.conj(spectrum))[: centred.size] / power
    low, high = int(SAMPLE_RATE / PITCH_MAX_HZ), min(int(SAMPLE_RATE / PITCH_MIN_HZ), centred.size - 1)
    lag = low + int(np.argmax(correlation[low:high]))
    return SAMPLE_RATE / lag, float(max(correlation[lag], 0.0))


def proximity_from_level(level_db: float) -> str:
    """A rough label from loudness alone: a quiet voice nearby reads the same as a loud one far away."""

    if level_db >= LOUD_DB:
        return "close"
    return "medium" if level_db >= MEDIUM_DB else "far"


@dataclass
class Alert:
    kind: str
    text: str
    score: float
    level_db: float = -90.0
    proximity: str = "far"


class SustainedVoice:
    """Finds "aaaa" and "eeee": a pitched voice held far longer than a vowel in normal speech.

    A trained classifier misses many of these, so this looks at the sound directly.
    Machines and beeps hold a pitch too exactly, so near-perfect steadiness is rejected.
    """

    def __init__(self, min_seconds: float = 1.0, block_seconds: float = 0.1) -> None:
        self.needed = int(round(min_seconds / block_seconds))
        self.block_seconds = block_seconds
        self.pitches: list[float] = []
        self.clarity: list[float] = []
        self.gap = 0
        self.floor: deque = deque(maxlen=200)

    def feed(self, samples: np.ndarray) -> tuple[float, float] | None:
        """One 0.1 s block. Returns (seconds held, score) once a sustained voice qualifies."""

        filtered = signal.sosfilt(_HIGH_PASS, samples.astype(float))
        level = rms(filtered)
        floor = float(np.median(self.floor)) if len(self.floor) >= 10 else level
        pitch, clarity = voice_pitch(filtered)
        voiced = level >= 1.5e-4 and level >= floor * 2.0 and clarity >= 0.45
        if not voiced:
            self.floor.append(level)  # only non-voice blocks teach the room's noise level
            self.gap += 1
            if self.gap > 0:  # any break ends it: normal speech is full of short gaps
                self.pitches, self.clarity = [], []
            return None
        self.gap = 0
        self.pitches.append(pitch)
        self.clarity.append(clarity)
        if len(self.pitches) < self.needed:
            return None
        recent = np.asarray(self.pitches[-self.needed:])
        # Natural voices waver in pitch; a tone or beep holds it exactly.
        if float(np.std(recent) / np.mean(recent)) < 0.004 and float(np.ptp(recent)) < 2.0:
            return None
        seconds = len(self.pitches) * self.block_seconds
        return seconds, min(1.0, float(np.mean(self.clarity)) * min(1.0, seconds / 1.2))


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
    _sustained: SustainedVoice = field(default_factory=SustainedVoice)
    _recent_levels: deque = field(default_factory=lambda: deque(maxlen=30))
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
        level_db = max(self._recent_levels, default=-90.0)
        return Alert(kind, f"{ALERT_TEXT[kind]}{f': {detail}' if detail else ''}", round(float(score), 3),
                     round(level_db, 1), proximity_from_level(level_db))

    def on_block(self, samples: np.ndarray, now: float) -> Alert | None:
        """One 0.1 s block of unboosted audio: tracks loudness and sustained voices."""

        self._recent_levels.append(20.0 * np.log10(max(rms(samples), 1e-5)))
        found = self._sustained.feed(samples)
        if found is None:
            return None
        self._last_voice = now
        return self._emit("scream", found[1], now, "sustained voice")

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
        spoken = [w["word"] for w in confident]
        for candidate in HELP_PHRASES:
            target = candidate.split()
            # Whole words in order, so "helping" or "helpful" is not a call for help.
            for start in range(len(spoken) - len(target) + 1):
                if spoken[start:start + len(target)] == target:
                    score = min(float(w["conf"]) for w in confident[start:start + len(target)])
                    return self._emit("help", score, now, f'"{candidate}"')
        return None
