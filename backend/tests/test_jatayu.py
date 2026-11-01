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
    assert rf.assess(_csi(age=None) | {"link": {"total_frames": 0}}, 0)["state"] == "NO_DATA"
    assert rf.assess(_csi(rate=3), 0)["state"] == "LOW_QUALITY"
    assert rf.assess(_csi("warming_up", valid=False), 0)["state"] == "COLLECTING"
    assert rf.assess(_csi("empty"), 0)["state"] == "NO_CLEAR_PERIODIC_PATTERN"
    first = rf.assess(_csi(), 100)
    assert first["state"] == "PERIODIC_PATTERN_OBSERVED" and first["confidence"] == "High"
    assert rf.assess(_csi(), 125)["state"] == "REVIEW_RECOMMENDED"
    assert rf.assess(_csi("motion"), 126)["state"] == "NO_CLEAR_PERIODIC_PATTERN"  # resets the timer
    assert rf.assess(_csi(), 127)["state"] == "PERIODIC_PATTERN_OBSERVED"


def test_poor_quality_never_reports_pattern():
    out = RfAssessor().assess(_csi(rate=3), 0)
    assert out["state"] == "LOW_QUALITY" and out["confidence"] == "Insufficient data"


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


# -- protocol v1 CSI line, sequence accounting ----------------------------------------
def _csi1(seq, width=64, flags=1):
    return f"CSI1,{seq},{seq * 10000},-54,-96,6,{flags}," + ",".join(["20.0"] * width)


def test_csi1_parse_and_sequence_gaps_duplicates_reboot():
    from serial_io import CSIStreamParser

    parser = CSIStreamParser()
    for seq in (1, 2, 3, 6, 6, 7):
        frame = parser.parse_line(_csi1(seq), 0.0)
    assert (frame.seq, frame.channel, frame.noise_floor, frame.first_word_invalid) == (7, 6, -96.0, True)
    assert len(frame.amplitudes) == 64
    status = parser.seq.status()
    assert status["lost"] == 2 and status["gaps"] == 1 and status["duplicates"] == 1 and status["loss_ratio"] == 0.25
    for seq in (2000, 1, 2):  # board rebooted: counter restarts, not loss
        parser.parse_line(_csi1(seq), 0.0)
    assert parser.seq.reboots == 1
    assert parser.parse_line("CSI1,1,2,3", 0.0) is None and parser.dropped == 1
    assert parser.parse_line(_csi1(9).replace("20.0", "nan", 1), 0.0) is None  # non-finite amplitude rejected


def test_banner_exposes_node_and_resets_sequence():
    from serial_io import CSIStreamParser

    parser = CSIStreamParser()
    parser.parse_line(_csi1(5), 0.0)
    parser.parse_line("#JATAYU,proto=1,node=jatayu_rx_01,fw=3.1,reset=poweron", 0.0)
    assert parser.device["firmware"]["node"] == "jatayu_rx_01" and parser.seq.last is None


def test_legacy_csi_lines_still_parse():
    from serial_io import CSIStreamParser

    frame = CSIStreamParser().parse_line("CSI,123456,-50," + ",".join(["10.0"] * 64), 0.0)
    assert frame is not None and frame.seq is None


def test_packet_loss_degrades_rf_quality():
    rf = RfAssessor()
    base = _csi()
    lossy = base | {"serial": {"sequence": {"received": 70, "loss_ratio": 0.45}}}
    out = rf.assess(lossy, 0)
    assert out["state"] == "LOW_QUALITY" and out["features"]["packet_loss_ratio"] == 0.45
    fair = base | {"serial": {"sequence": {"received": 90, "loss_ratio": 0.15}}}
    assert rf.quality(fair) == "fair"
    assert rf.quality(base | {"serial": {"sequence": {"received": 100, "loss_ratio": 0.0}}}) == "good"


def test_state_names_match_engineering_report():
    assert RfAssessor().assess(_csi(age=None) | {"link": {"total_frames": 0}}, 0)["state"] == "NO_DATA"


