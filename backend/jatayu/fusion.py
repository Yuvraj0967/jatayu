"""Rule-based assessment of each evidence source plus incident grouping.

Nothing here claims a person is present. RF output is a *pattern observation*
with a data-quality grade; the gas channel is *environmental context* in raw
ADC counts. Both stay separately visible; incidents only group them in time.
"""

from __future__ import annotations

import statistics
from collections import deque
from dataclasses import dataclass
from typing import Any

# --- RF ----------------------------------------------------------------------

RF_STATES = (
    "NO_DATA", "COLLECTING", "INSUFFICIENT_DATA", "LOW_QUALITY",
    "NO_CLEAR_PERIODIC_PATTERN", "PERIODIC_PATTERN_OBSERVED", "REVIEW_RECOMMENDED",
)
RF_TEXT = {
    "NO_DATA": "No CSI stream",
    "COLLECTING": "Collecting signal",
    "INSUFFICIENT_DATA": "Insufficient data",
    "LOW_QUALITY": "Signal quality too low to assess",
    "NO_CLEAR_PERIODIC_PATTERN": "No clear periodic pattern",
    "PERIODIC_PATTERN_OBSERVED": "Periodic RF pattern observed",
    "REVIEW_RECOMMENDED": "Periodic RF pattern sustained; further investigation recommended",
}


@dataclass
class RfConfig:
    min_packet_rate_hz: float = 20.0
    good_packet_rate_hz: float = 50.0
    stale_after_s: float = 3.0
    max_loss_ratio: float = 0.30   # above this, packet loss makes the window unusable
    fair_loss_ratio: float = 0.10
    sustain_s: float = 20.0  # pattern must persist this long to recommend review
    moderate_conf: float = 0.45
    high_conf: float = 0.70


def _confidence_label(value: float, quality: str, cfg: RfConfig) -> str:
    if quality in {"none", "low"}:
        return "Insufficient data"
    if value >= cfg.high_conf and quality == "good":
        return "High"
    if value >= cfg.moderate_conf:
        return "Moderate"
    return "Low"


class RfAssessor:
    """Maps CSI telemetry onto the JATAYU RF states; data quality is graded separately."""

    def __init__(self, cfg: RfConfig | None = None) -> None:
        self.cfg = cfg or RfConfig()
        self._pattern_since: float | None = None

    @staticmethod
    def loss_ratio(telemetry: dict[str, Any]) -> float | None:
        seq = (telemetry.get("serial") or {}).get("sequence") or {}
        return seq.get("loss_ratio") if seq.get("received") else None

    def quality(self, telemetry: dict[str, Any]) -> str:
        link = telemetry.get("link") or {}
        rate = float(link.get("packet_rate_hz") or 0.0)
        age = link.get("last_frame_age_s")
        if not link.get("total_frames") or age is None or age > self.cfg.stale_after_s:
            return "none"
        loss = self.loss_ratio(telemetry)
        if rate < self.cfg.min_packet_rate_hz or (loss is not None and loss > self.cfg.max_loss_ratio):
            return "low"
        if rate < self.cfg.good_packet_rate_hz or (loss is not None and loss > self.cfg.fair_loss_ratio):
            return "fair"
        return "good"

    def assess(self, telemetry: dict[str, Any], now: float) -> dict[str, Any]:
        quality = self.quality(telemetry)
        raw_state = telemetry.get("state")
        conf = float(telemetry.get("confidence") or 0.0)
        if quality == "none":
            state = "NO_DATA"
        elif quality == "low":
            state = "LOW_QUALITY"
        elif raw_state == "warming_up":
            state = "COLLECTING"
        elif not telemetry.get("valid"):
            state = "INSUFFICIENT_DATA"
        elif raw_state == "breathing":
            state = "PERIODIC_PATTERN_OBSERVED"
        else:  # 'empty' or 'motion': no usable periodic pattern in this window
            state = "NO_CLEAR_PERIODIC_PATTERN"

        if state == "PERIODIC_PATTERN_OBSERVED":
            self._pattern_since = self._pattern_since if self._pattern_since is not None else now
            if now - self._pattern_since >= self.cfg.sustain_s:
                state = "REVIEW_RECOMMENDED"
        else:
            self._pattern_since = None

        scores = telemetry.get("scores") or {}
        return {
            "state": state,
            "text": RF_TEXT[state],
            "data_quality": quality,
            "confidence": _confidence_label(conf, quality, self.cfg) if state not in {"NO_DATA", "COLLECTING"} else "Insufficient data",
            "periodicity_score": round(float(telemetry.get("periodicity") or 0.0), 3),
            "features": {
                "rhythm": scores.get("rhythm"), "focus": scores.get("focus"), "strength": scores.get("strength"),
                "dominant_rate_per_min": telemetry.get("bpm"), "motion_index": telemetry.get("motion_index"),
                "packet_rate_hz": (telemetry.get("link") or {}).get("packet_rate_hz"),
                "packet_loss_ratio": self.loss_ratio(telemetry),
                "rssi": (telemetry.get("link") or {}).get("rssi"),
            },
            "pattern_seconds": round(now - self._pattern_since, 1) if self._pattern_since is not None else 0.0,
        }


