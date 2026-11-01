# JATAYU results page (`dashboard/simple/`)

A single-purpose, read-only operator view of what the backend already reports:
the RF observation state, the raw MQ-135 ADC reading, the waveform the backend
actually returned, the connected devices, recent events and the incident queue.

It changes nothing. It reads these endpoints with `GET` and issues no writes:

| Read | Used for |
| --- | --- |
| `GET /api/status` | RF state, environment, devices, sources, performance |
| `GET /telemetry` | processed and raw waveform, spectrum, heatmap |
| `GET /api/events?limit=40` | recent activity |
| `GET /api/incidents?limit=100` | review queue and incident counts |
| `GET /api/incidents/{id}` | one incident, only when you open it |

`backend/app.py`, `dashboard/console.html`, `dashboard/index.html` and
`console/` are untouched by this page — it is inert static files.

## Open it

Start the backend as usual, then open `http://<pi-ip>:8000/simple/`. The backend
serves this folder and the page uses that same address.

It also opens without the backend serving it, either way:

```bash
# from the repository root
python -m http.server 4173 --directory dashboard
# then visit http://127.0.0.1:4173/simple/
```

Or double-click `dashboard/simple/index.html`. The scripts are classic
`<script>` tags, not ES modules, so `file://` works — the backend already
allows cross-origin reads (`CORSMiddleware`, `allow_origins=["*"]`) for
exactly this case.

Point it at another Pi with the **Connection** button, or with a query string:

```
index.html?backend=http://192.168.1.22:8000
```

Only an HTTP/HTTPS origin is accepted — no path, no credentials.

## What it guarantees

- **A simulated source can never look live.** The badge reads `SIMULATED`,
  `DEMO OVERRIDE` or `MIXED SOURCES` straight from `status.source`,
  `arduino_link` and `csi_link`.
- **Nothing is invented.** A missing value renders as `—`, never `0`.
  `packet_loss_ratio: null` stays `— %`.
- **Stale data is marked stale.** If snapshots stop arriving, the live panels
  desaturate and the banner reports the age of the last good read.
- **Pause pauses the page, not the backend.** The banner says so.
- **The wording follows the system guide.** "Periodic RF pattern observed",
  raw ADC counts rather than ppm, and an observation rather than a person.

## Files

| File | Role |
| --- | --- |
| `index.html` | markup and panel structure |
| `styles.css` | the field-instrument look, responsive from 320 px |
| `model.js` | the presentation rules (source labelling, formatting, freshness) — the only place they live, so tests can load them |
| `app.js` | polling and rendering |
| `simple.test.mjs` | loads `model.js` as shipped and checks it against a running backend |

## Tests

`simple.test.mjs` evaluates `model.js` directly, so the rules under test are
the rules that ship, and its two contract tests hit a real backend:

```bash
python backend/app.py --simulate --db ":memory:"
JATAYU_BASE=http://127.0.0.1:8000 node --test "dashboard/simple/*.test.mjs"
```

Without a backend the contract tests skip rather than fail; the five rule
tests always run.