def test_protocol_version_and_device_defaults():
    msg = protocol.parse_line('{"type":"hello"}')
    assert msg["v"] == 1 and msg["device_id"] == "mega_01"
    with pytest.raises(protocol.ProtocolError):
        protocol.parse_line('{"type":"hello","v":2}')
    reading = protocol.parse_line('{"type":"sensor_reading","sensor":"mq_raw","raw_adc":1}')
    assert reading["sensor_status"] == "unknown"


# -- nodes, notes, manual incidents ---------------------------------------------------------
def test_nodes_store_and_validation_via_service():
    svc = _service()
    svc.store.touch_node("rx_01", 100.0, "3.1", 6)
    node = svc.update_node("rx_01", {"x_m": 1.5, "y_m": 0.0, "z_m": 0.8, "orientation_deg": 90.0, "antenna": "pcb"})
    assert node["x_m"] == 1.5 and node["antenna"] == "pcb" and node["firmware"] == "3.1" and node["first_seen_at"] == 100.0
    with pytest.raises(ValueError):
        svc.store.update_node("rx_01", {"bogus": 1}, 0.0)


def test_manual_incident_and_notes():
    svc = _service()
    incident = svc.create_incident("North wall check")
    assert incident["status"] == "open" and incident["observations"][0]["observation_type"] == "manual"
    noted = svc.add_note(incident["id"], "Debris unstable on east side")
    assert noted["observations"][-1]["detail"]["text"].startswith("Debris")
    assert svc.add_note(9999, "x") is None
    svc.acknowledge(incident["id"])
    svc.close_incident(incident["id"])
    assert svc.add_note(incident["id"], "too late") is None


def test_api_nodes_notes_and_manual_incident():
    from starlette.testclient import TestClient
    import app as backend_app

    tmp = Path(tempfile.mkdtemp())
    options = backend_app.RuntimeOptions(simulate=True, calibration_file=str(tmp / "cal.json"), db_path=str(tmp / "j.db"))
    with TestClient(backend_app.create_app(options)) as client:
        created = client.post("/api/incidents", json={"summary": "Corridor B survey"})
        assert created.status_code == 201
        iid = created.json()["id"]
        assert client.post("/api/incidents", json={"summary": "x"}).status_code == 400
        assert client.post(f"/api/incidents/{iid}/notes", json={"text": "seen movement near vent"}).status_code == 201
        assert client.post(f"/api/incidents/{iid}/notes", json={"text": ""}).status_code == 400
        assert client.post("/api/incidents/9999/notes", json={"text": "x"}).status_code == 404
        assert client.get("/api/incidents").status_code == 200
        deadline = time.time() + 8
        while time.time() < deadline and not client.get("/api/nodes").json():
            time.sleep(0.2)
        assert client.get("/api/nodes").json()[0]["node_id"] == "sim_rx_01"
        ok = client.put("/api/nodes/sim_rx_01", json={"x_m": 2, "y_m": 3.5, "z_m": 1, "orientation_deg": 45, "antenna": "pcb"})
        assert ok.status_code == 200 and ok.json()["y_m"] == 3.5
        assert client.put("/api/nodes/sim_rx_01", json={"x_m": "far"}).status_code == 400
        assert client.put("/api/nodes/bad id!", json={"x_m": 1}).status_code in (400, 404)
        assert client.put("/api/nodes/sim_rx_01", json={}).status_code == 400


# -- real reader loops: they hand the parsers bytearrays, not bytes --------------------
class FakeSerial:
    def __init__(self, data, reader):
        self.data, self.reader, self.written = data, reader, b""

    @property
    def in_waiting(self):
        return len(self.data)

    def read(self, size):
        chunk, self.data = self.data[:size], self.data[size:]
        if not self.data:
            self.reader._stop.set()
        return chunk

    def write(self, payload):
        self.written += payload

    def flush(self):
        pass


