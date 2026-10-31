"""Command lifecycle: created -> sent -> received -> executed -> acknowledged.

A command being written to a serial port is not proof the device got it, and a
device receiving it is not proof a human did anything about it. Each stage is
timestamped separately, persisted, and emitted as an event.
"""

from __future__ import annotations

import itertools
import threading
import time
from typing import Any, Callable

from .store import Store

STATES = ("created", "sent", "received", "executed", "acknowledged")
TERMINAL = {"acknowledged", "failed", "timed_out"}


class CommandTracker:
    def __init__(
        self,
        store: Store,
        transmit: Callable[[dict[str, Any]], bool],
        emit: Callable[[str, str, dict[str, Any], int | None], None],
        timeout_s: float = 5.0,
    ) -> None:
        self.store = store
        self.transmit = transmit
        self.emit = emit
        self.timeout_s = timeout_s
        self._lock = threading.RLock()
        self._counter = itertools.count(1)
        self._prefix = time.strftime("%H%M%S")
        self._commands: dict[str, dict[str, Any]] = {}
        self._incident: dict[str, int | None] = {}

    def _new_id(self) -> str:
        return f"cmd-{self._prefix}-{next(self._counter):04d}"

    def issue(self, name: str, args: dict[str, Any] | None = None, target: str = "arduino",
              incident_id: int | None = None, message: dict[str, Any] | None = None) -> dict[str, Any]:
        """Create, persist and attempt to send a command. Never raises on I/O failure."""

        from .protocol import command_message

        now = time.time()
        with self._lock:
            command_id = self._new_id()
            cmd = {"id": command_id, "name": name, "target": target, "args": args, "state": "created",
                   "created_at": now, "sent_at": None, "received_at": None, "executed_at": None,
                   "acknowledged_at": None, "failure": None}
            self._commands[command_id] = cmd
            self._incident[command_id] = incident_id
            self.store.save_command(cmd)
            self.emit("COMMAND_CREATED", "backend", {"command_id": command_id, "name": name}, incident_id)
            wire = message if message is not None else command_message(command_id, name, args)
            wire = {**wire, "command_id": command_id}
            if self.transmit(wire):
                cmd["state"], cmd["sent_at"] = "sent", time.time()
                self.emit("COMMAND_SENT", "backend", {"command_id": command_id}, incident_id)
            else:
                cmd["state"], cmd["failure"] = "failed", "device link unavailable"
                self.emit("COMMAND_FAILED", "backend", {"command_id": command_id, "reason": cmd["failure"]}, incident_id)
            self.store.save_command(cmd)
            return dict(cmd)

    def on_device_ack(self, command_id: str, status: str, detail: str | None = None) -> bool:
        with self._lock:
            cmd = self._commands.get(command_id)
            if cmd is None or cmd["state"] in TERMINAL:
                return False
            now = time.time()
            incident_id = self._incident.get(command_id)
            if status == "failed":
                cmd["state"], cmd["failure"] = "failed", detail or "device reported failure"
                self.emit("COMMAND_FAILED", "arduino", {"command_id": command_id, "reason": cmd["failure"]}, incident_id)
            elif status == "received" and cmd["state"] in {"created", "sent"}:
                cmd["state"], cmd["received_at"] = "received", now
                self.emit("COMMAND_RECEIVED", "arduino", {"command_id": command_id}, incident_id)
            elif status == "executed" and cmd["state"] in {"created", "sent", "received"}:
                cmd["received_at"] = cmd["received_at"] or now
                cmd["state"], cmd["executed_at"] = "executed", now
                self.emit("COMMAND_EXECUTED", "arduino", {"command_id": command_id}, incident_id)
            else:
                return False
            self.store.save_command(cmd)
            return True

    def acknowledge(self, command_id: str) -> dict[str, Any] | None:
        with self._lock:
            cmd = self._commands.get(command_id)
            if cmd is None or cmd["state"] != "executed":
                return None
            cmd["state"], cmd["acknowledged_at"] = "acknowledged", time.time()
            self.store.save_command(cmd)
            self.emit("COMMAND_ACKNOWLEDGED", "operator", {"command_id": command_id}, self._incident.get(command_id))
            return dict(cmd)

    def expire(self, now: float | None = None) -> None:
        """Commands the device never confirmed become timed_out, visibly."""

        now = time.time() if now is None else now
        with self._lock:
            for command_id, cmd in self._commands.items():
                if cmd["state"] == "sent" and now - (cmd["sent_at"] or now) > self.timeout_s:
                    cmd["state"], cmd["failure"] = "timed_out", "no acknowledgement from device"
                    self.store.save_command(cmd)
                    self.emit("COMMAND_TIMED_OUT", "backend", {"command_id": command_id}, self._incident.get(command_id))

    def recent(self, limit: int = 30) -> list[dict[str, Any]]:
        with self._lock:
            return sorted((dict(c) for c in self._commands.values()), key=lambda c: c["created_at"], reverse=True)[:limit]
