"""SQLite persistence. Raw observations and derived assessments live in
separate tables so any displayed state can be traced back to its evidence."""

from __future__ import annotations

import json
import sqlite3
import threading
import time
from pathlib import Path
from typing import Any, Iterable

SCHEMA = """
CREATE TABLE IF NOT EXISTS devices (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_type TEXT NOT NULL UNIQUE,
    device_name TEXT,
    status TEXT NOT NULL,
    last_seen_at REAL
);
CREATE TABLE IF NOT EXISTS sensor_readings (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    device_type TEXT NOT NULL,
    sensor_type TEXT NOT NULL,
    raw_value REAL NOT NULL,
    unit TEXT NOT NULL,
    quality_status TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'live',
    recorded_at REAL NOT NULL,
    metadata_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_readings_time ON sensor_readings(recorded_at);
CREATE TABLE IF NOT EXISTS rf_observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    pattern_state TEXT NOT NULL,
    signal_quality TEXT NOT NULL,
    confidence TEXT NOT NULL,
    periodicity_score REAL,
    spectral_features_json TEXT,
    source TEXT NOT NULL DEFAULT 'live',
    recorded_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_rf_time ON rf_observations(recorded_at);
CREATE TABLE IF NOT EXISTS incidents (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    incident_code TEXT NOT NULL UNIQUE,
    status TEXT NOT NULL,
    summary TEXT NOT NULL,
    source TEXT NOT NULL DEFAULT 'live',
    created_at REAL NOT NULL,
    updated_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS incident_observations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    incident_id INTEGER NOT NULL REFERENCES incidents(id),
    observation_type TEXT NOT NULL,
    source_id INTEGER,
    detail_json TEXT,
    created_at REAL NOT NULL
);
CREATE TABLE IF NOT EXISTS events (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    incident_id INTEGER,
    event_type TEXT NOT NULL,
    actor TEXT NOT NULL,
    payload_json TEXT,
    created_at REAL NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_events_time ON events(created_at);
CREATE TABLE IF NOT EXISTS commands (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    target TEXT NOT NULL,
    args_json TEXT,
    state TEXT NOT NULL,
    created_at REAL NOT NULL,
    sent_at REAL,
    received_at REAL,
    executed_at REAL,
    acknowledged_at REAL,
    failure TEXT
);
CREATE TABLE IF NOT EXISTS operator_acknowledgements (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    incident_id INTEGER NOT NULL REFERENCES incidents(id),
    operator_action TEXT NOT NULL,
    notes TEXT,
    channel TEXT NOT NULL,
    acknowledged_at REAL NOT NULL
);
"""


def _dump(value: Any) -> str | None:
    return None if value is None else json.dumps(value, separators=(",", ":"), default=str)


def _load(value: str | None) -> Any:
    return None if value is None else json.loads(value)