def test_csi_read_loop_parses_stream_without_losing_the_link():
    from serial_io import SerialCSIReader

    frames = []
    reader = SerialCSIReader("fake", on_frame=frames.append)
    stream = "#JATAYU,proto=1,node=rx_test,fw=3.1\n#WIFI,got_ip,ip=1.2.3.4\n" + "\n".join(_csi1(s) for s in (1, 2, 3)) + "\n"
    reader._serial = FakeSerial(stream.encode(), reader)
    reader._read_loop()
    assert [frame.seq for frame in frames] == [1, 2, 3]
    assert reader.status()["node_id"] == "rx_test"
    assert reader.parser.device["wifi"]["state"] == "got_ip"


def test_arduino_read_loop_parses_stream_and_counts_garbage():
    messages = []
    reader = ArduinoReader("fake", on_message=messages.append)
    reader._serial = FakeSerial(b'boot noise\n{"type":"hello"}\n{"type":"key_event","key":"1"}\n', reader)
    reader._read_loop()
    assert [message["type"] for message in messages] == ["hello", "key_event"]
    assert reader.messages_ok == 2 and reader.messages_rejected == 1


def test_limit_spikes_clips_bursts_and_keeps_rhythm():
    import numpy as np
    from processing import _limit_spikes

    rhythm = np.sin(np.arange(300) / 5.0)[:, None]
    burst = rhythm.copy()
    burst[100:110] = 500.0
    assert np.allclose(_limit_spikes(rhythm), rhythm)
    assert _limit_spikes(burst).max() < 10.0


def test_scenario_rate_profile():
    from serial_io import scenario_bpm

    assert scenario_bpm(0) == 14 and scenario_bpm(8) == 19 and scenario_bpm(16) == 14
    assert 13 < scenario_bpm(17) < 15 and scenario_bpm(30) == 14


def test_analyze_recording_scores_simulated_breathing():
    import analyze_recording
    from serial_io import SimulatedCSIProducer

    sim = SimulatedCSIProducer(bpm=15.0, distance_m=2.0)
    frames = sim.prime(90.0)
    summary = analyze_recording.summarise(frames, analyze_recording.replay(frames), breaths=22.5)
    assert summary["counted_rate"] == 15.0
    assert summary["error_bpm"] <= 1.0 and summary["windows_within_2bpm_pct"] > 80


def test_key_7_toggles_simulation_and_stores_nothing():
    from starlette.testclient import TestClient
    import app as backend_app

    tmp = Path(tempfile.mkdtemp())
    options = backend_app.RuntimeOptions(serial_port="no-such-port", arduino_port="none",
                                         calibration_file=str(tmp / "cal.json"), db_path=str(tmp / "j.db"))
    application = backend_app.create_app(options)

    def wait_for(ws, source):
        for _ in range(12):
            message = ws.receive_json()
            if message.get("type") == "telemetry" and message.get("source") == source:
                return message
        raise AssertionError(f"no {source} telemetry")

    with TestClient(application) as client, client.websocket_connect("/ws") as ws:
        assert wait_for(ws, "serial")["state"] == "no_signal"
        ws.send_json({"type": "demo"})
        shown = wait_for(ws, "simulation")
        assert shown["state"] == "breathing" and 14 <= shown["bpm"] <= 19 and shown["serial"] is None
        assert "PERIODIC_PATTERN" not in client.get("/api/rf/history").text
        ws.send_json({"type": "demo"})
        assert wait_for(ws, "serial")["state"] == "no_signal"


@pytest.mark.parametrize("line", [
    "CSI1,-1,100,-50,-96,6,0," + ",".join(["20.0"] * 64),            # negative sequence
    "CSI1,1,100,5,-96,6,0," + ",".join(["20.0"] * 64),               # impossible RSSI
    "CSI1,1,100,-200,-96,6,0," + ",".join(["20.0"] * 64),            # impossible RSSI
    "CSI1,1,100,-50,-96,0,0," + ",".join(["20.0"] * 64),             # no such channel
    "CSI1,1,100,-50,-96,15,0," + ",".join(["20.0"] * 64),            # no such channel
    "CSI1,1,100,-50,-96,6,0," + ",".join(["-1.0"] * 64),             # negative magnitude
    "CSI1,1,100,-50,-96,6,0," + ",".join(["99999.0"] * 64),          # above saturation
    "CSI1,1,100,-50,-96,6,0," + ",".join(["nan"] * 64),              # not a number
    "CSI1,1,100,-50,-96,6,0," + ",".join(["20.0"] * 129),            # too many subcarriers
    "CSI1,1,100,-50,-96,6,0,20.0,20.0",                              # truncated
    "CSI1,x,100,-50,-96,6,0," + ",".join(["20.0"] * 64),             # bad sequence
    "CSI1," + "9" * 3000,                                            # oversized
])
def test_hard_limits_reject_corrupt_csi_rows(line):
    from serial_io import CSIStreamParser

    parser = CSIStreamParser()
    assert parser.parse_line(line, 1.0) is None
    assert parser.dropped == 1 and parser.seq.received == 0


