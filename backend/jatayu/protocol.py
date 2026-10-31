"""Newline-delimited JSON protocol between the Raspberry Pi and the Arduino Mega.

Arduino -> Pi:  hello, sensor_reading, key_event, cmd_ack, status
Pi -> Arduino:  display, command

Every message is one JSON object on one line. Anything that is not a valid
object (boot noise, debug prints, truncated lines) is rejected with
ProtocolError and counted, never raised into the reader thread.
"""

from __future__ import annotations

import json
from typing import Any

PROTOCOL_VERSION = 1
LCD_COLUMNS = 16
MAX_LINE_BYTES = 512

# Key -> (action, label). Mirrors the project documentation, section 7.2.
KEY_ACTIONS: dict[str, tuple[str, str]] = {
    "1": ("START_MONITORING", "Start monitoring"),
    "2": ("STOP_MONITORING", "Stop monitoring"),
    "3": ("SHOW_SENSOR_STATUS", "Show sensor status"),
    "4": ("REQUEST_INSPECTION", "Request inspection"),
    "5": ("SHOW_RF_STATUS", "Show RF status"),
    "6": ("SHOW_SYSTEM_STATUS", "Show system status"),
    "7": ("SHOW_INCIDENT_SUMMARY", "Incident summary"),
    "8": ("ACKNOWLEDGE", "Acknowledge current observation"),
    "9": ("DIAGNOSTICS", "Diagnostics"),
    "0": ("CANCEL", "Cancel"),
    "*": ("ALERT_REQUEST", "Alert request (software only, not a safety e-stop)"),
    "#": ("CONFIRM", "Confirm"),
}
VALID_KEYS = frozenset(KEY_ACTIONS) | frozenset("ABCD")

# Commands the Pi may send to the Arduino. Browsers can never pick anything else.
DEVICE_COMMANDS = frozenset({"LCD_SHOW", "BUZZER", "REBOOT_PERIPHERALS", "PING"})


class ProtocolError(ValueError):
    """The line was not a valid protocol message."""


def _require(msg: dict[str, Any], name: str, kinds: tuple[type, ...]) -> Any:
    value = msg.get(name)
    if isinstance(value, bool) and bool not in kinds:
        raise ProtocolError(f"field '{name}' has the wrong type")
    if not isinstance(value, kinds):
        raise ProtocolError(f"missing or invalid field '{name}'")
    return value


def parse_line(line: bytes | bytearray | str) -> dict[str, Any]:
    """Decode and validate one Arduino line. Returns a normalised dict."""

    if isinstance(line, (bytes, bytearray)):
        if len(line) > MAX_LINE_BYTES:
            raise ProtocolError("line too long")
        try:
            line = line.decode("utf-8")
        except UnicodeDecodeError as exc:
            raise ProtocolError("not valid UTF-8") from exc
    text = line.strip()
    if not text:
        raise ProtocolError("empty line")
    if not text.startswith("{"):
        raise ProtocolError("not a JSON object")
    try:
        msg = json.loads(text)
    except json.JSONDecodeError as exc:
        raise ProtocolError(f"malformed JSON: {exc.msg}") from exc
    if not isinstance(msg, dict):
        raise ProtocolError("not a JSON object")

    kind = _require(msg, "type", (str,))
    version = msg.setdefault("v", PROTOCOL_VERSION)
    if version != PROTOCOL_VERSION or isinstance(version, bool):
        raise ProtocolError(f"unsupported protocol version {version!r}")
    msg.setdefault("device_id", "mega_01")
    if "seq" in msg:
        _require(msg, "seq", (int,))

    if kind == "sensor_reading":
        _require(msg, "sensor", (str,))
        raw = _require(msg, "raw_adc", (int,))
        if not 0 <= raw <= 1023:
            raise ProtocolError("raw_adc outside the 10-bit ADC range")
        msg.setdefault("model", "UNKNOWN")
        msg.setdefault("calibration", "NOT_CALIBRATED")
        msg.setdefault("unit", "adc_counts")
        msg.setdefault("sensor_status", "unknown")
    elif kind == "key_event":
        key = _require(msg, "key", (str,))
        if key not in VALID_KEYS:
            raise ProtocolError(f"unknown key '{key}'")
        action = KEY_ACTIONS.get(key, ("UNMAPPED", ""))[0]
        # The Pi owns the key map; a firmware-supplied action is only a hint.
        msg["action"] = action
    elif kind == "cmd_ack":
        _require(msg, "command_id", (str,))
        status = _require(msg, "status", (str,))
        if status not in {"received", "executed", "failed"}:
            raise ProtocolError("cmd_ack status must be received, executed or failed")
    elif kind in {"hello", "status"}:
        pass
    else:
        raise ProtocolError(f"unsupported message type '{kind}'")
    return msg


def encode(msg: dict[str, Any]) -> bytes:
    return (json.dumps(msg, separators=(",", ":")) + "\n").encode("utf-8")


def display_message(line1: str, line2: str = "") -> dict[str, Any]:
    """LCD text, clipped to the 16x2 panel and limited to printable ASCII."""

    def clean(text: str) -> str:
        return "".join(ch if 32 <= ord(ch) < 127 else "?" for ch in str(text))[:LCD_COLUMNS]

    return {"type": "display", "line1": clean(line1), "line2": clean(line2)}


def command_message(command_id: str, name: str, args: dict[str, Any] | None = None) -> dict[str, Any]:
    if name not in DEVICE_COMMANDS:
        raise ProtocolError(f"command '{name}' is not allowed")
    msg: dict[str, Any] = {"type": "command", "command_id": command_id, "name": name}
    if args:
        msg["args"] = args
    return msg