class Store:
    """Thread-safe wrapper: serial threads and the event loop both write."""

    def __init__(self, path: str | Path = ":memory:") -> None:
        self.path = str(path)
        self._lock = threading.RLock()
        self._db = sqlite3.connect(self.path, check_same_thread=False, isolation_level=None)
        self._db.row_factory = sqlite3.Row
        with self._lock:
            if self.path != ":memory:":
                self._db.execute("PRAGMA journal_mode=WAL")
            self._db.execute("PRAGMA foreign_keys=ON")
            self._db.executescript(SCHEMA)

    def close(self) -> None:
        with self._lock:
            self._db.close()

    def _exec(self, sql: str, params: Any = ()) -> sqlite3.Cursor:
        with self._lock:
            return self._db.execute(sql, params if isinstance(params, dict) else tuple(params))

    def _rows(self, sql: str, params: Iterable[Any] = ()) -> list[dict[str, Any]]:
        with self._lock:
            return [dict(row) for row in self._db.execute(sql, tuple(params))]

    # -- devices -----------------------------------------------------------
    def upsert_device(self, device_type: str, status: str, name: str | None = None, seen: float | None = None) -> None:
        self._exec(
            """INSERT INTO devices(device_type, device_name, status, last_seen_at) VALUES(?,?,?,?)
               ON CONFLICT(device_type) DO UPDATE SET status=excluded.status,
               device_name=COALESCE(excluded.device_name, device_name),
               last_seen_at=COALESCE(excluded.last_seen_at, last_seen_at)""",
            (device_type, name, status, seen),
        )

    def devices(self) -> list[dict[str, Any]]:
        return self._rows("SELECT * FROM devices ORDER BY device_type")

    # -- raw observations ----------------------------------------------------
    def add_reading(self, device_type: str, sensor: str, raw: float, unit: str, quality: str,
                    recorded_at: float, source: str = "live", metadata: dict[str, Any] | None = None) -> int:
        cur = self._exec(
            "INSERT INTO sensor_readings(device_type,sensor_type,raw_value,unit,quality_status,source,recorded_at,metadata_json)"
            " VALUES(?,?,?,?,?,?,?,?)",
            (device_type, sensor, raw, unit, quality, source, recorded_at, _dump(metadata)),
        )
        return int(cur.lastrowid)

    def readings(self, sensor: str | None = None, since: float | None = None, limit: int = 500) -> list[dict[str, Any]]:
        clauses, params = [], []
        if sensor:
            clauses.append("sensor_type=?"); params.append(sensor)
        if since is not None:
            clauses.append("recorded_at>=?"); params.append(since)
        where = ("WHERE " + " AND ".join(clauses)) if clauses else ""
        rows = self._rows(f"SELECT * FROM sensor_readings {where} ORDER BY recorded_at DESC, id DESC LIMIT ?", (*params, limit))
        for row in rows:
            row["metadata"] = _load(row.pop("metadata_json"))
        return rows[::-1]

    def add_rf_observation(self, pattern_state: str, signal_quality: str, confidence: str, periodicity: float | None,
                           features: dict[str, Any] | None, recorded_at: float, source: str = "live") -> int:
        cur = self._exec(
            "INSERT INTO rf_observations(pattern_state,signal_quality,confidence,periodicity_score,spectral_features_json,source,recorded_at)"
            " VALUES(?,?,?,?,?,?,?)",
            (pattern_state, signal_quality, confidence, periodicity, _dump(features), source, recorded_at),
        )
        return int(cur.lastrowid)

    def rf_observations(self, limit: int = 200) -> list[dict[str, Any]]:
        rows = self._rows("SELECT * FROM rf_observations ORDER BY recorded_at DESC, id DESC LIMIT ?", (limit,))
        for row in rows:
            row["features"] = _load(row.pop("spectral_features_json"))
        return rows[::-1]

    # -- incidents -------------------------------------------------------------
    def create_incident(self, summary: str, now: float, source: str = "live") -> dict[str, Any]:
        with self._lock:
            cur = self._exec(
                "INSERT INTO incidents(incident_code,status,summary,source,created_at,updated_at) VALUES('PENDING','open',?,?,?,?)",
                (summary, source, now, now),
            )
            incident_id = int(cur.lastrowid)
            code = f"INC-{time.strftime('%Y%m%d', time.localtime(now))}-{incident_id:04d}"
            self._exec("UPDATE incidents SET incident_code=? WHERE id=?", (code, incident_id))
        return self.incident(incident_id)  # type: ignore[return-value]

    def update_incident(self, incident_id: int, now: float, status: str | None = None, summary: str | None = None) -> None:
        self._exec(
            "UPDATE incidents SET status=COALESCE(?,status), summary=COALESCE(?,summary), updated_at=? WHERE id=?",
            (status, summary, now, incident_id),
        )

    def add_incident_observation(self, incident_id: int, kind: str, source_id: int | None,
                                 detail: dict[str, Any] | None, now: float) -> None:
        self._exec(
            "INSERT INTO incident_observations(incident_id,observation_type,source_id,detail_json,created_at) VALUES(?,?,?,?,?)",
            (incident_id, kind, source_id, _dump(detail), now),
        )
        self._exec("UPDATE incidents SET updated_at=? WHERE id=?", (now, incident_id))

    def incident(self, incident_id: int) -> dict[str, Any] | None:
        rows = self._rows("SELECT * FROM incidents WHERE id=?", (incident_id,))
        return rows[0] if rows else None

    def incidents(self, status: str | None = None, limit: int = 100) -> list[dict[str, Any]]:
        if status:
            return self._rows("SELECT * FROM incidents WHERE status=? ORDER BY id DESC LIMIT ?", (status, limit))
        return self._rows("SELECT * FROM incidents ORDER BY id DESC LIMIT ?", (limit,))

    def incident_detail(self, incident_id: int) -> dict[str, Any] | None:
        incident = self.incident(incident_id)
        if incident is None:
            return None
        observations = self._rows("SELECT * FROM incident_observations WHERE incident_id=? ORDER BY id", (incident_id,))
        for row in observations:
            row["detail"] = _load(row.pop("detail_json"))
        incident["observations"] = observations
        incident["events"] = self.events(incident_id=incident_id, limit=500)
        incident["acknowledgements"] = self._rows(
            "SELECT * FROM operator_acknowledgements WHERE incident_id=? ORDER BY id", (incident_id,))
        return incident

    def count_incidents(self) -> dict[str, int]:
        return {row["status"]: row["n"] for row in self._rows("SELECT status, COUNT(*) AS n FROM incidents GROUP BY status")}

    # -- events and acknowledgements ------------------------------------------
    def add_event(self, event_type: str, actor: str, payload: dict[str, Any] | None, now: float,
                  incident_id: int | None = None) -> int:
        cur = self._exec(
            "INSERT INTO events(incident_id,event_type,actor,payload_json,created_at) VALUES(?,?,?,?,?)",
            (incident_id, event_type, actor, _dump(payload), now),
        )
        return int(cur.lastrowid)

    def events(self, incident_id: int | None = None, limit: int = 100) -> list[dict[str, Any]]:
        if incident_id is not None:
            rows = self._rows("SELECT * FROM events WHERE incident_id=? ORDER BY id DESC LIMIT ?", (incident_id, limit))
        else:
            rows = self._rows("SELECT * FROM events ORDER BY id DESC LIMIT ?", (limit,))
        for row in rows:
            row["payload"] = _load(row.pop("payload_json"))
        return rows[::-1]

    def add_acknowledgement(self, incident_id: int, action: str, notes: str | None, channel: str, now: float) -> int:
        cur = self._exec(
            "INSERT INTO operator_acknowledgements(incident_id,operator_action,notes,channel,acknowledged_at) VALUES(?,?,?,?,?)",
            (incident_id, action, notes, channel, now),
        )
        return int(cur.lastrowid)

    # -- commands ---------------------------------------------------------------
    def save_command(self, cmd: dict[str, Any]) -> None:
        self._exec(
            """INSERT INTO commands(id,name,target,args_json,state,created_at,sent_at,received_at,executed_at,acknowledged_at,failure)
               VALUES(:id,:name,:target,:args,:state,:created_at,:sent_at,:received_at,:executed_at,:acknowledged_at,:failure)
               ON CONFLICT(id) DO UPDATE SET state=excluded.state, sent_at=excluded.sent_at, received_at=excluded.received_at,
               executed_at=excluded.executed_at, acknowledged_at=excluded.acknowledged_at, failure=excluded.failure""",
            {**cmd, "args": _dump(cmd.get("args"))},
        )

    def commands(self, limit: int = 50) -> list[dict[str, Any]]:
        rows = self._rows("SELECT * FROM commands ORDER BY created_at DESC LIMIT ?", (limit,))
        for row in rows:
            row["args"] = _load(row.pop("args_json"))
        return rows


def _prune(self: "Store", now: float, readings_days: float = 7.0, rf_days: float = 7.0) -> dict[str, int]:
    """Keep the SD card small: drop old raw-ish rows; incidents/events are kept."""

    with self._lock:
        a = self._exec("DELETE FROM sensor_readings WHERE recorded_at<?", (now - readings_days * 86400,)).rowcount
        b = self._exec("DELETE FROM rf_observations WHERE recorded_at<?", (now - rf_days * 86400,)).rowcount
    return {"sensor_readings": a, "rf_observations": b}


Store.prune = _prune  # type: ignore[attr-defined]