def test_limits_accept_valid_extremes():
    from serial_io import CSIStreamParser

    parser = CSIStreamParser()
    for row in ("CSI1,0,100,-127,-96,1,0," + ",".join(["0.0"] * 64), "CSI1,1,200,0,-96,14,0," + ",".join(["9999.9"] * 128)):
        assert parser.parse_line(row, 1.0) is not None
    assert parser.dropped == 0


@pytest.mark.parametrize("seed", range(4))
def test_output_stays_within_limits_on_arbitrary_signals(seed):
    import numpy as np
    from processing import CSIFrame, CSIProcessor, ProcessorConfig

    rng = np.random.default_rng(seed)
    processor = CSIProcessor(ProcessorConfig(), calibration_path=str(Path(tempfile.mkdtemp()) / "c.json"))
    t = 0.0
    while t < 40.0:
        t += float(rng.uniform(0.005, 0.2))
        amplitudes = rng.uniform(0.0, 9999.0, 64) if rng.random() < 0.02 else 30.0 + rng.normal(0, 2 + seed * 5, 64).clip(-30)
        processor.add_frame(CSIFrame(t, -50.0, amplitudes))
    result = processor.telemetry(t)
    assert 0.0 <= result["confidence"] <= 1.0
    assert all(0.0 <= value <= 1.0 for value in result["scores"].values())
    for rate in (result.get("bpm"), result.get("bpm_instant")):
        assert rate is None or 11.0 <= rate <= 30.0


def test_simulated_script_stays_within_its_range():
    from serial_io import scenario_bpm

    assert all(13.3 <= scenario_bpm(t / 10.0) <= 19.0 for t in range(0, 600))


def test_analysis_meets_its_time_budget():
    import numpy as np
    from processing import CSIProcessor, ProcessorConfig
    from serial_io import SimulatedCSIProducer

    processor = CSIProcessor(ProcessorConfig(), calibration_path=str(Path(tempfile.mkdtemp()) / "c.json"))
    for frame in SimulatedCSIProducer(bpm=15.0).prime(35.0):
        processor.add_frame(frame)
    times = []
    for _ in range(5):
        started = time.perf_counter()
        processor.telemetry()
        times.append(time.perf_counter() - started)
    assert float(np.median(times)) < 0.5  # one analysis runs every second


def test_remove_shifts_cancels_a_level_step_and_keeps_rhythm():
    import numpy as np
    from processing import _remove_shifts

    t = np.arange(300) / 10.0
    rhythm = np.sin(2 * np.pi * t / 4.0)
    shifted = rhythm + (t > 15.0) * 20.0
    cleaned = _remove_shifts(shifted[:, None], 150)[:, 0]
    assert abs(cleaned[:100].mean() - cleaned[-100:].mean()) < 1.0
    assert np.corrcoef(cleaned[50:120], rhythm[50:120])[0, 1] > 0.9


def test_native_usb_port_preferred_over_uart_bridge(monkeypatch):
    import serial_io

    ports = [{"device": "/dev/ttyACM0", "vid": "1A86", "candidate": True},  # could be a Mega clone
             {"device": "/dev/ttyACM1", "vid": "303A", "candidate": True}]
    monkeypatch.setattr(serial_io, "list_serial_ports", lambda: ports)
    assert serial_io.find_esp32_port() == "/dev/ttyACM1"


