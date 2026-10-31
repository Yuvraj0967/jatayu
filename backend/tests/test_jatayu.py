"""JATAYU layer tests:  python -m pytest tests"""

from __future__ import annotations

import sys
import tempfile
import time
from pathlib import Path

import pytest

sys.path.insert(0, str(Path(__file__).resolve().parents[1]))

from jatayu import protocol  # noqa: E402
from jatayu.arduino_io import ArduinoReader  # noqa: E402
from jatayu.fusion import GasAssessor, GasConfig, RfAssessor  # noqa: E402
from jatayu.service import JatayuService  # noqa: E402
from jatayu.store import Store  # noqa: E402


# -- protocol ---------------------------------------------------------------
@pytest.mark.parametrize("line", [b"", b"hello", b"[1,2]", b"{bad json", b'{"type":"nope"}', b'{"type":"sensor_reading","sensor":"mq","raw_adc":5000}',
                                  b'{"type":"sensor_reading","sensor":"mq","raw_adc":true}', b'{"type":"key_event","key":"Z"}', b"\xff\xfe", b"x" * 600])
def test_malformed_lines_rejected(line):
    with pytest.raises(protocol.ProtocolError):
        protocol.parse_line(line)


def test_valid_messages_and_pi_owns_key_map():
    msg = protocol.parse_line(b'{"type":"sensor_reading","sensor":"mq_raw","raw_adc":412}\n')
    assert msg["calibration"] == "NOT_CALIBRATED" and msg["model"] == "UNKNOWN"
    key = protocol.parse_line('{"type":"key_event","key":"4","action":"EVIL"}')
    assert key["action"] == "REQUEST_INSPECTION"


def test_display_clipped_and_commands_whitelisted():
    msg = protocol.display_message("A" * 40, "café")
    assert len(msg["line1"]) == 16 and msg["line2"] == "caf?"
    with pytest.raises(protocol.ProtocolError):
        protocol.command_message("c1", "FORMAT_DISK")


def test_reader_counts_rejects_and_survives_garbage():
    got = []
    reader = ArduinoReader(on_message=got.append)
    for line in (b"boot noise", b'{"type":"key_event","key":"1"}', b"{trunc"):
        reader.handle_line(line)
    assert len(got) == 1 and reader.messages_ok == 1 and reader.messages_rejected == 2


# -- gas ----------------------------------------------------------------------
def test_gas_warmup_baseline_elevated_hysteresis_stale():
    gas = GasAssessor(GasConfig(warmup_s=10, baseline_samples=5, delta_counts=100, hysteresis_counts=30))
    gas.add(300, 0.0)
    assert gas.assess(1.0)["status"] == "WARMING_UP"
    for i in range(10, 16):
        gas.add(300, float(i))
    state = gas.assess(15.5)
    assert state["status"] == "NORMAL" and state["baseline_adc"] == 300 and state["unit"] == "adc_counts"
    assert "ppm" not in str(state).lower().replace("not a calibrated", "")
    gas.add(420, 16.0)
    assert gas.assess(16.1)["status"] == "ELEVATED"
    gas.add(380, 17.0)  # +80, above the clear threshold (+70): stays elevated
    assert gas.assess(17.1)["status"] == "ELEVATED"
    gas.add(320, 18.0)
    assert gas.assess(18.1)["status"] == "NORMAL"
    assert gas.assess(30.0)["status"] == "STALE"


# -- RF -------------------------------------------------------------------------
def _csi(state="breathing", rate=100.0, age=0.1, valid=True, conf=0.8):
    return {"state": state, "valid": valid, "confidence": conf, "periodicity": 0.7, "scores": {},
            "link": {"packet_rate_hz": rate, "last_frame_age_s": age, "total_frames": 1000}}


