"""Offline listener: laptop microphone -> scream and help detection -> JATAYU backend.

    python listener.py --backend http://192.168.137.10:8000
    python listener.py --list-devices
    python listener.py --file test.wav --dry-run

Audio stays in memory and is never saved or sent. Only the result (kind, text,
score) goes to the backend. Results are observations for an operator to review.
"""

from __future__ import annotations

import argparse
import csv
import json
import queue
import threading
import time
import wave
from pathlib import Path

import numpy as np
import requests
import vosk
from ai_edge_litert.interpreter import Interpreter

from detector import SAMPLE_RATE, AudioDetector, condition, rms

HERE = Path(__file__).resolve().parent
MODELS = HERE / "models"
WINDOW = 15600  # YAMNet's fixed input, 0.975 s
HOP = 8000  # classify twice a second, so a short cry is not split across windows
BLOCK = 1600
HEARTBEAT_S = 3.0


class SoundClassifier:
    def __init__(self) -> None:
        self.model = Interpreter(model_path=str(MODELS / "yamnet.tflite"))
        self.model.allocate_tensors()
        self.input = self.model.get_input_details()[0]["index"]
        self.output = self.model.get_output_details()[0]["index"]
        with open(MODELS / "yamnet_class_map.csv", encoding="utf-8") as handle:
            self.names = [row["display_name"] for row in csv.DictReader(handle)]

    def scores(self, samples: np.ndarray) -> dict[str, float]:
        self.model.set_tensor(self.input, samples.astype(np.float32))
        self.model.invoke()
        values = np.asarray(self.model.get_tensor(self.output)).reshape(-1, len(self.names)).max(axis=0)
        return dict(zip(self.names, values.tolist()))


class Reporter:
    """Sends results on its own thread, so a slow network never stalls listening."""

    def __init__(self, backend: str | None) -> None:
        self.backend = backend.rstrip("/") if backend else None
        self.outbox: queue.Queue[tuple[str, dict]] = queue.Queue(maxsize=50)
        if self.backend:
            threading.Thread(target=self._run, daemon=True).start()

    def send(self, path: str, payload: dict) -> None:
        if self.backend:
            try:
                self.outbox.put_nowait((path, payload))
            except queue.Full:
                pass

    def _run(self) -> None:
        reachable = None
        while True:
            path, payload = self.outbox.get()
            try:
                requests.post(f"{self.backend}{path}", json=payload, timeout=3).raise_for_status()
                if reachable is not True:
                    print(f"Connected to {self.backend}")
                reachable = True
            except requests.RequestException as exc:
                if reachable is not False:
                    print(f"Backend not reachable, still listening: {exc.__class__.__name__}")
                reachable = False


class Pipeline:
    def __init__(self, reporter: Reporter) -> None:
        self.reporter = reporter
        self.detector = AudioDetector()
        self.classifier = SoundClassifier()
        vosk.SetLogLevel(-1)
        self.words = vosk.KaldiRecognizer(vosk.Model(str(MODELS / "vosk-model-small-en-us-0.15")), SAMPLE_RATE)
        self.words.SetWords(True)
        self.buffer = np.zeros(0, dtype=np.float32)
        self.level = 0.0

    def _report(self, alert) -> None:
        if alert is None:
            return
        print(f"{time.strftime('%H:%M:%S')}  {alert.text}  (score {alert.score})")
        self.reporter.send("/api/audio/event", {"kind": alert.kind, "text": alert.text, "score": alert.score})

    def feed(self, samples: np.ndarray, now: float) -> None:
        self.level = rms(samples)
        # Full vocabulary: limiting it to help phrases forces boosted noise into those words.
        pcm = (np.clip(condition(samples), -1.0, 1.0) * 32767).astype(np.int16).tobytes()
        if self.words.AcceptWaveform(pcm):
            self._report(self.detector.on_words(json.loads(self.words.Result()).get("result", []), now))
        self.buffer = np.concatenate([self.buffer, samples])
        while self.buffer.size >= WINDOW:
            window, self.buffer = self.buffer[:WINDOW], self.buffer[HOP:]
            if self.detector.above_noise(window):
                self._report(self.detector.on_sound_scores(self.classifier.scores(condition(window)), now))

    def finish(self, now: float) -> None:
        self._report(self.detector.on_words(json.loads(self.words.FinalResult()).get("result", []), now))


def run_file(path: str, pipeline: Pipeline) -> None:
    with wave.open(path, "rb") as source:
        if source.getframerate() != SAMPLE_RATE or source.getnchannels() != 1 or source.getsampwidth() != 2:
            raise SystemExit(f"{path} must be 16 kHz, mono, 16-bit.")
        data = np.frombuffer(source.readframes(source.getnframes()), dtype=np.int16).astype(np.float32) / 32768.0
    clock = 0.0
    for start in range(0, data.size, BLOCK):
        pipeline.feed(data[start:start + BLOCK], clock)
        clock += BLOCK / SAMPLE_RATE
    pipeline.finish(clock)


def run_microphone(device: int | None, pipeline: Pipeline, reporter: Reporter) -> None:
    import sounddevice as sd  # only needed for live listening

    blocks: queue.Queue[np.ndarray] = queue.Queue(maxsize=100)

    def on_audio(indata, _frames, _time, _status) -> None:
        try:
            blocks.put_nowait(indata[:, 0].copy())
        except queue.Full:
            pass  # analysis fell behind: drop rather than build up delay

    print("Listening. Audio is not saved. Press Ctrl+C to stop.")
    last_beat = 0.0
    with sd.InputStream(device=device, samplerate=SAMPLE_RATE, channels=1, dtype="float32", blocksize=BLOCK, callback=on_audio):
        while True:
            pipeline.feed(blocks.get(), time.monotonic())
            now = time.monotonic()
            if now - last_beat >= HEARTBEAT_S:
                last_beat = now
                reporter.send("/api/audio/heartbeat", {"level": round(pipeline.level, 5)})


def main() -> None:
    parser = argparse.ArgumentParser(description="Listen for screams and calls for help")
    parser.add_argument("--backend", default="http://192.168.137.10:8000")
    parser.add_argument("--device", type=int, help="input device number (see --list-devices)")
    parser.add_argument("--list-devices", action="store_true")
    parser.add_argument("--file", help="analyse a 16 kHz mono WAV file instead of the microphone")
    parser.add_argument("--dry-run", action="store_true", help="print results without sending them")
    args = parser.parse_args()
    if args.list_devices:
        import sounddevice as sd

        print(sd.query_devices())
        return
    reporter = Reporter(None if args.dry_run else args.backend)
    pipeline = Pipeline(reporter)
    try:
        if args.file:
            run_file(args.file, pipeline)
            time.sleep(0.5)  # let queued results go out
        else:
            run_microphone(args.device, pipeline, reporter)
    except KeyboardInterrupt:
        print("\nStopped.")


if __name__ == "__main__":
    main()