def test_console_and_csi_pages_are_served():
    from starlette.testclient import TestClient
    import app as backend_app

    tmp = Path(tempfile.mkdtemp())
    options = backend_app.RuntimeOptions(simulate=True, calibration_file=str(tmp / "cal.json"), db_path=str(tmp / "j.db"))
    with TestClient(backend_app.create_app(options)) as client:
        home = client.get("/")
        assert home.status_code == 200 and "JATAYU Console" in home.text
        assert "Not a calibrated or certified" in home.text or "not a gas concentration" in home.text
        for banned in ("survivor detected", "Breathing detected"):
            assert banned.lower() not in home.text.lower()
        csi = client.get("/csi")
        assert csi.status_code == 200 and "RescueSense Console" not in csi.text


def test_console_has_guidance_and_signal_lab():
    from starlette.testclient import TestClient
    import app as backend_app

    tmp = Path(tempfile.mkdtemp())
    options = backend_app.RuntimeOptions(simulate=True, calibration_file=str(tmp / "cal.json"), db_path=str(tmp / "j.db"))
    with TestClient(backend_app.create_app(options)) as client:
        home = client.get("/").text
        for needle in ("What to do next", "Setup checklist", "Signal lab", "/csi?embed=1", "Help and glossary", "Take the tour", "Simple", "Text size"):
            assert needle in home, needle
        lab = client.get("/csi?embed=1").text


def test_key_7_drives_the_console_too():
    from starlette.testclient import TestClient
    import app as backend_app

    tmp = Path(tempfile.mkdtemp())
    options = backend_app.RuntimeOptions(serial_port="no-such-port", arduino_port="none",
                                         calibration_file=str(tmp / "cal.json"), db_path=str(tmp / "j.db"))

    def wait_status(client, check):
        deadline = time.time() + 8
        while time.time() < deadline:
            status = client.get("/api/status").json()
            if check(status):
                return status
            time.sleep(0.2)
        raise AssertionError(status)

    with TestClient(backend_app.create_app(options)) as client:
        assert client.get("/api/status").json()["source"] == "live"
        assert client.post("/demo").json() == {"active": True}
        shown = wait_status(client, lambda s: s["rf"]["state"] == "PERIODIC_PATTERN_OBSERVED")
        assert shown["source"] == "demo"
        assert client.post("/demo").json() == {"active": False}
        back = wait_status(client, lambda s: s["rf"]["state"] != "PERIODIC_PATTERN_OBSERVED")
        assert back["source"] == "live"
        assert "simulated" not in client.get("/api/rf/history").text


def test_3d_library_is_served_locally_and_only_listed_files():
    from starlette.testclient import TestClient
    import app as backend_app

    tmp = Path(tempfile.mkdtemp())
    options = backend_app.RuntimeOptions(simulate=True, calibration_file=str(tmp / "c.json"), db_path=str(tmp / "j.db"))
    with TestClient(backend_app.create_app(options)) as client:
        assert "cdn.jsdelivr" not in client.get("/csi").text
        assert client.get("/vendor/three.min.js").status_code == 200
        assert client.get("/vendor/OrbitControls.js").status_code == 200
        assert client.get("/vendor/secrets.txt").status_code == 404


def test_keypad_code_reports_lives_and_shows_in_snapshot():
    svc = _service()
    _key(svc, "0")
    _key(svc, "2")
    lives = svc.snapshot()["lives"]
    assert lives["total"] == 2 and lives["last"]["text"] == "2 lives saved"
    assert svc.monitoring is False  # the 2 was part of the code, not "stop monitoring"
    _key(svc, "0")
    _key(svc, "1")
    assert svc.snapshot()["lives"]["total"] == 3
    assert svc.snapshot()["lives"]["last"]["text"] == "1 life saved"


def test_keypad_code_undo_and_empty_undo():
    svc = _service()
    _key(svc, "0")
    _key(svc, "0")
    assert svc.snapshot()["lives"]["last"] is None
    for key in "05" "00":
        _key(svc, key)
    lives = svc.snapshot()["lives"]
    assert lives["total"] == 0 and "undone" in lives["last"]["text"]