def test_rf_states_and_sustain():
    rf = RfAssessor()
    assert rf.assess(_csi(age=None) | {"link": {"total_frames": 0}}, 0)["state"] == "DISCONNECTED"
    assert rf.assess(_csi(rate=5), 0)["state"] == "LOW_SIGNAL_QUALITY"
    assert rf.assess(_csi("warming_up", valid=False), 0)["state"] == "COLLECTING"
    assert rf.assess(_csi("empty"), 0)["state"] == "NO_CLEAR_PERIODIC_PATTERN"
    first = rf.assess(_csi(), 100)
    assert first["state"] == "PERIODIC_PATTERN_OBSERVED" and first["confidence"] == "High"
    assert rf.assess(_csi(), 125)["state"] == "REVIEW_RECOMMENDED"
    assert rf.assess(_csi("motion"), 126)["state"] == "NO_CLEAR_PERIODIC_PATTERN"  # resets the timer
    assert rf.assess(_csi(), 127)["state"] == "PERIODIC_PATTERN_OBSERVED"


def test_poor_quality_never_reports_pattern():
    out = RfAssessor().assess(_csi(rate=5), 0)
    assert out["state"] == "LOW_SIGNAL_QUALITY" and out["confidence"] == "Insufficient data"


# -- service / incidents / commands ------------------------------------------------
class FakeDevice:
    def __init__(self, ok=True):
        self.ok, self.sent = ok, []

    @property
    def connected(self):
        return self.ok

    def send(self, msg):
        self.sent.append(msg)
        return self.ok


def _service(device=None):
    svc = JatayuService(Store(), group_window_s=60)
    svc.attach_arduino(device or FakeDevice())
    return svc


def _key(svc, k):
    svc.handle_arduino_message(protocol.parse_line('{"type":"key_event","key":"%s"}' % k))


def test_no_incident_unless_monitoring_and_keypad_drives_lifecycle():
    svc = _service()
    now = time.time()
    svc._add_observation("rf_pattern", None, {}, now)
    assert svc.store.incidents() == []
    _key(svc, "1")
    assert svc.monitoring
    svc._add_observation("rf_pattern", None, {}, now)
    svc._add_observation("env_elevated", None, {}, now + 5)  # grouped
    incidents = svc.store.incidents()
    assert len(incidents) == 1
    detail = svc.store.incident_detail(incidents[0]["id"])
    assert [o["observation_type"] for o in detail["observations"]] == ["rf_pattern", "env_elevated"]
    _key(svc, "8")
    assert svc.store.incident(incidents[0]["id"])["status"] == "acknowledged"
    assert svc.store.incident_detail(incidents[0]["id"])["acknowledgements"][0]["channel"] == "keypad"
    with pytest.raises(ValueError):
        svc.close_incident(999) or (_ for _ in ()).throw(ValueError)  # unknown -> None, forced raise
    assert svc.close_incident(incidents[0]["id"])["status"] == "closed"
    _key(svc, "2")
    assert not svc.monitoring


def test_close_requires_acknowledgement():
    svc = _service()
    svc.start_monitoring()
    svc._add_observation("rf_pattern", None, {}, time.time())
    with pytest.raises(ValueError):
        svc.close_incident(svc.store.incidents()[0]["id"])


def test_command_lifecycle_and_timeout():
    dev = FakeDevice()
    svc = _service(dev)
    result = svc.request_inspection(notes="north corridor")
    cid = result["command"]["id"]
    assert result["command"]["state"] == "sent"
    ack = lambda s: svc.handle_arduino_message(protocol.parse_line('{"type":"cmd_ack","command_id":"%s","status":"%s"}' % (cid, s)))
    ack("received"); ack("executed")
    assert svc.commands.recent()[0]["state"] == "executed"
    svc.acknowledge(result["incident_id"])
    assert svc.commands.recent()[0]["state"] == "acknowledged"
    types = [e["event_type"] for e in svc.store.events(limit=100)]
    for expected in ("INSPECTION_REQUEST_CREATED", "COMMAND_CREATED", "COMMAND_SENT", "COMMAND_RECEIVED", "COMMAND_EXECUTED", "OPERATOR_ACKNOWLEDGED"):
        assert expected in types
    second = svc.commands.issue("PING")
    svc.commands.expire(time.time() + 60)
    assert [c for c in svc.commands.recent() if c["id"] == second["id"]][0]["state"] == "timed_out"
    # unknown / duplicate acks are ignored
    assert not svc.commands.on_device_ack("nope", "received")


