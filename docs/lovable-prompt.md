# Lovable prompt for the JATAYU console

Paste everything inside the box below into Lovable as the first message. Then see "After Lovable builds it" at the end.

````text
Build "JATAYU Console": a calm, very beginner-friendly operator dashboard for a prototype that watches Wi-Fi signal patterns (an ESP32 CSI sensor) and a gas sensor (Arduino), and keeps an auditable record of incidents. The person using it may never have seen it before. Every screen must make it obvious what is happening and what to do next.

STACK
React + TypeScript + Vite + Tailwind + shadcn/ui, Recharts for charts, lucide-react icons. No backend of your own, no login, no database. All data comes from an existing HTTP + WebSocket API (below). Put the API base URL in a Settings dialog, default "http://localhost:8000", saved in localStorage. If the API cannot be reached, switch to a built-in DEMO mode with realistic fake data and show a permanent yellow "DEMO DATA" badge. Never mix demo and real data.

HONESTY RULES (strict, they apply to every label, tooltip and toast)
- Never write "survivor detected", "person detected" or "breathing detected".
- Use: "Periodic RF pattern observed", "Signal quality: good", "Further investigation recommended".
- A periodic pattern is an observation for human review, not proof of a person.
- Gas readings are raw ADC counts (0 to 1023) from an uncalibrated sensor. Never show ppm or name a gas.
- "Confidence" means how clean and consistent the evidence is, never a probability that a person is present.
- Show a permanent slim banner: "Experimental prototype. Not a life-safety instrument."
- Always show stale data as stale (grey it out, say "last update 12 s ago"), and show "disconnected" differently from "zero".

LOOK AND FEEL
Calm, spacious, high-legibility operator console. Soft rounded cards (12px radius), generous spacing, one accent colour (blue), light and dark themes (follow the system, plus a toggle). Sticky top bar. Subtle depth (soft shadows, a faint glass effect on the top bar), gentle 150 to 250 ms transitions, no flashing, respect prefers-reduced-motion. Status is never colour alone: always an icon plus a text label. Text size control (A- / A+, five steps) remembered in localStorage. Works on a phone: single column, no horizontal scroll, 44px touch targets.

LAYOUT (single page with two tabs: "Overview" and "Signal lab")
1. Top bar: JATAYU wordmark, badge "SIMULATED DATA" (yellow) or "Live hardware" (green dot), a live-feed indicator (live / connecting / lost, polling), theme toggle, and a primary button "Start monitoring" / "Stop monitoring".
2. Slim honesty banner.
3. Toolbar row: View toggle [Simple | Detailed], Text size [A- A+], and buttons "Take the tour" and "Help and glossary". First visit shows a dismissible blue strip: "New here? Take a one-minute tour."
4. Guidance row (always visible):
   - "What to do next" card (8 columns): one icon, one short headline, one sentence, an optional short list, and 0 to 2 action buttons. It is computed from live state and changes by itself, in this priority order:
     a) API unreachable: "Waiting for the backend" with how to start it, button "Try again".
     b) No update for more than 6 s: "Data is stale".
     c) Live source and ESP32 offline: "The ESP32 is not sending data" with a checklist (USB data cable, 2.4 GHz hotspot on, right COM port, no serial monitor open), button "Open the Signal lab".
     d) Monitoring off: "Start monitoring" with a button that does it.
     e) Open incidents: "N incident(s) to review", button "Open the incident".
     f) Gas sensor warming up: "The gas sensor is warming up, about N seconds left".
     g) RF state REVIEW_RECOMMENDED or PERIODIC_PATTERN_OBSERVED: "A regular RF pattern is being observed" with caution that it is not proof.
     h) RF state LOW_QUALITY: "The signal is too weak to judge".
     i) Otherwise: "All quiet".
     Use a coloured left border (info / warning / error / ok) plus the icon. Do not re-render if nothing changed.
   - "Setup checklist" card (4 columns): progress bar and six items with a tick or an empty circle and a one-line hint when not ready: Backend reachable, ESP32 streaming CSI, Signal quality good or fair, Arduino connected, Gas sensor ready, Monitoring on. Show "4 of 6 ready".
