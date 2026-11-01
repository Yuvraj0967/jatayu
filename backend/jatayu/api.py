"""REST + WebSocket routes for the JATAYU layer (mounted by app.py)."""

from __future__ import annotations

import asyncio
import json
import re
from typing import Any

from starlette.requests import Request
from starlette.responses import JSONResponse
from starlette.routing import Route, WebSocketRoute
from starlette.websockets import WebSocket, WebSocketDisconnect

from .protocol import VALID_KEYS
from .service import JatayuService


class LiveHub:
    """Fans service events out to /ws/live clients. publish() is thread-safe."""

    def __init__(self) -> None:
        self.clients: set[WebSocket] = set()
        self.loop: asyncio.AbstractEventLoop | None = None

    def publish(self, payload: dict[str, Any]) -> None:
        loop = self.loop
        if loop is None or loop.is_closed():
            return
        loop.call_soon_threadsafe(lambda: loop.create_task(self.broadcast(payload)))

    async def broadcast(self, payload: dict[str, Any]) -> None:
        for client in tuple(self.clients):
            try:
                await client.send_json(payload)
            except Exception:
                self.clients.discard(client)


def build_routes(service: JatayuService, hub: LiveHub, extra_status: Any = None) -> list[Any]:
    def err(message: str, status: int = 400) -> JSONResponse:
        return JSONResponse({"detail": message}, status_code=status)

    async def body(request: Request) -> dict[str, Any]:
        try:
            data = await request.json()
        except Exception:
            return {}
        return data if isinstance(data, dict) else {}

    def int_param(request: Request, name: str, default: int, low: int, high: int) -> int:
        try:
            return max(low, min(high, int(request.query_params.get(name, default))))
        except ValueError:
            return default

    async def status(_r: Request) -> JSONResponse:
        snap = service.snapshot()
        snap["arduino_link"] = service.arduino.status() if service.arduino else None
        if extra_status:
            snap["csi_link"] = extra_status()
        return JSONResponse(snap)

    async def sensors_latest(_r: Request) -> JSONResponse:
        return JSONResponse(service.gas.assess(__import__('time').time()))

    async def sensors_history(r: Request) -> JSONResponse:
        return JSONResponse(service.store.readings(r.query_params.get("sensor"), limit=int_param(r, "limit", 300, 1, 2000)))

    async def rf_status(_r: Request) -> JSONResponse:
        return JSONResponse(service.rf_state)

    async def rf_history(r: Request) -> JSONResponse:
        return JSONResponse(service.store.rf_observations(int_param(r, "limit", 200, 1, 1000)))

    async def incidents(r: Request) -> JSONResponse:
        return JSONResponse(service.store.incidents(r.query_params.get("status"), int_param(r, "limit", 100, 1, 500)))

    async def incident_detail(r: Request) -> JSONResponse:
        detail = service.store.incident_detail(int(r.path_params["id"]))
        return JSONResponse(detail) if detail else err("incident not found", 404)

    async def create_incident(r: Request) -> JSONResponse:
        summary = (await body(r)).get("summary")
        if not isinstance(summary, str) or not 3 <= len(summary.strip()) <= 200:
            return err("summary must be a string of 3 to 200 characters")
        return JSONResponse(service.create_incident(summary), status_code=201)

    async def add_note(r: Request) -> JSONResponse:
        text = (await body(r)).get("text")
        if not isinstance(text, str) or not 1 <= len(text.strip()) <= 500:
            return err("text must be a string of 1 to 500 characters")
        result = service.add_note(int(r.path_params["id"]), text.strip())
        return JSONResponse(result, status_code=201) if result else err("incident not found or already closed", 404)

    async def nodes(_r: Request) -> JSONResponse:
        return JSONResponse(service.store.nodes())

    async def update_node(r: Request) -> JSONResponse:
        node_id = r.path_params["node_id"]
        if not re.fullmatch(r"[A-Za-z0-9_\-]{1,40}", node_id):
            return err("node_id may contain letters, digits, _ and - (max 40)")
        data = await body(r)
        fields: dict[str, Any] = {}
        for key in ("x_m", "y_m", "z_m"):
            if key in data:
                v = data[key]
                if isinstance(v, bool) or not isinstance(v, (int, float)) or not -1000 <= v <= 1000:
                    return err(f"{key} must be a number of metres between -1000 and 1000")
                fields[key] = float(v)
        if "orientation_deg" in data:
            v = data["orientation_deg"]
            if isinstance(v, bool) or not isinstance(v, (int, float)) or not 0 <= v < 360:
                return err("orientation_deg must be a number from 0 to under 360")
            fields["orientation_deg"] = float(v)
        for key, limit in (("antenna", 64), ("notes", 500), ("role", 40)):
            if key in data:
                if not isinstance(data[key], str) or len(data[key]) > limit:
                    return err(f"{key} must be a string up to {limit} characters")
                fields[key] = data[key]
        if not fields:
            return err("no valid node fields supplied")
        return JSONResponse(service.update_node(node_id, fields))

    async def events(r: Request) -> JSONResponse:
        return JSONResponse(service.store.events(limit=int_param(r, "limit", 100, 1, 1000)))

    async def commands(_r: Request) -> JSONResponse:
        return JSONResponse(service.commands.recent())

    async def start(_r: Request) -> JSONResponse:
        return JSONResponse(service.start_monitoring())

    async def stop(_r: Request) -> JSONResponse:
        return JSONResponse(service.stop_monitoring())

    async def inspection(r: Request) -> JSONResponse:
        notes = (await body(r)).get("notes")
        if notes is not None and (not isinstance(notes, str) or len(notes) > 500):
            return err("notes must be a string up to 500 characters")
        return JSONResponse(service.request_inspection(notes=notes), status_code=201)

    async def acknowledge(r: Request) -> JSONResponse:
        data = await body(r)
        notes = data.get("notes")
        if notes is not None and (not isinstance(notes, str) or len(notes) > 500):
            return err("notes must be a string up to 500 characters")
        result = service.acknowledge(int(r.path_params["id"]), notes=notes)
        return JSONResponse(result) if result else err("incident not found or already closed", 404)

    async def close(r: Request) -> JSONResponse:
        try:
            result = service.close_incident(int(r.path_params["id"]), (await body(r)).get("notes"))
        except ValueError as exc:
            return err(str(exc), 409)
        return JSONResponse(result) if result else err("incident not found or already closed", 404)

    async def rebaseline(_r: Request) -> JSONResponse:
        service.gas.rebaseline()
        service._emit("GAS_REBASELINE_REQUESTED", "operator")
        return JSONResponse({"ok": True})

    async def audio_event(r: Request) -> JSONResponse:
        data = await body(r)
        try:
            return JSONResponse(service.report_audio(str(data.get("kind")), str(data.get("text", "")), float(data.get("score", 0.0))), status_code=201)
        except (TypeError, ValueError) as exc:
            return err(str(exc))

    async def audio_heartbeat(r: Request) -> JSONResponse:
        data = await body(r)
        try:
            service.audio_heartbeat(max(0.0, min(1.0, float(data.get("level", 0.0)))))
        except (TypeError, ValueError) as exc:
            return err(str(exc))
        return JSONResponse({"ok": True})

    async def sim_key(r: Request) -> JSONResponse:
        sim = service.arduino
        if not hasattr(sim, "press"):
            return err("simulation controls are available only with --simulate", 409)
        key = str((await body(r)).get("key", ""))
        if key not in VALID_KEYS:
            return err("unknown key")
        sim.press(key)
        return JSONResponse({"ok": True, "key": key, "simulated": True})

    async def sim_gas(r: Request) -> JSONResponse:
        sim = service.arduino
        if not hasattr(sim, "set_gas_offset"):
            return err("simulation controls are available only with --simulate", 409)
        try:
            counts = int((await body(r)).get("offset", 0))
        except (TypeError, ValueError):
            return err("offset must be an integer")
        sim.set_gas_offset(max(-300, min(700, counts)))
        return JSONResponse({"ok": True, "offset": sim.offset, "simulated": True})

    async def live(ws: WebSocket) -> None:
        await ws.accept()
        hub.clients.add(ws)
        await ws.send_json(service.snapshot())
        try:
            while True:
                try:
                    msg = json.loads(await ws.receive_text())
                except json.JSONDecodeError:
                    await ws.send_json({"type": "error", "detail": "Expected JSON"})
                    continue
                if isinstance(msg, dict) and msg.get("type") == "ping":
                    await ws.send_json({"type": "pong"})
        except WebSocketDisconnect:
            pass
        finally:
            hub.clients.discard(ws)

    return [
        Route("/api/status", status),
        Route("/api/sensors/latest", sensors_latest),
        Route("/api/sensors/history", sensors_history),
        Route("/api/sensors/rebaseline", rebaseline, methods=["POST"]),
        Route("/api/rf/status", rf_status),
        Route("/api/rf/history", rf_history),
        Route("/api/incidents", incidents),
        Route("/api/incidents", create_incident, methods=["POST"]),
        Route("/api/incidents/{id:int}/notes", add_note, methods=["POST"]),
        Route("/api/nodes", nodes),
        Route("/api/nodes/{node_id}", update_node, methods=["PUT"]),
        Route("/api/incidents/{id:int}", incident_detail),
        Route("/api/incidents/{id:int}/acknowledge", acknowledge, methods=["POST"]),
        Route("/api/incidents/{id:int}/close", close, methods=["POST"]),
        Route("/api/events", events),
        Route("/api/commands", commands),
        Route("/api/monitoring/start", start, methods=["POST"]),
        Route("/api/monitoring/stop", stop, methods=["POST"]),
        Route("/api/inspection/request", inspection, methods=["POST"]),
        Route("/api/audio/event", audio_event, methods=["POST"]),
        Route("/api/audio/heartbeat", audio_heartbeat, methods=["POST"]),
        Route("/api/simulate/key", sim_key, methods=["POST"]),
        Route("/api/simulate/gas", sim_gas, methods=["POST"]),
        WebSocketRoute("/ws/live", live),
    ]
