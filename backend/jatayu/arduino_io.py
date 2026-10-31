"""Arduino Mega transport: a real serial reader and a clearly-labelled simulator.

Both expose the same small interface (start/stop/send/status) and deliver
validated protocol messages through ``on_message``.
"""

from __future__ import annotations

import queue
import random
import threading
import time
from collections import deque
from typing import Any, Callable

from . import protocol

try:
    import serial  # type: ignore
    from serial.tools import list_ports  # type: ignore
except ImportError:  # pragma: no cover
    serial = None
    list_ports = None

# Genuine Arduino / Arduino-clone USB IDs. CH340 (1A86) clones also look like
# ESP32 bridges, so they are only used when not already claimed.
ARDUINO_VIDS = {0x2341, 0x2A03}
CLONE_VIDS = {0x1A86, 0x0403}


def find_arduino_port(exclude: set[str] | None = None) -> str | None:
    if list_ports is None:
        return None
    exclude = exclude or set()
    genuine, clones = [], []
    for info in list_ports.comports():
        if info.device in exclude:
            continue
        if info.vid in ARDUINO_VIDS:
            genuine.append(info.device)
        elif info.vid in CLONE_VIDS:
            clones.append(info.device)
    for group in (genuine, clones):
        if group:
            return sorted(group)[0]
    return None


class ArduinoReader:
    def __init__(self, port: str = "auto", baud: int = 115200,
                 on_message: Callable[[dict[str, Any]], None] | None = None,
                 exclude_ports: Callable[[], set[str]] | None = None) -> None:
        self.requested_port, self.baud = port, baud
        self.on_message = on_message
        self.exclude_ports = exclude_ports
        self.state = "starting"
        self.active_port: str | None = None
        self.error: str | None = None
        self.messages_ok = 0
        self.messages_rejected = 0
        self.last_error_line: str | None = None
        self.last_message_at: float | None = None
        self._serial: Any | None = None
        self._lock = threading.Lock()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None

    def start(self) -> None:
        if self._thread is None:
            self._thread = threading.Thread(target=self._run, name="serial-arduino", daemon=True)
            self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        self._close()
        if self._thread is not None:
            self._thread.join(timeout=2.0)

    def send(self, message: dict[str, Any]) -> bool:
        with self._lock:
            if self._serial is None:
                return False
            try:
                self._serial.write(protocol.encode(message))
                self._serial.flush()
                return True
            except Exception as exc:
                self.error = f"write failed: {exc}"
                return False

    @property
    def connected(self) -> bool:
        return self._serial is not None

    def status(self) -> dict[str, Any]:
        return {"kind": "serial", "state": self.state, "port": self.active_port, "requested_port": self.requested_port,
                "baud": self.baud, "error": self.error, "messages_ok": self.messages_ok,
                "messages_rejected": self.messages_rejected, "last_rejected": self.last_error_line,
                "last_message_age_s": round(time.time() - self.last_message_at, 1) if self.last_message_at else None}

    def _close(self) -> None:
        with self._lock:
            device, self._serial = self._serial, None
        if device is not None:
            try:
                device.close()
            except Exception:
                pass

    def _open(self) -> bool:
        if serial is None:
            self.state, self.error = "error", "pyserial is missing"
            return False
        port = self.requested_port
        if not port or port.lower() == "auto":
            port = find_arduino_port(self.exclude_ports() if self.exclude_ports else None)
            if port is None:
                self.state, self.error = "searching", "No Arduino serial port found"
                return False
        try:
            device = serial.Serial(port, self.baud, timeout=0.2, write_timeout=0.5)
        except Exception as exc:
            self.state, self.error = "error", f"Could not open {port}: {exc}"
            return False
        with self._lock:
            self._serial = device
        self.active_port, self.state, self.error = port, "open", None
        return True

    def _run(self) -> None:
        while not self._stop.is_set():
            if self._serial is None and not self._open():
                self._stop.wait(1.5)
                continue
            try:
                self._read_loop()
            except Exception as exc:
                if self._stop.is_set():
                    break
                self.state, self.error = "reconnecting", f"Serial link lost: {exc}"
                self._close()
                self._stop.wait(1.0)

    def _read_loop(self) -> None:
        buffer = bytearray()
        while not self._stop.is_set():
            device = self._serial
            if device is None:
                return
            chunk = device.read(max(1, min(device.in_waiting, 4096)))
            if not chunk:
                continue
            buffer.extend(chunk)
            if len(buffer) > 8192 and b"\n" not in buffer:  # wrong baud / garbage
                buffer.clear()
                self.messages_rejected += 1
                self.last_error_line = "unterminated data (wrong baud rate?)"
                continue
            *lines, rest = buffer.split(b"\n")
            buffer = bytearray(rest)
            for raw in lines:
                self.handle_line(raw)

    def handle_line(self, raw: bytes | bytearray | str) -> None:
        """Validate one line; split out so it is unit-testable without a port."""

        if not raw.strip():
            return
        try:
            message = protocol.parse_line(raw)
        except protocol.ProtocolError as exc:
            self.messages_rejected += 1
            text = raw.decode("utf-8", "replace") if isinstance(raw, (bytes, bytearray)) else raw
            self.last_error_line = f"{exc}: {text[:80]}"
            return
        self.messages_ok += 1
        self.last_message_at = time.time()
        if self.on_message:
            self.on_message(message)