5. Tabs. Overview tab:
   - Six status tiles: Monitoring, ESP32 CSI node, Arduino Mega, RF state, Environment, Active incidents.
   - RF observation card (state chip, plain sentence, data quality, confidence, periodicity score, pattern held for N s (review at 20 s), candidate rate (cycles/min, labelled "a candidate, not a breathing rate"), packet rate, packet loss, RSSI, and a line chart of periodicity score 0 to 1 with hover tooltip, keyboard arrows, and a "Table view" toggle).
   - Environmental sensor card (status chip, raw ADC reading, baseline, "elevated above" threshold, model, calibration, last reading age, line chart of raw counts with dashed baseline and threshold lines, buttons "Re-baseline" and "Table view").
   - Incidents card: list on the left, detail on the right. Buttons "New incident" (dialog asking a 3 to 200 character summary) and "Request inspection" (dialog with optional notes). Detail shows evidence list, acknowledgements, a note box, and buttons "Acknowledge" and "Close incident" (Close is disabled with a tooltip until acknowledged).
   - Event timeline (newest first, checkbox "Selected incident only").
   - Device commands table with a state chip per command: created, sent, received, executed, acknowledged, failed, timed out.
   - Sensor nodes table with inline Edit for x, y, z (metres), heading (degrees 0 to 359) and antenna.
   - Physical controls card: last keypad key, LCD page, Arduino link, backend cycle ms. When source is "simulated" only: a 12-key keypad that posts to /api/simulate/key and a gas offset slider (-300 to 700) that posts to /api/simulate/gas.
   Signal lab tab: a full-width iframe of `${apiBase}/csi?embed=1` (the original live waveform, spectrum, 3D view and calibration page), with a note: "Do the 30-second empty-room calibration here before real use", and a link to open it in its own tab. In demo mode show a placeholder explaining it needs the real backend.
6. Every card has a small "?" button that expands a plain-language explanation under its title (aria-expanded). Write these in simple words, 2 to 4 short sentences.
7. Help and glossary dialog: "Start here" 5 steps, a map of the page, then glossary lists for RF states, quality/confidence/gas terms, incident states and command stages, a "When something looks wrong" list, and a "What this is not" paragraph.
8. Guided tour (no library, or a tiny one): spotlight + popover with Next, Back, Skip, "3 of 10", arrow keys and Escape. Steps: What to do next, Setup checklist, Start/stop monitoring, Status tiles, RF card, Gas card, Incidents, Timeline, Signal lab tab, Help. Remember completion in localStorage.
9. Simple view hides charts, device commands, nodes and physical controls. Detailed shows everything. Remember the choice.
10. Friendly toasts after actions (never only on errors), for example "Monitoring started. Notable observations will now open incidents." and "Acknowledged. Close the incident once it is handled."
11. Good empty states with next-step hints (for example: "No incidents yet. They open when monitoring is on and something notable is seen, or you can open one yourself.").
12. Accessibility: semantic landmarks, visible focus rings, aria-live on the coach card, labels on every control, tab order that follows the page, 4.5:1 text contrast. All text from the API is untrusted: render it as plain text only.