def test_keys_outside_a_code_keep_their_normal_actions(monkeypatch):
    svc = _service()
    _key(svc, "1")
    assert svc.monitoring is True
    _key(svc, "0")
    _key(svc, "#")  # a non-digit ends the code
    _key(svc, "2")
    assert svc.monitoring is False and svc.snapshot()["lives"]["total"] == 0
    _key(svc, "1")
    _key(svc, "0")
    real_time = time.time
    monkeypatch.setattr(time, "time", lambda: real_time() + 4.0)  # too slow for a code
    _key(svc, "2")
    assert svc.monitoring is False and svc.snapshot()["lives"]["total"] == 0


def test_lives_total_survives_a_restart():
    svc = _service()
    for key in "03" "02" "00":
        _key(svc, key)
    assert JatayuService(svc.store, simulated=True).snapshot()["lives"]["total"] == 3


def test_board_without_lcd_gets_no_lcd_commands():
    device = FakeDevice()
    svc = _service(device)
    svc.handle_arduino_message(protocol.parse_line('{"type":"hello","lcd":false}'))
    assert svc.request_inspection()["command"] is None


def test_uno_firmware_messages_are_accepted():
    source = (Path(__file__).resolve().parents[2] / "arduino" / "jatayu_uno" / "jatayu_uno.ino").read_text()
    assert "115200" in source
    for line in ('{"type":"hello","firmware":"jatayu-uno-1.0","model":"MQ-135","lcd":false}',
                 '{"type":"sensor_reading","sensor":"mq_raw","model":"MQ-135","raw_adc":21,"calibration":"NOT_CALIBRATED","sensor_status":"ok","timestamp_ms":1000}',
                 '{"type":"key_event","key":"A","r":0,"c":3}',
                 '{"type":"cmd_ack","command_id":"c1","status":"failed","detail":"not supported on this board"}'):
        assert protocol.parse_line(line)["type"] in {"hello", "sensor_reading", "key_event", "cmd_ack"}


def test_signal_view_has_gas_card_and_no_gas_concentration_claim():
    page = (Path(__file__).resolve().parents[2] / "dashboard" / "index.html").read_text(encoding="utf-8")
    assert 'id="gasCard"' in page and "/api/sensors/history" in page and "Not a gas concentration" in page
    assert "ppm" not in page.lower()


@pytest.mark.parametrize("page,sections", [
    ("console.html", ["envCard", "rfCard", "tiles", "incCard", "evCard"]),
    ("index.html", ["gasCard", "hero", "deviceLog", "evTitle", "heatTitle"]),
])
def test_keypad_sections_exist_on_each_page(page, sections):
    html = (Path(__file__).resolve().parents[2] / "dashboard" / page).read_text(encoding="utf-8")
    assert "jumpToKeySection" in html
    for section in sections:
        assert f'id="{section}"' in html and f"'{section}'" in html


def test_built_console_is_served_when_present():
    from starlette.testclient import TestClient
    import app as backend_app

    tmp = Path(tempfile.mkdtemp())
    (tmp / "dist" / "assets").mkdir(parents=True)
    (tmp / "dist" / "index.html").write_text("<title>react console</title>")
    (tmp / "dist" / "assets" / "app.js").write_text("console.log(1)")
    options = backend_app.RuntimeOptions(simulate=True, calibration_file=str(tmp / "c.json"), db_path=str(tmp / "j.db"),
                                         console_dist=str(tmp / "dist"))
    with TestClient(backend_app.create_app(options)) as client:
        assert "react console" in client.get("/").text
        assert client.get("/assets/app.js").status_code == 200
        assert client.get("/csi").status_code == 200


def test_candidate_rate_reaches_rf_features():
    rf = RfAssessor().assess(_csi("empty") | {"bpm": None, "bpm_instant": 18.5}, 100)
    assert rf["features"]["dominant_rate_per_min"] == 18.5


def test_compare_recordings_verdict():
    from compare_recordings import verdict

    assert "Not enough" in verdict([1.0], [2.0, 3.0])
    assert "do not overlap" in verdict([3.0, 4.0], [0.5, 0.7])
    assert "overlap" in verdict([1.0, 3.0], [2.0, 4.0]) and "do not" in verdict([1.0, 3.0], [2.0, 4.0])