class SimulatedArduino:
    """Stands in for the Mega when no hardware is attached. Everything it emits
    is tagged ``"simulated": true`` so it can never pass as live data."""

    def __init__(self, on_message: Callable[[dict[str, Any]], None], interval_s: float = 1.0, seed: int = 11) -> None:
        self.on_message = on_message
        self.interval_s = interval_s
        self.baseline = 310
        self.offset = 0
        self.fail_commands = False
        self.silent = False
        self._rng = random.Random(seed)
        self._inbox: queue.Queue[dict[str, Any]] = queue.Queue()
        self._stop = threading.Event()
        self._thread: threading.Thread | None = None
        self.state = "starting"
        self.lcd = ["", ""]
        self.sent = 0

    # -- interface ---------------------------------------------------------
    def start(self) -> None:
        if self._thread is None:
            self.state = "simulated"
            self._thread = threading.Thread(target=self._run, name="sim-arduino", daemon=True)
            self._thread.start()

    def stop(self) -> None:
        self._stop.set()
        if self._thread is not None:
            self._thread.join(timeout=2.0)

    def send(self, message: dict[str, Any]) -> bool:
        if self.silent:
            return False
        self._inbox.put(message)
        return True

    @property
    def connected(self) -> bool:
        return not self.silent

    def status(self) -> dict[str, Any]:
        return {"kind": "simulation", "state": self.state, "port": None, "error": None, "simulated": True,
                "lcd": list(self.lcd), "gas_offset": self.offset}

    # -- scripted inputs --------------------------------------------------------
    def press(self, key: str) -> None:
        self._emit({"type": "key_event", "key": key})

    def set_gas_offset(self, counts: int) -> None:
        self.offset = int(counts)

    # -- internals -------------------------------------------------------------
    def _emit(self, msg: dict[str, Any]) -> None:
        if self.silent:
            return
        try:
            self.on_message(protocol.parse_line(__import__("json").dumps({**msg, "simulated": True})))
        except protocol.ProtocolError:
            pass

    def _run(self) -> None:
        self._emit({"type": "hello", "firmware": "sim-mega", "model": "MQ-SIM"})
        next_reading = 0.0
        while not self._stop.is_set():
            try:
                msg = self._inbox.get(timeout=0.05)
            except queue.Empty:
                msg = None
            if msg is not None:
                self._handle(msg)
            now = time.monotonic()
            if now >= next_reading:
                next_reading = now + self.interval_s
                raw = int(max(0, min(1023, self.baseline + self.offset + self._rng.gauss(0, 4))))
                self._emit({"type": "sensor_reading", "sensor": "mq_raw", "model": "MQ-SIM", "raw_adc": raw,
                            "calibration": "NOT_CALIBRATED", "timestamp_ms": int(now * 1000)})

    def _handle(self, msg: dict[str, Any]) -> None:
        cid = msg.get("command_id")
        if msg.get("type") == "display":
            self.lcd = [msg.get("line1", ""), msg.get("line2", "")]
        if not cid:
            return
        self._emit({"type": "cmd_ack", "command_id": cid, "status": "received"})
        if self.fail_commands:
            self._emit({"type": "cmd_ack", "command_id": cid, "status": "failed", "detail": "simulated failure"})
            return
        if msg.get("name") == "LCD_SHOW":
            args = msg.get("args") or {}
            self.lcd = [args.get("line1", ""), args.get("line2", "")]
        self._emit({"type": "cmd_ack", "command_id": cid, "status": "executed"})