# --- Environmental (MQ) ------------------------------------------------------

@dataclass
class GasConfig:
    warmup_s: float = 120.0
    baseline_samples: int = 30
    delta_counts: int = 120          # raise above baseline to flag ELEVATED
    hysteresis_counts: int = 30      # must fall this far inside before clearing
    stale_after_s: float = 5.0
    fixed_baseline: int | None = None


class GasAssessor:
    """Raw ADC counts only. No ppm, no gas identification: calibration is always reported."""

    def __init__(self, cfg: GasConfig | None = None) -> None:
        self.cfg = cfg or GasConfig()
        self.first_reading_at: float | None = None
        self.last_reading_at: float | None = None
        self.last_raw: int | None = None
        self.model = "UNKNOWN"
        self.calibration = "NOT_CALIBRATED"
        self.baseline: float | None = float(self.cfg.fixed_baseline) if self.cfg.fixed_baseline is not None else None
        self._warm_samples: list[int] = []
        self._elevated = False
        self.recent: deque[tuple[float, int]] = deque(maxlen=600)

    def add(self, raw: int, now: float, model: str = "UNKNOWN", calibration: str = "NOT_CALIBRATED") -> None:
        self.model, self.calibration = model, calibration
        self.first_reading_at = self.first_reading_at if self.first_reading_at is not None else now
        self.last_reading_at, self.last_raw = now, raw
        self.recent.append((now, raw))
        if self.baseline is None and now - self.first_reading_at >= self.cfg.warmup_s:
            self._warm_samples.append(raw)
            if len(self._warm_samples) >= self.cfg.baseline_samples:
                self.baseline = float(statistics.median(self._warm_samples))

    def rebaseline(self) -> None:
        self.baseline, self._warm_samples, self._elevated = None, [], False
        self.first_reading_at = self.last_reading_at

    def assess(self, now: float) -> dict[str, Any]:
        cfg = self.cfg
        if self.last_reading_at is None:
            status, quality = "NO_DATA", "none"
        elif now - self.last_reading_at > cfg.stale_after_s:
            status, quality = "STALE", "stale"
        elif self.baseline is None:
            status = "WARMING_UP" if now - (self.first_reading_at or now) < cfg.warmup_s else "BASELINING"
            quality = "warming_up"
        else:
            delta = (self.last_raw or 0) - self.baseline
            if self._elevated:
                self._elevated = delta > cfg.delta_counts - cfg.hysteresis_counts
            else:
                self._elevated = delta >= cfg.delta_counts
            status, quality = ("ELEVATED" if self._elevated else "NORMAL"), "experimental"
        return {
            "status": status, "data_quality": quality, "raw_adc": self.last_raw, "unit": "adc_counts",
            "baseline_adc": round(self.baseline, 1) if self.baseline is not None else None,
            "threshold_adc": round(self.baseline + cfg.delta_counts, 1) if self.baseline is not None else None,
            "model": self.model, "calibration": self.calibration,
            "warmup_remaining_s": max(0.0, round(cfg.warmup_s - (now - self.first_reading_at), 1)) if self.first_reading_at else cfg.warmup_s,
            "age_s": round(now - self.last_reading_at, 1) if self.last_reading_at else None,
            "disclaimer": "Experimental raw ADC reading. Not a calibrated or certified gas concentration.",
        }


# --- Incidents -----------------------------------------------------------------

OBSERVATION_LABELS = {
    "rf_pattern": "Periodic RF pattern observed",
    "rf_review": "Sustained RF pattern: further investigation recommended",
    "env_elevated": "Environmental sensor reading elevated against baseline",
    "inspection_request": "Operator requested inspection",
    "alert_request": "Operator alert request (keypad *)",
    "operator_note": "Operator note",
    "manual": "Incident opened by operator",
}