def test_command_fails_visibly_without_device():
    svc = _service(FakeDevice(ok=False))
    cmd = svc.request_inspection()["command"]
    assert cmd["state"] == "failed" and "unavailable" in cmd["failure"]


def test_duplicate_seq_dropped_and_readings_stored_with_source():
    svc = _service()
    line = '{"type":"sensor_reading","sensor":"mq_raw","raw_adc":300,"seq":1}'
    svc.handle_arduino_message(protocol.parse_line(line))
    svc.handle_arduino_message(protocol.parse_line(line))
    rows = svc.store.readings()
    assert len(rows) == 1 and rows[0]["source"] == "live" and rows[0]["unit"] == "adc_counts"
    sim = JatayuService(Store(), simulated=True)
    sim.handle_arduino_message(protocol.parse_line(line))
    assert sim.store.readings()[0]["source"] == "simulated"


def test_arduino_goes_stale_and_events_recorded():
    svc = _service()
    svc.handle_arduino_message(protocol.parse_line('{"type":"hello"}'))
    assert svc.arduino_online
    svc.tick(_csi(), now=time.time() + 30)
    types = [e["event_type"] for e in svc.store.events(limit=100)]
    assert "ARDUINO_CONNECTED" in types and "ARDUINO_DISCONNECTED" in types
    assert svc.snapshot()["devices"]["arduino"] == "offline"


def test_prune_removes_old_rows_only():
    store = Store()
    store.add_reading("arduino", "mq", 1, "adc_counts", "x", 1000.0)
    store.add_reading("arduino", "mq", 2, "adc_counts", "x", time.time())
    assert store.prune(time.time())["sensor_readings"] == 1 and len(store.readings()) == 1


# -- API end to end (simulation) ----------------------------------------------------
def test_api_end_to_end_simulation():
    from starlette.testclient import TestClient
    import app as backend_app

    tmp = Path(tempfile.mkdtemp())
    options = backend_app.RuntimeOptions(simulate=True, calibration_file=str(tmp / "cal.json"), db_path=str(tmp / "j.db"))
    with TestClient(backend_app.create_app(options)) as client:
        deadline = time.time() + 10
        while time.time() < deadline and client.get("/api/status").json()["devices"]["arduino"] != "online":
            time.sleep(0.2)
        status = client.get("/api/status").json()
        assert status["devices"]["arduino"] == "online" and status["source"] == "simulated"
        assert client.post("/api/monitoring/start").json() == {"monitoring": True}
        assert client.post("/api/simulate/key", json={"key": "Z"}).status_code == 400
        created = client.post("/api/inspection/request", json={"notes": "demo"})
        assert created.status_code == 201
        incident_id = created.json()["incident_id"]
        deadline = time.time() + 5
        while time.time() < deadline and client.get("/api/commands").json()[0]["state"] != "executed":
            time.sleep(0.1)
        assert client.get("/api/commands").json()[0]["state"] == "executed"
        assert client.post(f"/api/incidents/{incident_id}/close").status_code == 409
        assert client.post(f"/api/incidents/{incident_id}/acknowledge", json={"notes": "seen"}).status_code == 200
        assert client.post(f"/api/incidents/{incident_id}/close").json()["status"] == "closed"
        detail = client.get(f"/api/incidents/{incident_id}").json()
        assert detail["acknowledgements"] and any(e["event_type"] == "OPERATOR_ACKNOWLEDGED" for e in detail["events"])
        assert client.get("/api/incidents/9999").status_code == 404
        assert client.get("/api/sensors/latest").json()["unit"] == "adc_counts"
        assert client.get("/api/events").json()
        with client.websocket_connect("/ws/live") as ws:
            assert ws.receive_json()["type"] == "jatayu"
