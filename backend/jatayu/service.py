"""JatayuService: ties devices, assessors, storage, incidents and commands together.

Thread-safety: Arduino messages arrive on a reader thread, ticks and API calls
on the event loop. One RLock guards all mutable state.
"""

from __future__ import annotations

import threading
import time
from typing import Any, Callable

from . import protocol
from .commands import CommandTracker
from .fusion import OBSERVATION_LABELS, GasAssessor, GasConfig, RfAssessor, RfConfig
from .store import Store

LIVES_REPORTED, LIVES_UNDONE = "LIVES_SAVED_REPORTED", "LIVES_SAVED_UNDONE"
AUDIO_KINDS = frozenset({"scream", "distress", "help"})
AUDIO_STALE_S = 10.0  # the listener sends a heartbeat every few seconds
CODE_WINDOW_S = 3.0  # time allowed between the 0 and the digit of a keypad code

LCD_PAGES = ("overview", "sensor", "rf", "system", "incidents", "diagnostics")


class JatayuService:
    def __init__(self, store: Store, *, simulated: bool = False, group_window_s: float = 120.0,
                 rf_cfg: RfConfig | None = None, gas_cfg: GasConfig | None = None,
                 arduino_stale_s: float = 5.0) -> None:
        self.store = store
        self.simulated = simulated
        self.source = "simulated" if simulated else "live"
        self.group_window_s = group_window_s
        self.arduino_stale_s = arduino_stale_s
        self.rf = RfAssessor(rf_cfg)
        self.gas = GasAssessor(gas_cfg)
        self.lock = threading.RLock()
        self.arduino: Any | None = None
        self.publish: Callable[[dict[str, Any]], None] = lambda payload: None
        self.commands = CommandTracker(store, self._transmit, self._emit)
        self.monitoring = False
        self.lcd_page = "overview"
        self.last_key: dict[str, Any] | None = None
        self.has_lcd = True  # the UNO says otherwise in its hello
        self._audio_seen_at: float | None = None
        self._audio_level = 0.0
        self._audio_enabled = False  # the microphone stays closed until an operator turns it on
        self._audio_listening = False
        self._audio_heard: dict[str, Any] | None = None
        self._audio_last: dict[str, Any] | None = None
        self._code_until = 0.0
        self._lives: list[int] = []
        for event in store.events_of_types((LIVES_REPORTED, LIVES_UNDONE)):
            if event["event_type"] == LIVES_REPORTED:
                self._lives.append(int(event["payload"]["count"]))
            elif self._lives:
                self._lives.pop()
        self._lives_last: dict[str, Any] | None = None
        self.last_arduino_at: float | None = None
        self.arduino_online = False
        self.csi_online = False
        self.rf_state: dict[str, Any] = {"state": "NO_DATA"}
        self.demo_rf: dict[str, Any] | None = None  # set only during the key 7 simulation
        self.gas_state: dict[str, Any] = {}
        self.tick_ms = 0.0
        self._last_rf_state: str | None = None
        self._last_gas_status: str | None = None
        self._last_rf_store = 0.0
        self._last_lcd: tuple[str, str] | None = None
        self._last_prune = 0.0
        self._seen_seq: set[int] = set()

    # -- plumbing ----------------------------------------------------------
    def attach_arduino(self, device: Any) -> None:
        self.arduino = device

    def _transmit(self, message: dict[str, Any]) -> bool:
        device = self.arduino
        return bool(device and device.connected and device.send(message))

    def _emit(self, event_type: str, actor: str, payload: dict[str, Any] | None = None,
              incident_id: int | None = None) -> None:
        now = time.time()
        payload = {**(payload or {}), "source": self.source}
        event_id = self.store.add_event(event_type, actor, payload, now, incident_id)
        self.publish({"type": "event", "event": {"id": event_id, "event_type": event_type, "actor": actor,
                                                 "payload": payload, "incident_id": incident_id, "created_at": now}})

    # -- Arduino input ---------------------------------------------------------
    def handle_arduino_message(self, msg: dict[str, Any]) -> None:
        now = time.time()
        with self.lock:
            seq = msg.get("seq")
            if isinstance(seq, int):
                if seq in self._seen_seq:
                    return  # duplicate delivery
                self._seen_seq.add(seq)
                if len(self._seen_seq) > 2048:
                    self._seen_seq = set(sorted(self._seen_seq)[-512:])
            self.last_arduino_at = now
            if not self.arduino_online:
                self.arduino_online = True
                self.store.upsert_device("arduino", "online", msg.get("firmware"), now)
                self._emit("ARDUINO_CONNECTED", "arduino", {"firmware": msg.get("firmware")})
            kind = msg["type"]
            if kind == "sensor_reading":
                self._on_reading(msg, now)
            elif kind == "key_event":
                self._on_key(msg, now)
            elif kind == "cmd_ack":
                self.commands.on_device_ack(msg["command_id"], msg["status"], msg.get("detail"))
            elif kind == "hello" and msg.get("lcd") is False:
                self.has_lcd = False
            # otherwise hello / status only refresh liveness

    def _on_reading(self, msg: dict[str, Any], now: float) -> None:
        sim = bool(msg.get("simulated")) or self.simulated
        self.gas.add(int(msg["raw_adc"]), now, str(msg.get("model", "UNKNOWN")), str(msg.get("calibration")))
        assessed = self.gas.assess(now)
        self.store.add_reading("arduino", msg["sensor"], msg["raw_adc"], msg["unit"], assessed["data_quality"], now,
                               "simulated" if sim else "live",
                               {"model": msg["model"], "calibration": msg["calibration"], "device_ms": msg.get("timestamp_ms")})

    def _on_key(self, msg: dict[str, Any], now: float) -> None:
        key, action = msg["key"], msg["action"]
        code_digit = now <= self._code_until and key.isdigit()
        self._code_until = 0.0 if code_digit or key != "0" else now + CODE_WINDOW_S
        if code_digit:
            action = "REPORT_LIVES_SAVED"
        self.last_key = {"key": key, "action": action, "at": now}
        self._emit("KEY_PRESSED", "operator", {"key": key, "action": action})
        if code_digit:
            self._report_lives(int(key), now)
            self.publish({"type": "key", "key": self.last_key})
            return
        if action == "START_MONITORING":
            self.start_monitoring(actor="keypad")
        elif action == "STOP_MONITORING":
            self.stop_monitoring(actor="keypad")
        elif action == "REQUEST_INSPECTION":
            self.request_inspection(actor="keypad")
        elif action == "ACKNOWLEDGE":
            self.acknowledge_latest(channel="keypad")
        elif action == "ALERT_REQUEST":
            self._add_observation("alert_request", None, {"note": "software request only"}, now)
        elif action in {"SHOW_SENSOR_STATUS", "SHOW_RF_STATUS", "SHOW_SYSTEM_STATUS", "SHOW_INCIDENT_SUMMARY", "DIAGNOSTICS"}:
            self.lcd_page = {"SHOW_SENSOR_STATUS": "sensor", "SHOW_RF_STATUS": "rf", "SHOW_SYSTEM_STATUS": "system",
                             "SHOW_INCIDENT_SUMMARY": "incidents", "DIAGNOSTICS": "diagnostics"}[action]
        elif action == "CANCEL":
            self.lcd_page = "overview"
        self.publish({"type": "key", "key": self.last_key})

    def _report_lives(self, count: int, now: float) -> None:
        """Keypad code 0n: the operator reports n lives saved; 00 undoes the last report."""

        if count > 0:
            self._lives.append(count)
            event, text = LIVES_REPORTED, f"{count} {'life' if count == 1 else 'lives'} saved"
        elif self._lives:
            count = self._lives.pop()
            event, text = LIVES_UNDONE, f"Last report undone ({count} removed)"
        else:
            return
        payload = {"count": count, "total": sum(self._lives)}
        event_id = self.store.add_event(event, "operator", {**payload, "source": self.source}, now)
        self._lives_last = {"id": event_id, "count": count, "text": text, "at": now}
        self.publish({"type": "event", "event": {"id": event_id, "event_type": event, "actor": "operator",
                                                 "payload": payload, "incident_id": None, "created_at": now}})

    # -- microphone listener --------------------------------------------------------
    def audio_heartbeat(self, level: float, now: float | None = None, listening: bool = False,
                        heard: dict[str, Any] | None = None) -> dict[str, Any]:
        """Listener check-in. The reply tells it whether the microphone should be open."""

        with self.lock:
            self._audio_seen_at = time.time() if now is None else now
            self._audio_level = level
            self._audio_listening = listening
            self._audio_heard = heard
            return {"enabled": self._audio_enabled}

    def set_audio_enabled(self, enabled: bool, actor: str = "operator") -> dict[str, Any]:
        with self.lock:
            if enabled != self._audio_enabled:
                self._audio_enabled = enabled
                self._emit("MICROPHONE_ON" if enabled else "MICROPHONE_OFF", actor)
            return {"enabled": self._audio_enabled}

    def report_audio(self, kind: str, text: str, score: float, now: float | None = None) -> dict[str, Any]:
        """A sound the listener flagged. Opens or joins an incident while monitoring is on."""

        if kind not in AUDIO_KINDS:
            raise ValueError("unknown audio kind")
        if not 0.0 <= score <= 1.0:
            raise ValueError("score must be between 0 and 1")
        text = text.strip()[:100]
        with self.lock:
            now = time.time() if now is None else now
            self._audio_seen_at = now
            incident_id = self._add_observation("audio_alert", None, {"kind": kind, "text": text, "score": score}, now)
            payload = {"kind": kind, "text": text, "score": score, "source": self.source}
            event_id = self.store.add_event("AUDIO_ALERT", "microphone", payload, now, incident_id)
            self._audio_last = {"id": event_id, "kind": kind, "text": text, "score": score, "at": now}
            self.publish({"type": "event", "event": {"id": event_id, "event_type": "AUDIO_ALERT", "actor": "microphone",
                                                     "payload": payload, "incident_id": incident_id, "created_at": now}})
            return self._audio_last

    # -- operator actions --------------------------------------------------------
    def start_monitoring(self, actor: str = "dashboard") -> dict[str, Any]:
        with self.lock:
            if not self.monitoring:
                self.monitoring = True
                self._emit("MONITORING_STARTED", actor)
            return {"monitoring": True}

    def stop_monitoring(self, actor: str = "dashboard") -> dict[str, Any]:
        with self.lock:
            if self.monitoring:
                self.monitoring = False
                self._emit("MONITORING_STOPPED", actor)
            return {"monitoring": False}

    def request_inspection(self, actor: str = "dashboard", notes: str | None = None) -> dict[str, Any]:
        with self.lock:
            now = time.time()
            incident_id = self._add_observation("inspection_request", None, {"actor": actor, "notes": notes}, now, force=True)
            self._emit("INSPECTION_REQUEST_CREATED", actor, {"notes": notes}, incident_id)
            if not self.has_lcd:
                return {"incident_id": incident_id, "command": None}
            code = (self.store.incident(incident_id) or {}).get("incident_code", "")
            line1, line2 = "INSPECT REQUESTED", code[-9:]
            cmd = self.commands.issue("LCD_SHOW", {"line1": line1, "line2": line2}, incident_id=incident_id,
                                      message=protocol.display_message(line1, line2) | {"name": "LCD_SHOW", "args": {"line1": line1, "line2": line2}})
            return {"incident_id": incident_id, "command": cmd}

    def acknowledge_latest(self, channel: str = "dashboard") -> dict[str, Any] | None:
        with self.lock:
            open_incidents = [i for i in self.store.incidents(limit=50) if i["status"] in {"open", "acknowledged"}]
            if not open_incidents:
                self._emit("ACKNOWLEDGE_IGNORED", channel, {"reason": "no active incident"})
                return None
            return self.acknowledge(open_incidents[0]["id"], "ACKNOWLEDGE", None, channel)

    def acknowledge(self, incident_id: int, action: str = "ACKNOWLEDGE", notes: str | None = None,
                    channel: str = "dashboard") -> dict[str, Any] | None:
        with self.lock:
            incident = self.store.incident(incident_id)
            if incident is None or incident["status"] == "closed":
                return None
            now = time.time()
            self.store.add_acknowledgement(incident_id, action, notes, channel, now)
            self.store.update_incident(incident_id, now, status="acknowledged")
            self._emit("OPERATOR_ACKNOWLEDGED", "operator", {"channel": channel, "notes": notes}, incident_id)
            for cmd in self.commands.recent():
                if cmd["state"] == "executed" and self.commands._incident.get(cmd["id"]) == incident_id:
                    self.commands.acknowledge(cmd["id"])
            return self.store.incident_detail(incident_id)

    def close_incident(self, incident_id: int, notes: str | None = None) -> dict[str, Any] | None:
        with self.lock:
            incident = self.store.incident(incident_id)
            if incident is None or incident["status"] == "closed":
                return None
            if incident["status"] != "acknowledged":
                raise ValueError("an incident must be acknowledged by the operator before it is closed")
            self.store.update_incident(incident_id, time.time(), status="closed")
            self._emit("INCIDENT_CLOSED", "operator", {"notes": notes}, incident_id)
            return self.store.incident_detail(incident_id)

    def create_incident(self, summary: str, actor: str = "operator") -> dict[str, Any]:
        with self.lock:
            now = time.time()
            incident = self.store.create_incident(summary.strip(), now, self.source)
            self.store.add_incident_observation(incident["id"], "manual", None, {"summary": summary.strip()}, now)
            self._emit("INCIDENT_CREATED", actor, {"code": incident["incident_code"], "manual": True}, incident["id"])
            return self.store.incident_detail(incident["id"])  # type: ignore[return-value]

    def add_note(self, incident_id: int, text: str, actor: str = "operator") -> dict[str, Any] | None:
        with self.lock:
            incident = self.store.incident(incident_id)
            if incident is None or incident["status"] == "closed":
                return None
            now = time.time()
            self.store.add_incident_observation(incident_id, "operator_note", None, {"text": text}, now)
            self._emit("INCIDENT_NOTE_ADDED", actor, {"text": text}, incident_id)
            return self.store.incident_detail(incident_id)

    def update_node(self, node_id: str, fields: dict[str, Any]) -> dict[str, Any]:
        with self.lock:
            node = self.store.update_node(node_id, fields, time.time())
            self._emit("NODE_UPDATED", "operator", {"node_id": node_id, "fields": sorted(fields)})
            return node

    def display(self, line1: str, line2: str = "") -> dict[str, Any]:
        msg = protocol.display_message(line1, line2)
        return self.commands.issue("LCD_SHOW", msg and {"line1": msg["line1"], "line2": msg["line2"]},
                                   message=msg | {"name": "LCD_SHOW"})

    # -- incidents ---------------------------------------------------------------
    def _add_observation(self, kind: str, source_id: int | None, detail: dict[str, Any] | None, now: float,
                         force: bool = False) -> int | None:
        """Attach to a recent open incident or open a new one. Needs monitoring on
        unless the operator explicitly asked (force)."""

        if not self.monitoring and not force:
            return None
        target = None
        for inc in self.store.incidents(limit=10):
            if inc["status"] != "closed" and now - inc["updated_at"] <= self.group_window_s:
                target = inc
                break
        label = OBSERVATION_LABELS[kind]
        if target is None:
            target = self.store.create_incident(label, now, self.source)
            self._emit("INCIDENT_CREATED", "backend", {"code": target["incident_code"]}, target["id"])
        elif target["status"] == "acknowledged":
            self.store.update_incident(target["id"], now, status="open")  # new evidence reopens review
        self.store.add_incident_observation(target["id"], kind, source_id, detail, now)
        self._emit("OBSERVATION_ADDED", "backend", {"observation": kind, "label": label}, target["id"])
        return int(target["id"])

    # -- periodic tick -------------------------------------------------------------
    def tick(self, csi_telemetry: dict[str, Any], now: float | None = None) -> dict[str, Any]:
        t0 = time.perf_counter()
        now = time.time() if now is None else now
        with self.lock:
            rf = self.rf.assess(csi_telemetry, now)
            self.rf_state = rf
            online = rf["state"] != "NO_DATA"
            if online != self.csi_online:
                self.csi_online = online
                self.store.upsert_device("esp32", "online" if online else "offline", None, now if online else None)
                self._emit("ESP32_CONNECTED" if online else "ESP32_DISCONNECTED", "backend")
            serial = csi_telemetry.get("serial") or {}
            node_id = serial.get("node_id") or ("sim_rx_01" if self.simulated and online else None)
            if node_id and online:
                firmware = ((serial.get("device") or {}).get("firmware") or {}).get("fw")
                self.store.touch_node(node_id, now, firmware, (rf.get("features") or {}).get("channel"), self.source)
            if rf["state"] != self._last_rf_state or now - self._last_rf_store >= 10.0:
                if rf["state"] not in {"NO_DATA"}:
                    obs_id = self.store.add_rf_observation(rf["state"], rf["data_quality"], rf["confidence"],
                                                           rf["periodicity_score"], rf["features"], now, self.source)
                    self._last_rf_store = now
                else:
                    obs_id = None
                if rf["state"] != self._last_rf_state:
                    self._emit("RF_STATE_CHANGED", "backend", {"from": self._last_rf_state, "to": rf["state"]})
                    if rf["state"] == "PERIODIC_PATTERN_OBSERVED" and rf["data_quality"] in {"good", "fair"}:
                        self._add_observation("rf_pattern", obs_id, {"confidence": rf["confidence"], **rf["features"]}, now)
                    elif rf["state"] == "REVIEW_RECOMMENDED":
                        self._add_observation("rf_review", obs_id, {"confidence": rf["confidence"], **rf["features"]}, now)
                    self._last_rf_state = rf["state"]

            if self.arduino_online and self.last_arduino_at and now - self.last_arduino_at > self.arduino_stale_s:
                self.arduino_online = False
                self.store.upsert_device("arduino", "offline")
                self._emit("ARDUINO_DISCONNECTED", "backend")
            gas = self.gas.assess(now)
            self.gas_state = gas
            if gas["status"] != self._last_gas_status:
                if gas["status"] == "ELEVATED":
                    self._add_observation("env_elevated", None, {"raw_adc": gas["raw_adc"], "baseline": gas["baseline_adc"],
                                                                 "model": gas["model"], "calibration": gas["calibration"]}, now)
                    self._emit("ENVIRONMENTAL_READING_ELEVATED", "backend", {"raw_adc": gas["raw_adc"]})
                self._last_gas_status = gas["status"]
            self.commands.expire(now)
            self._refresh_lcd()
            if now - self._last_prune > 3600:
                self._last_prune = now
                self.store.prune(now)  # type: ignore[attr-defined]
        self.tick_ms = round((time.perf_counter() - t0) * 1000, 2)
        return self.snapshot()

    def _refresh_lcd(self) -> None:
        if not (self.arduino and self.arduino.connected and self.has_lcd):
            return
        counts = self.store.count_incidents()
        active = counts.get("open", 0) + counts.get("acknowledged", 0)
        rf, gas = self.rf_state, self.gas_state
        pages = {
            "overview": ("JATAYU " + ("ACTIVE" if self.monitoring else "READY"), "RF:" + rf["state"][:12]),
            "sensor": ("MQ " + str(gas.get("raw_adc", "--")) + " ADC", str(gas.get("status", "NO_DATA"))[:16]),
            "rf": ("RF " + rf["data_quality"].upper(), rf["state"][:16]),
            "system": ("CSI:" + ("ON" if self.csi_online else "OFF") + " MEGA:ON", "MON:" + ("ON" if self.monitoring else "OFF")),
            "incidents": ("INCIDENTS " + str(active), "open " + str(counts.get("open", 0))),
            "diagnostics": ("TICK " + str(self.tick_ms) + "ms", "CMDS " + str(len(self.commands.recent()))),
        }
        line1, line2 = pages[self.lcd_page]
        msg = protocol.display_message(line1, line2)
        pair = (msg["line1"], msg["line2"])
        if pair != self._last_lcd and self.arduino.send(msg):
            self._last_lcd = pair

    def snapshot(self) -> dict[str, Any]:
        with self.lock:
            return {
                "type": "jatayu",
                "source": "demo" if self.demo_rf else self.source,
                "monitoring": self.monitoring,
                "devices": {"esp32": "online" if self.csi_online else "offline",
                            "arduino": "online" if self.arduino_online else "offline"},
                "rf": self.demo_rf or self.rf_state,
                "environment": self.gas_state,
                "last_key": self.last_key,
                "lives": {"total": sum(self._lives), "last": self._lives_last},
                "audio": {"online": bool(self._audio_seen_at and time.time() - self._audio_seen_at <= AUDIO_STALE_S),
                          "enabled": self._audio_enabled, "listening": self._audio_listening,
                          "level": self._audio_level, "heard": self._audio_heard, "last": self._audio_last},
                "lcd_page": self.lcd_page,
                "incident_counts": self.store.count_incidents(),
                "performance": {"tick_ms": self.tick_ms},
                "server_time": time.time(),
            }