API (JSON, CORS is open). Poll lists every 4 s and the status every 5 s as a fallback.
GET  /api/status  ->  {
  type:"jatayu", source:"simulated"|"live", monitoring:boolean,
  devices:{esp32:"online"|"offline", arduino:"online"|"offline"},
  rf:{ state, text, data_quality:"none"|"low"|"fair"|"good", confidence:"Insufficient data"|"Low"|"Moderate"|"High",
       periodicity_score:number, pattern_seconds:number,
       features:{ rhythm, focus, strength, dominant_rate_per_min, motion_index, packet_rate_hz, packet_loss_ratio, rssi } },
  environment:{ status:"NO_DATA"|"WARMING_UP"|"BASELINING"|"NORMAL"|"ELEVATED"|"STALE", data_quality, raw_adc, unit:"adc_counts",
       baseline_adc, threshold_adc, model, calibration, warmup_remaining_s, age_s, disclaimer },
  last_key:{key,action,at}|null, lcd_page:string, incident_counts:{open,acknowledged,closed},
  performance:{tick_ms}, server_time:number,
  arduino_link:{state,port,error,messages_rejected,last_rejected,kind}, csi_link:{state,port,error,packet_rate_hz,sequence:{received,lost,loss_ratio}} }
  RF states: NO_DATA, COLLECTING, INSUFFICIENT_DATA, LOW_QUALITY, NO_CLEAR_PERIODIC_PATTERN, PERIODIC_PATTERN_OBSERVED, REVIEW_RECOMMENDED.
GET  /api/rf/history?limit=240            -> [{recorded_at,pattern_state,signal_quality,confidence,periodicity_score,features,source}]
GET  /api/sensors/history?sensor=mq_raw&limit=300 -> [{recorded_at,raw_value,unit,quality_status,source}]
GET  /api/incidents?limit=60              -> [{id,incident_code,status:"open"|"acknowledged"|"closed",summary,source,created_at,updated_at}]
GET  /api/incidents/{id}                  -> incident + observations:[{id,observation_type,detail,created_at}], events:[...], acknowledgements:[{operator_action,notes,channel,acknowledged_at}]
GET  /api/events?limit=120                -> [{id,incident_id,event_type,actor,payload,created_at}]
GET  /api/commands                        -> [{id,name,target,args,state,created_at,sent_at,received_at,executed_at,acknowledged_at,failure}]
GET  /api/nodes                           -> [{node_id,role,x_m,y_m,z_m,orientation_deg,antenna,notes,firmware,channel,source,first_seen_at,last_seen_at}]
POST /api/monitoring/start | /api/monitoring/stop
POST /api/inspection/request              body {notes?}  -> {incident_id, command}
POST /api/incidents                       body {summary}  (201)
POST /api/incidents/{id}/notes            body {text}     (201)
POST /api/incidents/{id}/acknowledge      body {notes?}
POST /api/incidents/{id}/close            409 if not acknowledged
POST /api/sensors/rebaseline
PUT  /api/nodes/{node_id}                 body any of {x_m,y_m,z_m,orientation_deg,antenna,notes,role}
POST /api/simulate/key {key}   POST /api/simulate/gas {offset}   (409 unless source is "simulated")
Errors are {"detail": "message"}: show that message in a toast.
WebSocket ws(s)://<host>/ws/live sends: the same object as /api/status (type "jatayu") about once a second, {type:"event",event:{...}} for each new event, and {type:"key",key:{...}} on keypad presses. Reconnect with backoff. If it drops, say "Feed lost, polling" and keep polling.

DEMO MODE DATA (only when the API is unreachable)
Generate plausible values: RF state cycling slowly, packet rate near 100, gas around 310 counts with small noise, a couple of sample incidents and events. Mark everything "DEMO DATA".

Do not add authentication, payments, or any feature not listed. Keep the code simple and well organised: src/api (client + types + websocket hook), src/components, src/lib/guide.ts (the "what to do next" rules as a pure function with unit tests), src/lib/glossary.ts.
````

## After Lovable builds it

1. In Lovable, open Settings in the generated app and set the API base URL to where your backend runs.
2. **Browser limits to expect.** A Lovable preview is served over https. Browsers block an https page from calling plain http on another machine, and may also restrict calls to a local network address. If the preview shows DEMO DATA even though the backend is running:
   - export the Lovable project to GitHub, clone it, and run it locally (`npm install`, `npm run dev`), or build it (`npm run build`) and serve the `dist` folder from the Raspberry Pi;
   - or use a tunnel that gives the backend an https address.
3. The backend already allows cross-origin requests, so no backend change is needed for the local-run route.
4. Keep `GET /csi` available: the Signal lab tab depends on it.