def test_audio_alert_is_stored_and_opens_incident_only_when_monitoring():
    svc = _service()
    assert svc.snapshot()["audio"]["online"] is False
    svc.report_audio("help", 'Possible call for help heard: "help me"', 0.8)
    assert svc.snapshot()["audio"]["last"]["kind"] == "help"
    assert svc.store.incidents(limit=5) == []
    svc.start_monitoring()
    svc.report_audio("scream", "Possible scream heard", 0.4)
    assert len(svc.store.incidents(limit=5)) == 1
    assert sum(e["event_type"] == "AUDIO_ALERT" for e in svc.store.events(limit=50)) == 2


@pytest.mark.parametrize("kind,score", [("music", 0.5), ("help", 1.5), ("help", -0.1)])
def test_audio_alert_limits(kind, score):
    with pytest.raises(ValueError):
        _service().report_audio(kind, "x", score)


def test_audio_heartbeat_goes_stale():
    svc = _service()
    svc.audio_heartbeat(0.01)
    assert svc.snapshot()["audio"]["online"] is True
    svc.audio_heartbeat(0.01, now=time.time() - 60)
    assert svc.snapshot()["audio"]["online"] is False


def _audio_detector():
    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "audio"))
    from detector import AudioDetector
    return AudioDetector()


def test_detector_weak_scream_needs_repeat_and_strong_is_immediate():
    det = _audio_detector()
    assert det.on_sound_scores({"Screaming": 0.12}, 0.0) is None
    assert det.on_sound_scores({"Screaming": 0.12}, 0.5).kind == "scream"
    assert _audio_detector().on_sound_scores({"Yell": 0.5}, 0.0).kind == "scream"
    assert _audio_detector().on_sound_scores({"Speech": 0.9, "Music": 0.9}, 0.0) is None


def test_detector_cooldown_and_help_words():
    det = _audio_detector()
    assert det.on_sound_scores({"Screaming": 0.9}, 0.0) is not None
    assert det.on_sound_scores({"Screaming": 0.9}, 1.0) is None
    assert det.on_sound_scores({"Screaming": 0.9}, 6.0) is not None
    words = [{"word": "help", "conf": 0.9}, {"word": "me", "conf": 0.8}]
    assert _audio_detector().on_words(words, 10.0) is None  # no voice heard: treated as noise
    det.on_sound_scores({"Speech": 0.6}, 9.5)
    assert '"help me"' in det.on_words(words, 10.0).text
    weak = _audio_detector()
    weak.on_sound_scores({"Speech": 0.6}, 0.0)
    assert weak.on_words([{"word": "help", "conf": 0.3}], 0.5) is None
    assert weak.on_words([{"word": "[unk]", "conf": 1.0}], 0.5) is None


def test_detector_boosts_faint_audio_and_ignores_silence():
    import numpy as np
    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "audio"))
    from detector import condition

    t = np.arange(16000) / 16000
    faint = condition(0.02 * np.sin(2 * np.pi * 800 * t))
    assert np.max(np.abs(faint)) > 0.3
    det = _audio_detector()
    room = 0.002 * np.random.default_rng(1).normal(size=16000)
    for _ in range(10):
        det.above_noise(room)
    assert det.above_noise(room * 4) is True
    assert det.above_noise(np.zeros(16000)) is False


def test_microphone_is_off_until_operator_turns_it_on():
    svc = _service()
    assert svc.audio_heartbeat(0.0)["enabled"] is False
    assert svc.set_audio_enabled(True)["enabled"] is True
    reply = svc.audio_heartbeat(0.02, listening=True, heard={"label": "Speech", "score": 0.6})
    audio = svc.snapshot()["audio"]
    assert reply["enabled"] is True and audio["listening"] is True and audio["heard"]["label"] == "Speech"
    svc.set_audio_enabled(False)
    assert svc.audio_heartbeat(0.0)["enabled"] is False
    assert sum(e["event_type"] in {"MICROPHONE_ON", "MICROPHONE_OFF"} for e in svc.store.events(limit=20)) == 2


def test_microphone_api_rejects_non_boolean():
    from starlette.testclient import TestClient
    import app as backend_app

    tmp = Path(tempfile.mkdtemp())
    options = backend_app.RuntimeOptions(simulate=True, calibration_file=str(tmp / "c.json"), db_path=str(tmp / "j.db"))
    with TestClient(backend_app.create_app(options)) as client:
        assert client.post("/api/audio/control", json={"enabled": "yes"}).status_code == 400
        assert client.post("/api/audio/control", json={"enabled": True}).json() == {"enabled": True}
        assert client.post("/api/audio/heartbeat", json={"level": 0.1, "listening": True}).json() == {"enabled": True}


def test_detector_matches_whole_help_words_only():
    def heard(*words):
        det = _audio_detector()
        det.on_sound_scores({"Speech": 0.6}, 0.0)
        return det.on_words([{"word": w, "conf": 0.9} for w in words], 0.5)

    assert heard("helping", "out") is None  # used to crash the listener
    assert heard("helpful") is None
    assert heard("he", "help", "me").text.endswith('"help me"')
    assert heard("please", "help").text.endswith('"please help"')
    assert heard("help").text.endswith('"help"')


def _voice_blocks(seconds, pitch=500.0, amp=0.1, vibrato=6.0, seed=0):
    import numpy as np
    rng = np.random.default_rng(seed)
    t = np.arange(int(seconds * 16000)) / 16000
    phase = 2 * np.pi * np.cumsum(pitch * (1 + vibrato / 100 * np.sin(2 * np.pi * 5 * t))) / 16000
    wave = sum(np.sin(k * phase) / k for k in range(1, 6)) * amp + rng.normal(0, 0.0005, t.size)
    return [wave[i:i + 1600] for i in range(0, wave.size - 1599, 1600)]


def _feed_after_quiet(det, blocks):
    import numpy as np
    rng = np.random.default_rng(3)
    for i in range(20):
        det.on_block(rng.normal(0, 0.0005, 1600), i * 0.1)
    return [a for k, b in enumerate(blocks) if (a := det.on_block(b, 2.0 + k * 0.1))]


@pytest.mark.parametrize("pitch,amp", [(500.0, 0.1), (900.0, 0.1), (250.0, 0.1), (500.0, 0.004)])
def test_sustained_aaaa_and_eeee_are_flagged_including_faint(pitch, amp):
    alerts = _feed_after_quiet(_audio_detector(), _voice_blocks(1.5, pitch, amp))
    assert alerts and alerts[0].kind == "scream"


def test_short_vowel_steady_tone_and_noise_are_not_flagged():
    import numpy as np
    assert not _feed_after_quiet(_audio_detector(), _voice_blocks(0.3))
    t = np.arange(32000) / 16000
    tone = 0.1 * np.sin(2 * np.pi * 1000 * t)
    assert not _feed_after_quiet(_audio_detector(), [tone[i:i + 1600] for i in range(0, 30400, 1600)])
    noise = np.random.default_rng(1).normal(0, 0.05, 32000)
    assert not _feed_after_quiet(_audio_detector(), [noise[i:i + 1600] for i in range(0, 30400, 1600)])


def test_alert_carries_rough_proximity_from_loudness():
    sys.path.insert(0, str(Path(__file__).resolve().parents[2] / "audio"))
    from detector import proximity_from_level

    assert [proximity_from_level(x) for x in (-10, -30, -50)] == ["close", "medium", "far"]
    loud = _feed_after_quiet(_audio_detector(), _voice_blocks(1.5, amp=0.2))[0]
    faint = _feed_after_quiet(_audio_detector(), _voice_blocks(1.5, amp=0.004))[0]
    assert loud.proximity == "close" and faint.proximity == "far"
    svc = _service()
    assert svc.report_audio("scream", "x", 0.5, level_db=-20.0, proximity="close")["proximity"] == "close"
    with pytest.raises(ValueError):
        svc.report_audio("scream", "x", 0.5, proximity="here")

